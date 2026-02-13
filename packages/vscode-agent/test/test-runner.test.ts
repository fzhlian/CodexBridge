import { describe, expect, it } from "vitest";
import { runTestCommand } from "../src/test-runner.js";

describe("runTestCommand", () => {
  it("marks command as cancelled when abort signal triggers", async () => {
    const controller = new AbortController();
    const promise = runTestCommand("ping 127.0.0.1 -n 6 >NUL", controller.signal);
    setTimeout(() => controller.abort(), 100);
    const result = await promise;
    expect(result.cancelled).toBe(true);
  });
});

