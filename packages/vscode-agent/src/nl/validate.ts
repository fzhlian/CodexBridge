import type { TaskIntent, TaskKind } from "./taskTypes.js";

const ALLOWED_TASK_KINDS = new Set<TaskKind>([
  "help",
  "status",
  "explain",
  "change",
  "run",
  "git_sync",
  "diagnose",
  "search",
  "review"
]);

const DEFAULT_MAX_FILES = 10;

export function validateIntent(intent: TaskIntent): TaskIntent {
  if (!ALLOWED_TASK_KINDS.has(intent.kind)) {
    throw new Error(`invalid task kind: ${String(intent.kind)}`);
  }

  const normalizedParams = intent.params
    ? {
      ...intent.params,
      files: intent.params.files ? sanitizeFiles(intent.params.files) : undefined,
      cmd: intent.params.cmd ? sanitizeCmd(intent.params.cmd) : undefined
    }
    : undefined;

  return {
    ...intent,
    confidence: clampConfidence(intent.confidence),
    params: normalizedParams
  };
}

export function sanitizeFiles(files: string[], maxFiles = DEFAULT_MAX_FILES): string[] {
  const safeMax = Number.isFinite(maxFiles) && maxFiles > 0
    ? Math.floor(maxFiles)
    : DEFAULT_MAX_FILES;
  const output: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const normalized = file
      .replaceAll("\\", "/")
      .trim()
      .replace(/^\.\/+/, "")
      .replace(/^["'`]+|["'`]+$/g, "");
    if (!normalized || normalized.includes("\n") || normalized.includes("\r")) {
      continue;
    }
    if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
      continue;
    }
    if (normalized.split("/").some((item) => item === "..")) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= safeMax) {
      break;
    }
  }
  return output;
}

export function sanitizeCmd(command: string): string {
  const normalized = command
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }
  const firstSegment = normalized.split(/\s*(?:&&|\|\||;|\||>|<)\s*/)[0]?.trim();
  return firstSegment || "";
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.55;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}
