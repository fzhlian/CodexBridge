import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CODEX_METHODS,
  CodexAppServerClient,
  type CodexClientOptions
} from "@codexbridge/codex-client";
import { t } from "../i18n/messages.js";

const CHAT_EXEC_FALLBACK_ENV = "CODEX_CHAT_ENABLE_EXEC_FALLBACK";
const CHAT_EXEC_UNSAFE_BYPASS_ENV = "CODEX_CHAT_EXEC_BYPASS_APPROVALS_AND_SANDBOX";
const CHAT_EXEC_TIMEOUT_MS_ENV = "CODEX_CHAT_EXEC_TIMEOUT_MS";
const CHAT_EXEC_RETRY_TIMEOUT_MS_ENV = "CODEX_CHAT_EXEC_RETRY_TIMEOUT_MS";
const CHAT_EXEC_RETRY_CONTEXT_MAX_CHARS_ENV = "CODEX_CHAT_EXEC_RETRY_CONTEXT_MAX_CHARS";

export type CodexChatFallbackErrorDetails = {
  code:
    | "chat_exec_fallback_disabled"
    | "invalid_exec_response"
    | "exec_non_zero_exit"
    | "missing_assistant_message";
  fallbackEnabled: boolean;
  unsafeBypassEnabled: boolean;
  causeMessage?: string;
  hint?: string;
  responseType?: string;
  responseKeys?: string[];
  exitCode?: number;
  stdoutSample?: string;
  stderrSample?: string;
};

export class CodexChatFallbackError extends Error {
  readonly details: CodexChatFallbackErrorDetails;

  constructor(message: string, details: CodexChatFallbackErrorDetails) {
    super(message);
    this.name = "CodexChatFallbackError";
    this.details = details;
  }
}

export type StreamCallbacks = {
  onStart?: () => void;
  onChunk?: (chunk: string) => void;
  onEnd?: () => void;
};

export class CodexClientFacade {
  private client?: CodexAppServerClient;

  async completeWithStreaming(
    prompt: string,
    renderedContext: string,
    callbacks: StreamCallbacks = {},
    signal?: AbortSignal,
    workspaceRoot?: string
  ): Promise<string> {
    callbacks.onStart?.();
    const timeoutMs = resolvePositiveInt(process.env.CODEX_REQUEST_TIMEOUT_MS, 240_000);
    const execTimeoutMs = resolveChatExecTimeoutMs(timeoutMs);
    let text = "";

    try {
      const response = await this.getClient().request(
        CODEX_METHODS.COMPLETE,
        {
          prompt,
          context: renderedContext
        },
        {
          signal,
          timeoutMs
        }
      );
      text = extractAssistantText(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!shouldFallbackToCommandExec(message)) {
        throw error;
      }
      if (!isChatExecFallbackEnabled()) {
        throw createChatFallbackError(
          t("codex.fallback.completeUnavailable"),
          "chat_exec_fallback_disabled",
          {
            causeMessage: message,
            hint: t("codex.fallback.completeUnavailableHint")
          }
        );
      }
      try {
        text = await this.completeViaCommandExecWithRetries(
          prompt,
          renderedContext,
          execTimeoutMs,
          signal,
          workspaceRoot
        );
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
        if (looksLikeExecTimeoutError(fallbackMessage)) {
          throw createChatFallbackError(
            t("codex.fallback.execTimedOut"),
            "exec_non_zero_exit",
            {
              causeMessage: fallbackMessage,
              hint: t("codex.fallback.execTimedOutHint")
            }
          );
        }
        throw fallbackError;
      }
    }

    await emitChunked(text, callbacks, signal);
    callbacks.onEnd?.();
    return text;
  }

  private getClient(): CodexAppServerClient {
    if (!this.client) {
      this.client = new CodexAppServerClient(getClientOptions());
    }
    return this.client;
  }

  private async completeViaCommandExec(
    prompt: string,
    renderedContext: string,
    timeoutMs: number,
    signal?: AbortSignal,
    workspaceRoot?: string
  ): Promise<string> {
    const command = process.env.CODEX_COMMAND?.trim() || "codex";
    const cwd = workspaceRoot?.trim() || process.env.WORKSPACE_ROOT?.trim() || process.cwd();
    const outputPath = path.join(os.tmpdir(), `codexbridge-chat-${randomUUID()}.txt`);
    const commandLine = buildChatExecCommandArgs({
      command,
      cwd,
      outputPath,
      prompt: buildExecPrompt(prompt, renderedContext),
      unsafeBypassEnabled: isChatExecUnsafeBypassEnabled()
    });
    const response = await this.getClient().request(
      CODEX_METHODS.COMMAND_EXEC,
      {
        command: commandLine,
        timeoutMs
      },
      {
        signal,
        timeoutMs: timeoutMs + 60_000
      }
    );
    return await parseCommandExecTextResponse(response, outputPath);
  }

  private async completeViaCommandExecWithRetries(
    prompt: string,
    renderedContext: string,
    execTimeoutMs: number,
    signal?: AbortSignal,
    workspaceRoot?: string
  ): Promise<string> {
    try {
      return await this.completeViaCommandExec(
        prompt,
        renderedContext,
        execTimeoutMs,
        signal,
        workspaceRoot
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!looksLikeExecTimeoutError(message)) {
        throw error;
      }
      const retryTimeoutMs = resolveChatExecRetryTimeoutMs(execTimeoutMs);
      const retryContexts = buildExecRetryContexts(renderedContext);
      if (retryContexts.length === 0) {
        throw error;
      }
      let lastError: unknown = error;
      for (const retryContext of retryContexts) {
        if (signal?.aborted) {
          break;
        }
        try {
          return await this.completeViaCommandExec(
            prompt,
            retryContext,
            retryTimeoutMs,
            signal,
            workspaceRoot
          );
        } catch (retryError) {
          const retryMessage = retryError instanceof Error
            ? retryError.message
            : String(retryError);
          lastError = retryError;
          if (!looksLikeExecTimeoutError(retryMessage)) {
            throw retryError;
          }
        }
      }
      throw lastError;
    }
  }
}

function getClientOptions(): CodexClientOptions {
  return {
    command: process.env.CODEX_COMMAND?.trim() || "codex",
    args: process.env.CODEX_ARGS
      ? process.env.CODEX_ARGS.split(",").map((item) => item.trim()).filter(Boolean)
      : ["app-server"],
    requestTimeoutMs: Number(process.env.CODEX_REQUEST_TIMEOUT_MS ?? "240000"),
    restartOnExit: true
  };
}

function extractAssistantText(
  response: unknown,
  options: { allowSerializeFallback?: boolean } = {}
): string {
  if (typeof response === "string") {
    return response.trim();
  }
  if (response && typeof response === "object") {
    const value = response as Record<string, unknown>;
    const direct = pickString(value, ["text", "output_text", "content", "summary", "message"]);
    if (direct) {
      return direct;
    }
  }
  if (options.allowSerializeFallback === false) {
    return "";
  }
  return JSON.stringify(response ?? "");
}

export async function parseCommandExecTextResponse(
  response: unknown,
  outputPath: string
): Promise<string> {
  let outputText = "";
  try {
    outputText = (await fs.readFile(outputPath, "utf8")).trim();
  } catch {
    outputText = "";
  } finally {
    void fs.unlink(outputPath).catch(() => undefined);
  }

  if (!response || typeof response !== "object") {
    if (outputText) {
      return outputText;
    }
    throw createChatFallbackError(t("codex.fallback.invalidExecResponse"), "invalid_exec_response", {
      responseType: typeof response
    });
  }

  const value = response as Record<string, unknown>;
  const exitCode = Number(value.exitCode ?? 1);
  const stdout = typeof value.stdout === "string" ? value.stdout : "";
  const stderr = typeof value.stderr === "string" ? value.stderr : "";
  if (exitCode !== 0) {
    throw createChatFallbackError(t("codex.fallback.execFailed"), "exec_non_zero_exit", {
      exitCode,
      stdoutSample: clipForError(stdout),
      stderrSample: clipForError(stderr)
    });
  }

  if (outputText) {
    return outputText;
  }

  const extracted = extractLastCodexMessage(stdout);
  if (extracted) {
    return extracted;
  }

  const direct = extractAssistantText(response, { allowSerializeFallback: false });
  if (direct) {
    return direct;
  }

  throw createChatFallbackError(t("codex.fallback.execMissingAssistantMessage"), "missing_assistant_message", {
    responseKeys: Object.keys(value).slice(0, 20),
    stdoutSample: clipForError(stdout),
    stderrSample: clipForError(stderr)
  });
}

export function buildChatExecCommandArgs(input: {
  command: string;
  cwd: string;
  outputPath: string;
  prompt: string;
  unsafeBypassEnabled?: boolean;
}): string[] {
  const args = [input.command, "exec", "--skip-git-repo-check"];
  if (input.unsafeBypassEnabled) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  }
  args.push(
    "--cd",
    input.cwd,
    "--output-last-message",
    input.outputPath,
    input.prompt
  );
  return args;
}

function extractLastCodexMessage(stdout: string): string | undefined {
  const normalized = stdout.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return undefined;
  }
  const regex = /(?:^|\n)codex\n([\s\S]*?)(?=\n(?:tokens used\b|$))/gi;
  let last: string | undefined;
  for (const match of normalized.matchAll(regex)) {
    last = match[1]?.trim();
  }
  return last && last.length > 0 ? last : undefined;
}

function shouldFallbackToCommandExec(message: string): boolean {
  const normalized = message.toLowerCase();
  if (normalized.includes("method not found") || normalized.includes("invalid request")) {
    return true;
  }
  return /\bunknown variant\b[\s\S]{0,40}\bcomplete\b/i.test(message);
}

function looksLikeExecTimeoutError(message: string): boolean {
  const normalized = message.toLowerCase();
  if (normalized.includes("sandbox error") && normalized.includes("timed out")) {
    return true;
  }
  return normalized.includes("command timed out")
    || normalized.includes("request timed out")
    || normalized.includes("timeout");
}

export function isChatExecFallbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBoolFlag(env[CHAT_EXEC_FALLBACK_ENV]);
}

export function isChatExecUnsafeBypassEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBoolFlag(env[CHAT_EXEC_UNSAFE_BYPASS_ENV]);
}

function parseBoolFlag(raw: string | undefined): boolean {
  const normalized = raw?.trim().toLowerCase();
  return normalized === "1"
    || normalized === "true"
    || normalized === "yes"
    || normalized === "on";
}

function createChatFallbackError(
  message: string,
  code: CodexChatFallbackErrorDetails["code"],
  details: Omit<
    Partial<CodexChatFallbackErrorDetails>,
    "code" | "fallbackEnabled" | "unsafeBypassEnabled"
  > = {}
): CodexChatFallbackError {
  return new CodexChatFallbackError(message, {
    code,
    fallbackEnabled: isChatExecFallbackEnabled(),
    unsafeBypassEnabled: isChatExecUnsafeBypassEnabled(),
    ...details
  });
}

function clipForError(value: string, limit = 500): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit)}...[truncated]`;
}

function buildExecPrompt(prompt: string, renderedContext: string): string {
  const trimmedContext = renderedContext.trim();
  if (!trimmedContext) {
    return prompt;
  }
  const maxContextChars = resolvePositiveInt(process.env.CODEX_CHAT_CONTEXT_MAX_CHARS, 16_000);
  const safeContext = trimWithEllipsis(trimmedContext, maxContextChars);
  return [
    "You are helping in a VS Code chat panel.",
    "Answer the user's request directly and concisely.",
    "",
    "User request:",
    prompt,
    "",
    "Context:",
    safeContext
  ].join("\n");
}

export function resolveChatExecTimeoutMs(baseTimeoutMs: number): number {
  const fallback = Math.max(baseTimeoutMs, 420_000);
  return resolvePositiveInt(process.env[CHAT_EXEC_TIMEOUT_MS_ENV], fallback);
}

export function resolveChatExecRetryTimeoutMs(baseExecTimeoutMs: number): number {
  const fallback = Math.max(baseExecTimeoutMs, 600_000);
  return resolvePositiveInt(process.env[CHAT_EXEC_RETRY_TIMEOUT_MS_ENV], fallback);
}

export function buildExecRetryContexts(renderedContext: string): string[] {
  const normalized = renderedContext.trim();
  if (!normalized) {
    return [];
  }
  const retryMaxChars = resolvePositiveInt(process.env[CHAT_EXEC_RETRY_CONTEXT_MAX_CHARS_ENV], 2_000);
  const compact = trimWithEllipsis(normalized, retryMaxChars).trim();
  const contexts: string[] = [];
  if (compact && compact !== normalized) {
    contexts.push(compact);
  }
  contexts.push("");
  return contexts;
}

function trimWithEllipsis(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...[truncated]`;
}

function resolvePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

async function emitChunked(
  text: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const chunkSize = 80;
  for (let i = 0; i < text.length; i += chunkSize) {
    if (signal?.aborted) {
      break;
    }
    callbacks.onChunk?.(text.slice(i, i + chunkSize));
    await wait(8);
  }
  if (text.length === 0) {
    callbacks.onChunk?.("");
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
