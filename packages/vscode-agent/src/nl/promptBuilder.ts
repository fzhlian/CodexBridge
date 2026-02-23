import type { TaskIntent } from "./taskTypes.js";

const DEFAULT_MAX_CONTEXT_CHARS = 8_000;

export type PromptMode = "explain" | "diff-only";

export type BuildIntentPromptInput = {
  mode: PromptMode;
  intent: TaskIntent;
  requestText: string;
  renderedContext?: string;
  maxContextChars?: number;
};

export type BuildIntentPromptOutput = {
  mode: PromptMode;
  prompt: string;
};

export function resolvePromptMode(intent: TaskIntent): PromptMode {
  return intent.kind === "change" || intent.kind === "diagnose" ? "diff-only" : "explain";
}

export function buildIntentPrompt(input: BuildIntentPromptInput): BuildIntentPromptOutput {
  const contextBlock = buildContextBlock(
    input.renderedContext,
    resolvePositiveInt(input.maxContextChars, DEFAULT_MAX_CONTEXT_CHARS)
  );

  if (input.mode === "diff-only") {
    return {
      mode: input.mode,
      prompt: buildDiffOnlyPrompt(input.intent, input.requestText, contextBlock)
    };
  }

  return {
    mode: input.mode,
    prompt: buildExplainPrompt(input.intent, input.requestText, contextBlock)
  };
}

function buildExplainPrompt(
  intent: TaskIntent,
  requestText: string,
  contextBlock: string
): string {
  const question = intent.params?.question?.trim()
    || requestText.trim()
    || intent.summary.trim()
    || "Explain the user's request.";

  return [
    "You are the CodexBridge NL task assistant.",
    "Give a direct explanation grounded in the provided repository context.",
    "Do not request command execution in this step.",
    "",
    `Intent summary: ${intent.summary}`,
    `Intent kind: ${intent.kind}`,
    "",
    "User request:",
    question,
    "",
    "Context block (bounded):",
    contextBlock
  ].join("\n");
}

function buildDiffOnlyPrompt(
  intent: TaskIntent,
  requestText: string,
  contextBlock: string
): string {
  const changeRequest = intent.params?.changeRequest?.trim()
    || requestText.trim()
    || intent.summary.trim()
    || "Prepare a safe code change.";

  return [
    "You are generating a proposal for a code change task.",
    "Return ONLY unified diff content that can be applied directly.",
    "Never execute commands and never ask the user to run commands.",
    "When diff is possible, include file paths and valid hunk headers.",
    "Do not include markdown fences.",
    "",
    `Intent summary: ${intent.summary}`,
    `Intent kind: ${intent.kind}`,
    "",
    "Change request:",
    changeRequest,
    "",
    "Context block (bounded):",
    contextBlock
  ].join("\n");
}

function buildContextBlock(renderedContext: string | undefined, maxChars: number): string {
  const normalized = (renderedContext ?? "").trim();
  if (!normalized) {
    return "(none)";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}\n...[truncated]`;
}

function resolvePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}
