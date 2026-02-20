import type { CodexClientFacade } from "../codex/codexClientFacade.js";
import { routeTaskIntent, type TaskRouterOptions } from "./taskRouter.js";
import type { TaskIntent, TaskKind } from "./taskTypes.js";
import { validateIntent } from "./validate.js";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.55;
const ALLOWED_KINDS = new Set<TaskKind>([
  "help",
  "status",
  "explain",
  "change",
  "run",
  "diagnose",
  "search",
  "review"
]);

export type ModelRouterResult = {
  intent: TaskIntent;
  source: "model" | "deterministic_fallback";
  reason?: string;
};

export type ModelRouterOptions = TaskRouterOptions & {
  strict?: boolean;
  attachRawOutputOnStrictFailure?: boolean;
  signal?: AbortSignal;
};

export type ModelRouterDeps = {
  codex: Pick<CodexClientFacade, "completeWithStreaming">;
  fallbackRouter?: (input: string, options: TaskRouterOptions) => TaskIntent;
};

export type ModelRouterStrictErrorDetails = {
  source: "model_router_strict";
  reason: string;
  rawModelOutput?: string;
  confidence?: number;
  confidenceThreshold?: number;
  causeMessage?: string;
  expectedKind?: TaskKind;
  suggestedCommand?: string;
};

export class ModelRouterStrictError extends Error {
  readonly reason: string;
  readonly details: ModelRouterStrictErrorDetails;

  constructor(reason: string, details: Omit<ModelRouterStrictErrorDetails, "source" | "reason"> = {}) {
    super(`model router strict mode blocked fallback: ${reason}`);
    this.name = "ModelRouterStrictError";
    this.reason = reason;
    this.details = {
      source: "model_router_strict",
      reason,
      ...details
    };
  }
}

export async function routeTaskIntentWithModel(
  input: string,
  options: ModelRouterOptions = {},
  deps: ModelRouterDeps
): Promise<ModelRouterResult> {
  const normalized = input.trim();
  const fallback = deps.fallbackRouter ?? routeTaskIntent;
  const fallbackOptions: TaskRouterOptions = {
    confidenceThreshold: options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
    maxFiles: options.maxFiles
  };
  const strictMode = options.strict === true;
  const attachRawOnStrictFailure = options.attachRawOutputOnStrictFailure === true;
  const fallbackIntent = (): ModelRouterResult => ({
    intent: fallback(input, fallbackOptions),
    source: "deterministic_fallback"
  });

  if (!normalized) {
    return fallbackIntent();
  }

  let rawModelOutput: string | undefined;
  try {
    rawModelOutput = await deps.codex.completeWithStreaming(
      buildModelRouterPrompt(normalized),
      "",
      {},
      options.signal
    );
    const parsed = parseModelIntent(rawModelOutput, normalized);
    if (!parsed) {
      if (strictMode) {
        throw new ModelRouterStrictError("invalid_model_output", {
          rawModelOutput: attachRawOnStrictFailure ? clipDebugOutput(rawModelOutput) : undefined
        });
      }
      return {
        ...fallbackIntent(),
        reason: "invalid_model_output"
      };
    }
    const inferredGitSyncCommand = inferGitSyncCommandFromText(normalized);
    if (parsed.kind === "run" && !parsed.params?.cmd && inferredGitSyncCommand) {
      parsed.params = {
        ...(parsed.params ?? {}),
        cmd: inferredGitSyncCommand
      };
    }
    if (hasExplicitExecutionIntent(normalized) && parsed.kind !== "run") {
      if (strictMode) {
        throw new ModelRouterStrictError("misclassified_execution_intent", {
          expectedKind: "run",
          suggestedCommand: inferredGitSyncCommand,
          rawModelOutput: attachRawOnStrictFailure ? clipDebugOutput(rawModelOutput) : undefined
        });
      }
      return {
        ...fallbackIntent(),
        reason: "misclassified_execution_intent"
      };
    }
    const threshold = clampConfidence(
      options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD
    );
    if (parsed.confidence < threshold) {
      if (strictMode) {
        throw new ModelRouterStrictError(`low_confidence:${parsed.confidence.toFixed(2)}`, {
          confidence: parsed.confidence,
          confidenceThreshold: threshold,
          rawModelOutput: attachRawOnStrictFailure ? clipDebugOutput(rawModelOutput) : undefined
        });
      }
      return {
        ...fallbackIntent(),
        reason: `low_confidence:${parsed.confidence.toFixed(2)}`
      };
    }
    return {
      intent: validateIntent(parsed),
      source: "model"
    };
  } catch (error) {
    if (strictMode) {
      if (error instanceof ModelRouterStrictError) {
        throw error;
      }
      throw new ModelRouterStrictError("model_router_failed", {
        causeMessage: error instanceof Error ? error.message : String(error),
        rawModelOutput: attachRawOnStrictFailure ? clipDebugOutput(rawModelOutput) : undefined
      });
    }
    return {
      ...fallbackIntent(),
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildModelRouterPrompt(userText: string): string {
  return [
    "You are a strict intent classifier for CodexBridge.",
    "Classify the user request into exactly one kind:",
    "help, status, explain, change, run, diagnose, search, review.",
    "Return JSON only. No markdown, no prose.",
    "",
    "Schema:",
    "{",
    "  \"kind\": \"help|status|explain|change|run|diagnose|search|review\",",
    "  \"confidence\": 0.0-1.0,",
    "  \"summary\": \"short summary\",",
    "  \"params\": {",
    "    \"files\": [\"optional/path.ts\"],",
    "    \"cmd\": \"for run only\",",
    "    \"question\": \"for explain only\",",
    "    \"changeRequest\": \"for change/diagnose\",",
    "    \"query\": \"for search\"",
    "  }",
    "}",
    "",
    "Rules:",
    "- If unsure, choose explain with confidence <= 0.5.",
    "- Any request that asks to execute actions must be kind=run, never explain.",
    "- For GitHub sync requests, choose run and provide cmd.",
    "- If user asks to sync TO GitHub / push / submit-and-push / 同步到GitHub / 推送到远程: cmd should default to \"git push\".",
    "- If user asks to sync FROM GitHub / pull / fetch / 从GitHub拉取: cmd should default to \"git pull --ff-only\" or \"git fetch --all --prune\".",
    "- For run intent, provide a safe cmd when possible.",
    "- Keep summary concise and grounded.",
    "",
    "User request:",
    userText
  ].join("\n");
}

function parseModelIntent(raw: string, fallbackSummary: string): TaskIntent | undefined {
  const parsed =
    tryParseObject(raw)
    ?? tryParseObject(stripCodeFence(raw))
    ?? tryParseObject(extractFirstJsonObject(raw));
  if (!parsed) {
    return undefined;
  }
  const candidateRoot = asRecord(parsed.intent) ?? parsed;
  const kindRaw = typeof candidateRoot.kind === "string"
    ? candidateRoot.kind.trim().toLowerCase()
    : "";
  if (!ALLOWED_KINDS.has(kindRaw as TaskKind)) {
    return undefined;
  }

  const confidence = clampConfidence(
    typeof candidateRoot.confidence === "number"
      ? candidateRoot.confidence
      : Number(candidateRoot.confidence ?? 0)
  );
  const summary = pickString(candidateRoot.summary) || summarizeFallback(fallbackSummary);
  const paramsRoot = asRecord(candidateRoot.params);
  const params = paramsRoot
    ? {
      files: parseFiles(paramsRoot.files),
      cmd: pickString(paramsRoot.cmd),
      question: pickString(paramsRoot.question),
      changeRequest: pickString(paramsRoot.changeRequest),
      query: pickString(paramsRoot.query)
    }
    : undefined;
  const normalizedParams = params && Object.values(params).some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return typeof value === "string" && value.trim().length > 0;
  })
    ? params
    : undefined;

  return {
    kind: kindRaw as TaskKind,
    confidence,
    summary,
    params: normalizedParams
  };
}

function tryParseObject(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || trimmed;
}

function extractFirstJsonObject(raw: string): string | undefined {
  const text = raw.trim();
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseFiles(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const files = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
  return files.length > 0 ? files : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function summarizeFallback(input: string): string {
  const singleLine = input.replace(/\s+/g, " ").trim();
  if (!singleLine) {
    return "model-routed task";
  }
  if (singleLine.length <= 80) {
    return singleLine;
  }
  return `${singleLine.slice(0, 77)}...`;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function clipDebugOutput(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const limit = 16_000;
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit)}\n...[truncated]`;
}

function hasExplicitExecutionIntent(text: string): boolean {
  if (/(?:\brun\b|\bexecute\b|\btest\b|\bbuild\b|\blint\b)/i.test(text)) {
    return true;
  }
  if (/(?:\u8fd0\u884c|\u6267\u884c|\u6d4b\u8bd5|\u7f16\u8bd1)/.test(text)) {
    return true;
  }
  return isLikelyGitSyncIntent(text);
}

function inferGitSyncCommandFromText(text: string): string | undefined {
  if (!isLikelyGitSyncIntent(text)) {
    return undefined;
  }
  const lower = text.toLowerCase();
  if (
    /\bgit\s+fetch\b/i.test(text)
    || /\bfetch\b/i.test(text)
    || /(?:\u62c9\u53d6\u8fdc\u7a0b|\u83b7\u53d6\u8fdc\u7a0b)/.test(text)
  ) {
    return "git fetch --all --prune";
  }
  if (/\brebase\b/i.test(text) || /\u53d8\u57fa/.test(text)) {
    return "git pull --rebase";
  }
  if (
    /\bfrom\s+github\b/i.test(lower)
    || /(?:\u4ecegithub|\u4ece github|\u62c9\u53d6|\u540c\u6b65\u5230?\u672c\u5730|\u5230\u672c\u5730)/.test(text)
  ) {
    return "git pull --ff-only";
  }
  if (
    /\bto\s+github\b/i.test(lower)
    || /\bpush\b/i.test(lower)
    || /(?:\u63a8\u9001|\u63d0\u4ea4\u5e76\u63a8\u9001|\u540c\u6b65\u5230github|\u540c\u6b65\u5230 github|\u4e0a\u4f20\u5230github)/.test(text)
  ) {
    return "git push";
  }
  return "git push";
}

function isLikelyGitSyncIntent(text: string): boolean {
  const hasTarget = /\b(?:git|github|repo|repository)\b/i.test(text)
    || /(?:github|\u4ed3\u5e93|\u4ee3\u7801\u4ed3|\u4ee3\u7801\u5e93|\u8fdc\u7a0b\u4ed3)/.test(text);
  if (!hasTarget) {
    return false;
  }
  return /\b(?:sync|synchronize|push|pull|fetch|rebase|commit)\b/i.test(text)
    || /(?:\u540c\u6b65|\u63a8\u9001|\u62c9\u53d6|\u53d8\u57fa|\u63d0\u4ea4)/.test(text);
}
