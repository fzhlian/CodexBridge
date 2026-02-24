import { describe, expect, it } from "vitest";
import {
  buildCommandHandshakeMessage,
  parseNaturalLanguageTaskPrompt,
  resolveMachineNotifyUser,
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

  it("removes ansi/control characters from failure output", () => {
    const summary = "Build failed:\u001b[31m ERR \u001b[0mline\u0007\nnext step";
    expect(sanitizeWeComSummary(summary)).toBe("Build failed: ERR line\nnext step");
  });
});

describe("buildCommandHandshakeMessage", () => {
  it("returns localized help content for zh locale", () => {
    const text = buildCommandHandshakeMessage({
      commandId: "cmd-1",
      machineId: "dev-machine-1",
      userId: "u1",
      kind: "help",
      createdAt: new Date().toISOString()
    }, "zh-CN");
    expect(text).not.toContain("Command help");
  });

  it("keeps handshake wording for non-help commands in en locale", () => {
    const text = buildCommandHandshakeMessage({
      commandId: "cmd-2",
      machineId: "dev-machine-1",
      userId: "u1",
      kind: "task",
      createdAt: new Date().toISOString()
    }, "en");
    expect(text).toContain("Command received and dispatched to local agent.");
  });

  it("uses provided locale instead of command prompt language", () => {
    const text = buildCommandHandshakeMessage({
      commandId: "cmd-3",
      machineId: "dev-machine-1",
      userId: "u1",
      kind: "task",
      prompt: "sync repository to github",
      createdAt: new Date().toISOString()
    }, "zh-CN");
    expect(text).not.toContain("Command received and dispatched to local agent.");
  });
});

describe("resolveMachineNotifyUser", () => {
  it("prefers the single bound user for machine", () => {
    const machineBindings = new Map<string, string>([
      ["u1", "m1"],
      ["u2", "m2"]
    ]);
    expect(resolveMachineNotifyUser("m1", machineBindings, [])).toBe("u1");
  });

  it("uses recent active user when multiple users bind to one machine", () => {
    const machineBindings = new Map<string, string>([
      ["u1", "m1"],
      ["u2", "m1"]
    ]);
    const recent = [
      { userId: "u2" },
      { userId: "u1" }
    ];
    expect(resolveMachineNotifyUser("m1", machineBindings, recent)).toBe("u2");
  });

  it("falls back to recent machine user when no bindings exist", () => {
    const machineBindings = new Map<string, string>();
    const recent = [
      { userId: "u9" }
    ];
    expect(resolveMachineNotifyUser("m1", machineBindings, recent)).toBe("u9");
  });
});
