import type { CommandKind } from "./protocol.js";

export type ParsedDevCommand = {
  kind: CommandKind;
  prompt?: string;
  refId?: string;
};

const DEV_PREFIX = "@dev";
const UUID_LIKE_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const FILE_PATH_REGEX = /([A-Za-z0-9_./-]+\.[A-Za-z0-9_+-]+)/;
const BARE_REF_ID_REGEX = /^(?=.*[-_:])[a-z0-9][a-z0-9._:-]{2,}$/i;
const TRIM_PUNCTUATION_REGEX =
  /^[\uFF1A:\uFF0C,\u3002.\uFF01!\uFF1F?]+|[\uFF1A:\uFF0C,\u3002.\uFF01!\uFF1F?]+$/g;

const HELP_KEYWORDS = new Set([
  "help",
  "\u5e2e\u52a9",
  "\u5e2e\u5fd9",
  "\u8bf4\u660e",
  "\u7528\u6cd5",
  "\u547d\u4ee4\u5217\u8868",
  "\u6307\u4ee4\u5217\u8868"
]);
const STATUS_KEYWORDS = new Set([
  "status",
  "\u72b6\u6001",
  "\u8fd0\u884c\u72b6\u6001",
  "\u5728\u7ebf\u72b6\u6001",
  "\u5065\u5eb7\u68c0\u67e5",
  "health"
]);
const PLAN_KEYWORDS = new Set([
  "plan",
  "\u8ba1\u5212",
  "\u89c4\u5212",
  "\u65b9\u6848"
]);
const PATCH_KEYWORDS = new Set([
  "patch",
  "\u8865\u4e01",
  "\u4fee\u6539",
  "\u4fee\u590d",
  "\u4f18\u5316",
  "\u8c03\u6574",
  "\u65b0\u589e",
  "\u8ffd\u52a0"
]);
const APPLY_TERMS = [
  "apply",
  "\u5e94\u7528",
  "\u5e94\u7528\u8865\u4e01",
  "\u6267\u884c\u8865\u4e01",
  "\u5408\u5e76\u8865\u4e01",
  "\u6253\u8865\u4e01"
];
const APPLY_KEYWORDS = new Set(APPLY_TERMS);
const TEST_KEYWORDS = new Set([
  "test",
  "\u6d4b\u8bd5",
  "\u8dd1\u6d4b",
  "\u8dd1\u6d4b\u8bd5",
  "\u8fd0\u884c\u6d4b\u8bd5",
  "\u6267\u884c\u6d4b\u8bd5"
]);

const HELP_HINTS = [
  "\u5e2e\u52a9",
  "\u5e2e\u5fd9",
  "\u4f7f\u7528\u8bf4\u660e",
  "\u547d\u4ee4\u5217\u8868",
  "\u6307\u4ee4\u5217\u8868",
  "\u600e\u4e48\u7528"
];
const COMMAND_NOUNS = ["\u547d\u4ee4", "\u6307\u4ee4"];
const HELP_QUERY_HINTS = ["\u652f\u6301", "\u53ef\u7528", "\u54ea\u4e9b", "\u4ec0\u4e48", "\u5217\u8868"];
const STATUS_HINTS = [
  "\u72b6\u6001",
  "\u8fd0\u884c\u72b6\u6001",
  "\u5728\u7ebf\u72b6\u6001",
  "\u5065\u5eb7\u68c0\u67e5"
];
const STATUS_ACTION_HINTS = [
  "\u67e5\u770b",
  "\u770b\u770b",
  "\u67e5\u8be2",
  "\u68c0\u67e5",
  "\u73b0\u5728"
];
const POLITE_PREFIXES = ["\u8bf7", "\u9ebb\u70e6", "\u8bf7\u5e2e\u6211", "\u5e2e\u6211"];
const TEST_RUN_PREFIXES = ["\u8fd0\u884c", "\u6267\u884c", "\u8dd1", "\u8dd1\u4e0b", "\u8dd1\u4e00\u4e0b"];
const TEST_TERMS = [
  "test",
  "\u6d4b\u8bd5",
  "\u8dd1\u6d4b",
  "\u8dd1\u6d4b\u8bd5",
  "\u8fd0\u884c\u6d4b\u8bd5",
  "\u6267\u884c\u6d4b\u8bd5"
];
const TEST_FILLERS = new Set(["\u4e00\u4e0b", "\u4e0b"]);
const PATCH_HINTS = [
  "\u4fee\u6539",
  "\u4fee\u590d",
  "\u65b0\u589e",
  "\u8ffd\u52a0",
  "\u5220\u9664",
  "\u91cd\u547d\u540d",
  "\u4f18\u5316",
  "\u8c03\u6574",
  "\u6539\u6210",
  "\u6539\u4e3a",
  "\u8865\u5145"
];
const PATCH_TARGET_HINTS = [
  "\u6587\u4ef6",
  "\u4ee3\u7801",
  "README",
  "\u6587\u6863",
  "\u914d\u7f6e",
  "\u811a\u672c"
];
const APPLY_INTENT_REGEX = new RegExp(
  `(?:^|\\s)(?:${toAlternation(APPLY_TERMS)})(?:\\s|$)`,
  "i"
);
const APPLY_REF_REGEX = new RegExp(
  `(?:${toAlternation(APPLY_TERMS)})\\s*[:\\uFF1A]?\\s*([a-z0-9][a-z0-9._:-]{2,})`,
  "i"
);
const TEST_INTENT_REGEX = new RegExp(
  `^(?:${toAlternation(POLITE_PREFIXES)}\\s*)?(?:${toAlternation(TEST_RUN_PREFIXES)}\\s*)?`
  + `(?:${toAlternation(TEST_TERMS)})(?:\\s+(.*))?$`,
  "i"
);
const PATCH_START_REGEX = new RegExp(
  `^(?:${toAlternation(["patch", "\u8865\u4e01", ...PATCH_HINTS])})\\s+\\S+`,
  "i"
);

export function parseDevCommand(input: string): ParsedDevCommand | null {
  const raw = input.trim();
  const body = raw.startsWith(DEV_PREFIX) ? raw.slice(DEV_PREFIX.length).trim() : raw;
  if (!body) {
    return null;
  }

  const [keywordRaw, ...rest] = body.split(/\s+/);
  const keyword = normalizeKeyword(keywordRaw);
  const payload = rest.join(" ").trim();

  if (HELP_KEYWORDS.has(keyword)) {
    return { kind: "help" };
  }
  if (STATUS_KEYWORDS.has(keyword)) {
    return { kind: "status" };
  }
  if (TEST_KEYWORDS.has(keyword)) {
    return payload ? { kind: "test", prompt: payload } : { kind: "test" };
  }
  if (PLAN_KEYWORDS.has(keyword)) {
    return payload ? { kind: "plan", prompt: payload } : null;
  }
  if (PATCH_KEYWORDS.has(keyword)) {
    if (!payload) {
      return null;
    }
    if (keyword === "patch" || keyword === "\u8865\u4e01") {
      return { kind: "patch", prompt: payload };
    }
    return { kind: "patch", prompt: body };
  }
  if (APPLY_KEYWORDS.has(keyword)) {
    const refId = extractApplyRefId(payload || body, { allowBareRefId: true });
    return refId ? { kind: "apply", refId } : null;
  }

  const applyRefId = hasApplyIntent(body)
    ? extractApplyRefId(body, { allowBareRefId: true })
    : undefined;
  if (applyRefId) {
    return { kind: "apply", refId: applyRefId };
  }

  if (isLikelyHelpPrompt(body)) {
    return { kind: "help" };
  }
  if (isLikelyStatusPrompt(body)) {
    return { kind: "status" };
  }

  const testPrompt = extractTestPrompt(body);
  if (testPrompt !== undefined) {
    return testPrompt ? { kind: "test", prompt: testPrompt } : { kind: "test" };
  }

  if (isLikelyPatchPrompt(body)) {
    return { kind: "patch", prompt: body };
  }

  return null;
}

function normalizeKeyword(keyword: string): string {
  return keyword.trim().replace(TRIM_PUNCTUATION_REGEX, "").toLowerCase();
}

function hasApplyIntent(text: string): boolean {
  return APPLY_INTENT_REGEX.test(text);
}

function extractApplyRefId(
  text: string,
  options: { allowBareRefId?: boolean } = {}
): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  const byUuid = UUID_LIKE_REGEX.exec(trimmed)?.[0];
  if (byUuid) {
    return byUuid;
  }

  const byKeyword = APPLY_REF_REGEX.exec(trimmed)?.[1];
  if (byKeyword) {
    return byKeyword;
  }

  if (options.allowBareRefId && BARE_REF_ID_REGEX.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function isLikelyHelpPrompt(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\bhelp\b/.test(lower)) {
    return true;
  }
  if (containsAny(text, HELP_HINTS)) {
    return true;
  }
  return containsAny(text, COMMAND_NOUNS) && containsAny(text, HELP_QUERY_HINTS);
}

function isLikelyStatusPrompt(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\b(?:status|health)\b/.test(lower)) {
    return true;
  }
  if (containsAny(text, STATUS_HINTS)) {
    return true;
  }
  return containsAny(text, STATUS_ACTION_HINTS) && containsAny(text, STATUS_HINTS);
}

function extractTestPrompt(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  if (TEST_TERMS.some((term) => trimmed === `${term}\u4e00\u4e0b` || trimmed === `${term}\u4e0b`)) {
    return "";
  }
  const matched = TEST_INTENT_REGEX.exec(trimmed);
  if (!matched) {
    return undefined;
  }
  const payload = (matched[1] ?? "").trim();
  if (!payload || TEST_FILLERS.has(payload)) {
    return "";
  }
  return payload;
}

function isLikelyPatchPrompt(text: string): boolean {
  if (FILE_PATH_REGEX.test(text)) {
    return true;
  }
  if (PATCH_START_REGEX.test(text)) {
    return true;
  }
  if (containsAny(text, POLITE_PREFIXES) && containsAny(text, PATCH_HINTS)) {
    return true;
  }
  if (containsAny(text, PATCH_HINTS) && containsAny(text, PATCH_TARGET_HINTS)) {
    return true;
  }
  return false;
}

function containsAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function toAlternation(items: readonly string[]): string {
  return items.map((item) => escapeRegex(item)).join("|");
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
