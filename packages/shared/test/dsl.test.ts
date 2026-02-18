import { describe, expect, it } from "vitest";
import { parseDevCommand } from "../src/dsl.js";

const zhHelp = "\u5e2e\u52a9";
const zhCommandList = "\u547d\u4ee4\u5217\u8868";
const zhHelpQuery = "\u4f60\u652f\u6301\u54ea\u4e9b\u547d\u4ee4\uff1f";
const zhStatusQuery = "\u67e5\u770b\u8fd0\u884c\u72b6\u6001";
const zhPlan = "\u89c4\u5212 \u6838\u5fc3\u6a21\u5757\u91cd\u6784\u65b9\u6848";
const zhPatch = "\u4fee\u590d README.md \u7684\u9519\u522b\u5b57";
const zhPatchNatural =
  "\u8bf7\u4fee\u6539 README.md\uff0c\u5728\u6587\u4ef6\u672b\u5c3e\u8ffd\u52a0\u4e00\u53e5\uff1a"
  + "\u901a\u8fc7\u4f01\u4e1a\u5fae\u4fe1\u89e6\u53d1\u4fee\u6539\u3002";
const zhApply = "\u5e94\u7528\u8865\u4e01 cmd-123";
const zhRunApply = "\u6267\u884c\u8865\u4e01 fc3949f3-c96f-4f3a-af61-94950652a9a8";
const zhRunTest = "\u8fd0\u884c\u6d4b\u8bd5 pnpm -r test";
const zhTestOnce = "\u6d4b\u8bd5\u4e00\u4e0b";

describe("parseDevCommand", () => {
  it("parses help command", () => {
    expect(parseDevCommand("@dev help")).toEqual({ kind: "help" });
  });

  it("parses chinese help aliases", () => {
    expect(parseDevCommand(zhHelp)).toEqual({ kind: "help" });
    expect(parseDevCommand(zhCommandList)).toEqual({ kind: "help" });
    expect(parseDevCommand(zhHelpQuery)).toEqual({ kind: "help" });
  });

  it("parses status aliases", () => {
    expect(parseDevCommand("  @dev   status  ")).toEqual({ kind: "status" });
    expect(parseDevCommand(zhStatusQuery)).toEqual({ kind: "status" });
  });

  it("parses plan aliases", () => {
    expect(parseDevCommand("@dev plan split module")).toEqual({
      kind: "plan",
      prompt: "split module"
    });
    expect(parseDevCommand(zhPlan)).toEqual({
      kind: "plan",
      prompt: "\u6838\u5fc3\u6a21\u5757\u91cd\u6784\u65b9\u6848"
    });
  });

  it("parses patch prompt", () => {
    expect(parseDevCommand("@dev patch fix login bug")).toEqual({
      kind: "patch",
      prompt: "fix login bug"
    });
  });

  it("parses chinese patch aliases", () => {
    expect(parseDevCommand(zhPatch)).toEqual({
      kind: "patch",
      prompt: zhPatch
    });
    expect(parseDevCommand(zhPatchNatural)).toEqual({
      kind: "patch",
      prompt: zhPatchNatural
    });
  });

  it("parses apply ref id and aliases", () => {
    expect(parseDevCommand("@dev apply cmd-123")).toEqual({
      kind: "apply",
      refId: "cmd-123"
    });
    expect(parseDevCommand(zhApply)).toEqual({
      kind: "apply",
      refId: "cmd-123"
    });
    expect(parseDevCommand(zhRunApply)).toEqual({
      kind: "apply",
      refId: "fc3949f3-c96f-4f3a-af61-94950652a9a8"
    });
  });

  it("parses test aliases", () => {
    expect(parseDevCommand("@dev test pnpm -r test")).toEqual({
      kind: "test",
      prompt: "pnpm -r test"
    });
    expect(parseDevCommand(zhRunTest)).toEqual({
      kind: "test",
      prompt: "pnpm -r test"
    });
    expect(parseDevCommand(zhTestOnce)).toEqual({
      kind: "test"
    });
  });

  it("returns null for non command text", () => {
    expect(parseDevCommand("hello")).toBeNull();
  });

  it("returns null for missing payload", () => {
    expect(parseDevCommand("@dev patch")).toBeNull();
    expect(parseDevCommand("\u8ba1\u5212")).toBeNull();
  });
});
