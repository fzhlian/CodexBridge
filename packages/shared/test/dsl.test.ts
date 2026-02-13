import { describe, expect, it } from "vitest";
import { parseDevCommand } from "../src/dsl.js";

describe("parseDevCommand", () => {
  it("parses help", () => {
    expect(parseDevCommand("@dev help")).toEqual({ kind: "help" });
  });

  it("parses status with whitespace", () => {
    expect(parseDevCommand("  @dev   status  ")).toEqual({ kind: "status" });
  });

  it("parses patch prompt", () => {
    expect(parseDevCommand("@dev patch fix login bug")).toEqual({
      kind: "patch",
      prompt: "fix login bug"
    });
  });

  it("parses apply ref id", () => {
    expect(parseDevCommand("@dev apply cmd-123")).toEqual({
      kind: "apply",
      refId: "cmd-123"
    });
  });

  it("returns null for non-dev messages", () => {
    expect(parseDevCommand("hello")).toBeNull();
  });

  it("parses test with optional command", () => {
    expect(parseDevCommand("@dev test pnpm -r test")).toEqual({
      kind: "test",
      prompt: "pnpm -r test"
    });
  });

  it("returns null for missing payload", () => {
    expect(parseDevCommand("@dev patch")).toBeNull();
  });
});
