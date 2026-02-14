import { describe, expect, it } from "vitest";
import { runTestCommand } from "../src/test-runner.js";

describe("runTestCommand", () => {
  it("marks command as cancelled when abort signal triggers", async () => {
    const controller = new AbortController();
    const promise = runTestCommand('node -e "setTimeout(() => {}, 10000)"', controller.signal);
    setTimeout(() => controller.abort(), 100);
    const result = await promise;
    expect(result.cancelled).toBe(true);
  }, 15000);
});
