import { describe, expect, it } from "vitest";
import { parseNaturalLanguageTaskPrompt } from "../src/router.js";

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