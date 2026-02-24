import { describe, expect, it } from "vitest";
import { detectUnreadableTaskInput } from "../src/nl/inputReadability.js";

describe("detectUnreadableTaskInput", () => {
  it("accepts readable natural-language instructions", () => {
    expect(detectUnreadableTaskInput("同步此项目到github")).toBeUndefined();
    expect(detectUnreadableTaskInput("run pnpm test --filter @codexbridge/shared")).toBeUndefined();
  });

  it("rejects symbol-only noise", () => {
    expect(detectUnreadableTaskInput("???!!!@@@")).toBe("no_lexical_content");
  });

  it("rejects replacement-character corruption", () => {
    expect(detectUnreadableTaskInput("� � �")).toBe("contains_replacement_character");
  });

  it("rejects very low lexical density payloads", () => {
    expect(detectUnreadableTaskInput("a!@#$%^&*()")).toBe("low_lexical_density");
  });
});
