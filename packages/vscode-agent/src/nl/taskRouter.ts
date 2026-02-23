import type { TaskIntent, TaskKind } from "./taskTypes.js";
import { parseDevCommand } from "@codexbridge/shared";
import {
  sanitizeCmd as sanitizeCmdInput,
  sanitizeFiles as sanitizeFilesInput,
  validateIntent
} from "./validate.js";

const DEV_PREFIX_REGEX = /^\s*@dev\b[:\uFF1A]?\s*/i;
const FILE_PATH_REGEX = /(^|[\s"'`])([A-Za-z0-9_./-]+\.[A-Za-z0-9_+-]+)(?=$|[\s"'`])/g;
const MAX_FILES = 10;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.55;

const HELP_TERMS = [
  "help",
  "usage",
  "how to use",
  "commands",
  "\u5e2e\u52a9",
  "\u547d\u4ee4\u5217\u8868",
  "\u600e\u4e48\u7528"
];
const STATUS_TERMS = [
  "status",
  "health",
  "state",
  "\u72b6\u6001",
  "\u5065\u5eb7\u68c0\u67e5",
  "\u8fd0\u884c\u72b6\u6001"
];
const EXPLAIN_TERMS = [
  "why",
  "explain",
  "what does",
  "how does",
  "meaning",
  "\u89e3\u91ca",
  "\u4e3a\u4ec0\u4e48",
  "\u600e\u4e48\u56de\u4e8b"
];
const CHANGE_TERMS = [
  "fix",
  "implement",
  "refactor",
  "add",
  "change",
  "update",
  "\u4fee\u590d",
  "\u5b9e\u73b0",
  "\u91cd\u6784",
  "\u65b0\u589e",
  "\u4fee\u6539",
  "\u8c03\u6574"
];
const RUN_TERMS = [
  "run",
  "execute",
  "test",
  "build",
  "lint",
  "\u8fd0\u884c",
  "\u6267\u884c",
  "\u6d4b\u8bd5",
  "\u7f16\u8bd1"
];
const GIT_TARGET_TERMS = [
  "git",
  "github",
  "repo",
  "repository",
  "\u4ed3\u5e93",
  "\u4ee3\u7801\u4ed3",
  "\u4ee3\u7801\u5e93",
  "\u8fdc\u7a0b\u4ed3",
  "\u8fdc\u7a0b\u4ed3\u5e93"
];
const GIT_SYNC_TERMS = [
  "sync",
  "synchronize",
  "push",
  "pull",
  "fetch",
  "rebase",
  "commit",
  "publish",
  "\u540c\u6b65",
  "\u63a8\u9001",
  "\u62c9\u53d6",
  "\u53d8\u57fa",
  "\u63d0\u4ea4",
  "\u4e0a\u4f20",
  "\u53d1\u5e03"
];
const DIAGNOSE_TERMS = [
  "error",
  "failed",
  "failure",
  "exception",
  "stacktrace",
  "stack trace",
  "\u62a5\u9519",
  "\u5931\u8d25",
  "\u5f02\u5e38"
];
const SEARCH_TERMS = [
  "find",
  "locate",
  "where is",
  "search",
  "grep",
  "\u67e5\u627e",
  "\u641c\u7d22",
  "\u5728\u54ea"
];
const REVIEW_TERMS = [
  "review",
  "check",
  "inspect",
  "code review",
  "\u5ba1\u6838",
  "\u8bc4\u5ba1",
  "\u68c0\u67e5"
];
const REVIEW_HINT_PATTERNS = [
  /\b(?:code\s*review|review|inspect|audit)\b/i,
  /\u5ba1\u6838/,
  /\u5ba1\u6821/,
  /\u5ba1\u67e5/,
  /\u8bc4\u5ba1/,
  /\u4ee3\u7801\u68c0\u67e5/
];

export type TaskRouterOptions = {
  confidenceThreshold?: number;
  maxFiles?: number;
};

export function routeTaskIntent(input: string, options: TaskRouterOptions = {}): TaskIntent {
  const normalizedInput = normalizeIntentText(input);
  const text = normalizeInputText(normalizedInput);
  const maxFiles = Math.max(1, options.maxFiles ?? MAX_FILES);
  const confidenceThreshold = clampConfidence(options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD);

  if (!text) {
    return validateIntent({
      kind: "help",
      confidence: 0.9,
      summary: "Show command and task usage guidance."
    });
  }

  const dsl = /^\s*@dev\b/i.test(normalizedInput) ? parseDevCommand(normalizedInput) : null;
  if (dsl) {
    switch (dsl.kind) {
      case "help":
        return validateIntent(buildIntent("help", 0.98, text, []));
      case "status":
        return validateIntent(buildIntent("status", 0.98, text, []));
      case "plan":
        return validateIntent(buildIntent("explain", 0.92, dsl.prompt ?? text, [], {
          question: dsl.prompt ?? text
        }));
      case "patch":
        return validateIntent(buildIntent("change", 0.95, dsl.prompt ?? text, [], {
          changeRequest: dsl.prompt ?? text
        }));
      case "test":
        return validateIntent(buildIntent("run", 0.95, dsl.prompt ?? text, [], {
          cmd: sanitizeCmdInput(dsl.prompt ?? "")
        }));
      case "apply":
        return validateIntent(buildIntent("review", 0.88, text, [], {
          query: dsl.refId ? `apply ${dsl.refId}` : text
        }));
      case "task":
      default:
        break;
    }
  }

  const lower = text.toLowerCase();
  const files = sanitizeFilesInput(extractFileCandidates(text), maxFiles);
  const classifyText = buildClassificationText(lower);
  const explanationRequest = looksLikeExplanationRequest(classifyText);
  const directGitCommand = extractGitCommandCandidate(text);

  if (matchesAny(classifyText, DIAGNOSE_TERMS)) {
    return validateIntent(buildIntent("diagnose", 0.86, text, files, {
      changeRequest: text
    }));
  }
  if (matchesAny(classifyText, SEARCH_TERMS)) {
    return validateIntent(buildIntent("search", 0.85, text, files, {
      query: extractSearchQuery(text)
    }));
  }
  if (directGitCommand) {
    return validateIntent(buildIntent("run", 0.9, text, files, {
      cmd: sanitizeCmdInput(directGitCommand)
    }));
  }
  if (!explanationRequest && matchesGitSyncIntent(classifyText)) {
    return validateIntent(buildIntent("git_sync", 0.9, text, files, {
      mode: resolveGitSyncMode(text)
    }));
  }
  if (matchesReviewIntent(classifyText, text)) {
    return validateIntent(buildIntent("review", 0.84, text, files));
  }
  if (matchesAny(classifyText, CHANGE_TERMS)) {
    return validateIntent(buildIntent("change", 0.8, text, files, {
      changeRequest: text
    }));
  }
  if (matchesAny(classifyText, RUN_TERMS)) {
    return validateIntent(buildIntent("run", 0.82, text, files, {
      cmd: sanitizeCmdInput(extractRunCommandCandidate(text) || "")
    }));
  }
  if (matchesAny(classifyText, EXPLAIN_TERMS)) {
    return validateIntent(buildIntent("explain", 0.8, text, files, {
      question: text
    }));
  }
  if (matchesAny(classifyText, STATUS_TERMS)) {
    return validateIntent(buildIntent("status", 0.9, text, files));
  }
  if (matchesAny(classifyText, HELP_TERMS)) {
    return validateIntent(buildIntent("help", 0.92, text, files));
  }

  const fallbackKind: TaskKind = confidenceThreshold <= 0.45 ? "change" : "explain";
  const fallbackConfidence = 0.45;
  if (fallbackKind === "change") {
    return validateIntent(buildIntent("change", fallbackConfidence, text, files, {
      changeRequest: text
    }));
  }
  return validateIntent(buildIntent("explain", fallbackConfidence, text, files, {
    question: text
  }));
}

export function sanitizeCommandCandidate(candidate: string | undefined): string | undefined {
  if (!candidate) {
    return undefined;
  }
  const sanitized = sanitizeCmdInput(candidate);
  return sanitized || undefined;
}

export function sanitizeFiles(files: string[], maxFiles = MAX_FILES): string[] {
  return sanitizeFilesInput(files, maxFiles);
}

function normalizeInputText(input: string): string {
  return input.replace(DEV_PREFIX_REGEX, "").trim();
}

function buildClassificationText(input: string): string {
  return input
    .replace(FILE_PATH_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFileCandidates(input: string): string[] {
  const files: string[] = [];
  for (const match of input.matchAll(FILE_PATH_REGEX)) {
    const file = match[2]?.trim();
    if (file) {
      files.push(file);
    }
  }
  return files;
}

function matchesReviewIntent(classifyText: string, rawText: string): boolean {
  if (matchesAny(classifyText, REVIEW_TERMS)) {
    return true;
  }
  return REVIEW_HINT_PATTERNS.some((pattern) => pattern.test(rawText));
}

function buildIntent(
  kind: TaskKind,
  confidence: number,
  text: string,
  files: string[],
  params: NonNullable<TaskIntent["params"]> = {}
): TaskIntent {
  const nextParams: TaskIntent["params"] = {
    ...params,
    ...(files.length > 0 ? { files } : {})
  };
  return {
    kind,
    confidence: clampConfidence(confidence),
    summary: summarizeIntent(kind, text),
    params: Object.keys(nextParams).length > 0 ? nextParams : undefined
  };
}

function summarizeIntent(kind: TaskKind, text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return kind;
  }
  const preview = normalized.length > 80
    ? `${normalized.slice(0, 77)}...`
    : normalized;
  return `${kind}: ${preview}`;
}

function extractRunCommandCandidate(text: string): string | undefined {
  const trimmed = text.trim();
  const quoted = trimmed.match(/`([^`]+)`/)?.[1]?.trim();
  if (quoted) {
    return quoted;
  }

  const runLead = trimmed.match(
    /^(?:run|execute|test|build|lint|\u8fd0\u884c|\u6267\u884c|\u6d4b\u8bd5|\u7f16\u8bd1)\s*[:\uFF1A]?\s*(.+)$/i
  )?.[1]?.trim();
  if (runLead) {
    return runLead;
  }

  const inline = trimmed.match(
    /\b(?:run|execute|test|build|lint)\b\s+(.+)$/i
  )?.[1]?.trim();
  if (inline) {
    return inline;
  }
  return undefined;
}

function extractGitCommandCandidate(text: string): string | undefined {
  const trimmed = text.trim();
  const direct = trimmed.match(/^git\s+[^\r\n]+$/i)?.[0]?.trim();
  if (direct) {
    return direct;
  }
  const inline = text.match(
    /\bgit\s+(?:pull|fetch|remote\s+update)(?:\s+[^\s`"'\uFF0C\u3002\uFF1B;!?]+)*/i
  )?.[0]?.trim();
  if (!inline) {
    return undefined;
  }
  return inline.replace(/[\uFF0C\u3002\uFF1B;!?]+$/g, "");
}

function matchesGitSyncIntent(classifyText: string): boolean {
  if (!matchesAny(classifyText, GIT_TARGET_TERMS)) {
    return false;
  }
  return matchesAny(classifyText, GIT_SYNC_TERMS);
}

function resolveGitSyncMode(text: string): "sync" | "commit_only" | "push_only" {
  const normalized = normalizeIntentText(text);
  const lower = normalized.toLowerCase();
  const pushOnlyHint = /(?:\bonly\s+push\b|\bpush\s+only\b|\u53ea\u63a8\u9001|\u4ec5\u63a8\u9001|\u53ea\u4e0a\u4f20|\u4ec5\u4e0a\u4f20|\u4e0d\u8981\u63d0\u4ea4)/.test(normalized);
  if (pushOnlyHint) {
    return "push_only";
  }
  const commitOnlyHint = /(?:\bonly\s+commit\b|\bcommit\s+only\b|\u53ea\u63d0\u4ea4|\u4ec5\u63d0\u4ea4|\u4e0d\u8981\u63a8\u9001)/.test(normalized);
  if (commitOnlyHint) {
    return "commit_only";
  }
  const wantsPush = /\b(?:push|sync|synchronize|publish|upload)\b/i.test(lower)
    || /(?:\u63a8\u9001|\u540c\u6b65|\u4e0a\u4f20|\u53d1\u5e03)/.test(normalized);
  const wantsCommit = /\b(?:commit|提交)\b/i.test(normalized)
    || /(?:\u63d0\u4ea4)/.test(normalized);
  if (wantsCommit && !wantsPush) {
    return "commit_only";
  }
  if (wantsPush && !wantsCommit && !/\b(?:sync|synchronize)\b/i.test(lower) && !/\u540c\u6b65/.test(normalized)) {
    return "push_only";
  }
  return "sync";
}

function extractSearchQuery(text: string): string {
  const cleaned = text
    .replace(
      /\b(?:find|locate|where is|search|grep|\u67e5\u627e|\u641c\u7d22|\u5728\u54ea)\b[:\uFF1A]?\s*/gi,
      ""
    )
    .trim();
  return cleaned || text.trim();
}

function matchesAny(lowerInput: string, terms: readonly string[]): boolean {
  return terms.some((term) => matchesTerm(lowerInput, term));
}

function looksLikeExplanationRequest(input: string): boolean {
  if (matchesAny(input, EXPLAIN_TERMS)) {
    return true;
  }
  return /(?:\u600e\u4e48|\u5982\u4f55|\u4ec0\u4e48\u610f\u601d|\u662f\u4ec0\u4e48|\u662f\u5426)/.test(input);
}

function matchesTerm(lowerInput: string, term: string): boolean {
  const normalizedTerm = term.toLowerCase().trim();
  if (!normalizedTerm) {
    return false;
  }
  if (/^[a-z0-9 ]+$/.test(normalizedTerm)) {
    const spacedTerm = escapeRegex(normalizedTerm).replace(/\\ /g, "\\s+");
    return new RegExp(`\\b${spacedTerm}\\b`, "i").test(lowerInput);
  }
  return lowerInput.includes(normalizedTerm);
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampConfidence(input: number): number {
  if (!Number.isFinite(input)) {
    return DEFAULT_CONFIDENCE_THRESHOLD;
  }
  return Math.max(0, Math.min(1, input));
}

function normalizeIntentText(input: string): string {
  return input
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, " ");
}
