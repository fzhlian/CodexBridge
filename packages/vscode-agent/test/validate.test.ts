import { describe, expect, it } from "vitest";
import { sanitizeCmd, sanitizeFiles, validateIntent } from "../src/nl/validate.js";
import type { TaskIntent } from "../src/nl/taskTypes.js";

describe("validate.ts", () => {
  it("truncates and deduplicates files", () => {
    const files = sanitizeFiles(
      [
        "./src/a.ts",
        "src/a.ts",
        "src/b.ts",
        "../outside.ts",
        "/abs/path.ts",
        "src/c.ts",
        "src/d.ts",
        "src/e.ts",
        "src/f.ts",
        "src/g.ts",
        "src/h.ts",
        "src/i.ts",
        "src/j.ts",
        "src/k.ts"
      ],
      5
    );
    expect(files).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"]);
  });

  it("sanitizes command by dropping newlines and chaining", () => {
    expect(sanitizeCmd("pnpm test\n&& rm -rf /")).toBe("pnpm test");
    expect(sanitizeCmd("  npm run lint ; echo done")).toBe("npm run lint");
  });

  it("clamps confidence and validates kind", () => {
    const intent: TaskIntent = {
      kind: "run",
      confidence: 1.7,
      summary: "run tests",
      params: {
        cmd: "pnpm test && whoami",
        files: ["src/a.ts", "src/a.ts", "../oops.ts"]
      }
    };
    const normalized = validateIntent(intent);
    expect(normalized.confidence).toBe(1);
    expect(normalized.params?.cmd).toBe("pnpm test");
    expect(normalized.params?.files).toEqual(["src/a.ts"]);
  });

  it("rejects invalid kinds", () => {
    const badIntent = {
      kind: "unknown_kind",
      confidence: 0.3,
      summary: "bad"
    } as unknown as TaskIntent;
    expect(() => validateIntent(badIntent)).toThrow(/invalid task kind/i);
  });
});
