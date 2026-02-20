import { describe, expect, it } from "vitest";
import {
  parseNaturalLanguageTaskPrompt,
  resolveWeComCommandKind,
  sanitizeWeComSummary
} from "../src/router.js";

describe("parseNaturalLanguageTaskPrompt", () => {
  it("extracts natural language prompt after @dev", () => {
    expect(parseNaturalLanguageTaskPrompt("@dev fix login flow")).toBe("fix login flow");
  });

  it("supports @dev prefix with colon punctuation", () => {
    expect(parseNaturalLanguageTaskPrompt("@dev: fix login flow")).toBe("fix login flow");
    expect(parseNaturalLanguageTaskPrompt("@dev\uFF1Afix login flow")).toBe("fix login flow");
  });

  it("returns undefined for empty @dev body", () => {
    expect(parseNaturalLanguageTaskPrompt("@dev   ")).toBeUndefined();
  });

  it("uses non-prefixed text as task prompt", () => {
    expect(parseNaturalLanguageTaskPrompt("fix login flow")).toBe("fix login flow");
  });
});

describe("resolveWeComCommandKind", () => {
  it("keeps internal commands on native handlers", () => {
    expect(resolveWeComCommandKind("help")).toBe("help");
    expect(resolveWeComCommandKind("status")).toBe("status");
  });

  it("collapses non-internal command kinds to task", () => {
    expect(resolveWeComCommandKind("plan")).toBe("task");
    expect(resolveWeComCommandKind("patch")).toBe("task");
    expect(resolveWeComCommandKind("apply")).toBe("task");
    expect(resolveWeComCommandKind("test")).toBe("task");
    expect(resolveWeComCommandKind("task")).toBe("task");
    expect(resolveWeComCommandKind(undefined)).toBe("task");
  });
});

describe("sanitizeWeComSummary", () => {
  it("keeps multiline summaries readable with line breaks", () => {
    expect(sanitizeWeComSummary("line1\nline2\nline3")).toBe("line1\nline2\nline3");
  });

  it("filters diff metadata lines but keeps non-diff lines split", () => {
    const summary = [
      "Patch generated.",
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "Apply with local approval."
    ].join("\n");
    expect(sanitizeWeComSummary(summary)).toBe("Patch generated.\nApply with local approval.");
  });
});
