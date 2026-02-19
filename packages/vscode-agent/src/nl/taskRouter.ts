import type { TaskIntent, TaskKind } from "./taskTypes.js";
import { parseDevCommand } from "@codexbridge/shared";
import {
  sanitizeCmd as sanitizeCmdInput,
  sanitizeFiles as sanitizeFilesInput,
  validateIntent
} from "./validate.js";

const DEV_PREFIX_REGEX = /^\s*@dev\b[:：]?\s*/i;
const FILE_PATH_REGEX = /(^|[\s"'`])([A-Za-z0-9_./-]+\.[A-Za-z0-9_+-]+)(?=$|[\s"'`])/g;
const MAX_FILES = 10;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.55;

const HELP_TERMS = [
  "help",
  "usage",
  "how to use",
  "commands",
  "帮助",
  "命令列表",
  "怎么用"
];
const STATUS_TERMS = [
  "status",
  "health",
  "state",
  "状态",
  "健康检查",
  "运行状态"
];
const EXPLAIN_TERMS = [
  "why",
  "explain",
  "what does",
  "how does",
  "meaning",
  "解释",
  "为什么",
  "怎么回事"
];
const CHANGE_TERMS = [
  "fix",
  "implement",
  "refactor",
  "add",
  "change",
  "update",
  "修复",
  "实现",
  "重构",
  "新增",
  "修改",
  "调整"
];
const RUN_TERMS = [
  "run",
  "execute",
  "test",
  "build",
  "lint",
  "运行",
  "执行",
  "测试",
  "编译"
];
const DIAGNOSE_TERMS = [
  "error",
  "failed",
  "failure",
  "exception",
  "stacktrace",
  "stack trace",
  "报错",
  "失败",
  "异常"
];
const SEARCH_TERMS = [
  "find",
  "locate",
  "where is",
  "search",
  "grep",
  "查找",
  "搜索",
  "在哪"
];
const REVIEW_TERMS = [
  "review",
  "check",
  "inspect",
  "code review",
  "审查",
  "评审",
  "检查"
];

export type TaskRouterOptions = {
  confidenceThreshold?: number;
  maxFiles?: number;
};

export function routeTaskIntent(input: string, options: TaskRouterOptions = {}): TaskIntent {
  const text = normalizeInputText(input);
  const maxFiles = Math.max(1, options.maxFiles ?? MAX_FILES);
  const confidenceThreshold = clampConfidence(options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD);

  if (!text) {
    return validateIntent({
      kind: "help",
      confidence: 0.9,
      summary: "Show command and task usage guidance."
    });
  }

  const dsl = /^\s*@dev\b/i.test(input) ? parseDevCommand(input) : null;
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
  if (matchesAny(classifyText, REVIEW_TERMS)) {
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
    /^(?:run|execute|test|build|lint|运行|执行|测试|编译)\s*[:：]?\s*(.+)$/i
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

function extractSearchQuery(text: string): string {
  const cleaned = text
    .replace(
      /\b(?:find|locate|where is|search|grep|查找|搜索|在哪)\b[:：]?\s*/gi,
      ""
    )
    .trim();
  return cleaned || text.trim();
}

function matchesAny(lowerInput: string, terms: readonly string[]): boolean {
  return terms.some((term) => matchesTerm(lowerInput, term));
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
