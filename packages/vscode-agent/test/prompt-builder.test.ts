import { describe, expect, it } from "vitest";
import { buildIntentPrompt, resolvePromptMode } from "../src/nl/promptBuilder.js";
import type { TaskIntent } from "../src/nl/taskTypes.js";

describe("promptBuilder", () => {
  it("includes intent summary and context in explain mode", () => {
    const intent: TaskIntent = {
      kind: "explain",
      confidence: 0.9,
      summary: "explain auth middleware behavior",
      params: {
        question: "Why does auth middleware return 401?"
      }
    };
    const built = buildIntentPrompt({
      mode: "explain",
      intent,
      requestText: "explain auth middleware",
      renderedContext: "Active file: src/auth/middleware.ts\nfunction auth() {}"
    });
    expect(built.mode).toBe("explain");
    expect(built.prompt).toContain("Intent summary: explain auth middleware behavior");
    expect(built.prompt).toContain("Context block (bounded):");
    expect(built.prompt).toContain("src/auth/middleware.ts");
  });

  it("enforces diff-only output rules for change and diagnose intents", () => {
    const intent: TaskIntent = {
      kind: "change",
      confidence: 0.8,
      summary: "fix login null pointer",
      params: {
        changeRequest: "fix null pointer in src/auth/service.ts"
      }
    };
    const built = buildIntentPrompt({
      mode: "diff-only",
      intent,
      requestText: "fix login null pointer",
      renderedContext: "FILE src/auth/service.ts\nexport function login() {}"
    });
    expect(resolvePromptMode(intent)).toBe("diff-only");
    expect(built.prompt).toContain("Return ONLY unified diff content");
    expect(built.prompt).toContain("Never execute commands");
    expect(built.prompt).toContain("Do not include markdown fences.");
    expect(built.prompt).toContain("Intent summary: fix login null pointer");
  });

  it("truncates oversized context blocks", () => {
    const intent: TaskIntent = {
      kind: "diagnose",
      confidence: 0.7,
      summary: "diagnose flaky tests"
    };
    const context = `header\n${"x".repeat(500)}`;
    const built = buildIntentPrompt({
      mode: "diff-only",
      intent,
      requestText: "diagnose flaky tests",
      renderedContext: context,
      maxContextChars: 80
    });
    expect(built.prompt).toContain("...[truncated]");
    expect(built.prompt).toContain("Intent kind: diagnose");
  });
});
