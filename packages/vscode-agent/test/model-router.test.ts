import { describe, expect, it } from "vitest";
import {
  ModelRouterStrictError,
  routeTaskIntentWithModel
} from "../src/nl/modelRouter.js";

describe("routeTaskIntentWithModel", () => {
  it("uses model intent when json is valid and confidence is high", async () => {
    const result = await routeTaskIntentWithModel(
      "sync github repo",
      { confidenceThreshold: 0.55 },
      {
        codex: {
          completeWithStreaming: async () => JSON.stringify({
            kind: "run",
            confidence: 0.91,
            summary: "sync repository",
            params: {
              cmd: "git push"
            }
          })
        }
      }
    );
    expect(result.source).toBe("model");
    expect(result.intent.kind).toBe("run");
    expect(result.intent.params?.cmd).toBe("git push");
  });

  it("infers git push command when model returns run without cmd for sync-to-github", async () => {
    const result = await routeTaskIntentWithModel(
      "请同步到 github",
      { confidenceThreshold: 0.55 },
      {
        codex: {
          completeWithStreaming: async () => JSON.stringify({
            kind: "run",
            confidence: 0.91,
            summary: "sync to github"
          })
        }
      }
    );
    expect(result.source).toBe("model");
    expect(result.intent.kind).toBe("run");
    expect(result.intent.params?.cmd).toBe("git push");
  });

  it("parses fenced json payloads from model response", async () => {
    const result = await routeTaskIntentWithModel(
      "review latest patch",
      { confidenceThreshold: 0.55 },
      {
        codex: {
          completeWithStreaming: async () => [
            "```json",
            "{",
            "  \"kind\": \"review\",",
            "  \"confidence\": 0.88,",
            "  \"summary\": \"review latest patch\"",
            "}",
            "```"
          ].join("\n")
        }
      }
    );
    expect(result.source).toBe("model");
    expect(result.intent.kind).toBe("review");
  });

  it("falls back to deterministic router when confidence is low", async () => {
    const result = await routeTaskIntentWithModel(
      "run pnpm test",
      { confidenceThreshold: 0.8 },
      {
        codex: {
          completeWithStreaming: async () => JSON.stringify({
            kind: "run",
            confidence: 0.6,
            summary: "low confidence run",
            params: {
              cmd: "pnpm test"
            }
          })
        }
      }
    );
    expect(result.source).toBe("deterministic_fallback");
    expect(result.intent.kind).toBe("run");
    expect(result.reason).toContain("low_confidence");
  });

  it("falls back to deterministic router when model output is invalid", async () => {
    const result = await routeTaskIntentWithModel(
      "fix auth bug",
      { confidenceThreshold: 0.55 },
      {
        codex: {
          completeWithStreaming: async () => "not-json-response"
        }
      }
    );
    expect(result.source).toBe("deterministic_fallback");
    expect(result.intent.kind).toBe("change");
    expect(result.reason).toBe("invalid_model_output");
  });

  it("throws in strict mode when model output is invalid", async () => {
    await expect(
      routeTaskIntentWithModel(
        "fix auth bug",
        { confidenceThreshold: 0.55, strict: true },
        {
          codex: {
            completeWithStreaming: async () => "not-json-response"
          }
        }
      )
    ).rejects.toBeInstanceOf(ModelRouterStrictError);
  });

  it("captures raw model output in strict error details when debug flag is enabled", async () => {
    try {
      await routeTaskIntentWithModel(
        "fix auth bug",
        {
          confidenceThreshold: 0.55,
          strict: true,
          attachRawOutputOnStrictFailure: true
        },
        {
          codex: {
            completeWithStreaming: async () => "not-json-response"
          }
        }
      );
      throw new Error("expected strict mode to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRouterStrictError);
      const typed = error as ModelRouterStrictError;
      expect(typed.details.source).toBe("model_router_strict");
      expect(typed.details.reason).toBe("invalid_model_output");
      expect(typed.details.rawModelOutput).toBe("not-json-response");
    }
  });

  it("throws in strict mode when model confidence is low", async () => {
    try {
      await routeTaskIntentWithModel(
        "run pnpm test",
        {
          confidenceThreshold: 0.8,
          strict: true,
          attachRawOutputOnStrictFailure: true
        },
        {
          codex: {
            completeWithStreaming: async () => JSON.stringify({
              kind: "run",
              confidence: 0.6,
              summary: "low confidence run",
              params: {
                cmd: "pnpm test"
              }
            })
          }
        }
      );
      throw new Error("expected strict mode to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRouterStrictError);
      const typed = error as ModelRouterStrictError;
      expect(typed.details.reason).toContain("low_confidence");
      expect(typed.details.confidence).toBe(0.6);
      expect(typed.details.confidenceThreshold).toBe(0.8);
      expect(typeof typed.details.rawModelOutput).toBe("string");
    }
  });

  it("keeps raw model output out of strict error details when debug flag is disabled", async () => {
    try {
      await routeTaskIntentWithModel(
        "run pnpm test",
        { confidenceThreshold: 0.8, strict: true },
        {
          codex: {
            completeWithStreaming: async () => JSON.stringify({
              kind: "run",
              confidence: 0.6,
              summary: "low confidence run",
              params: {
                cmd: "pnpm test"
              }
            })
          }
        }
      );
      throw new Error("expected strict mode to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRouterStrictError);
      const typed = error as ModelRouterStrictError;
      expect(typed.details.rawModelOutput).toBeUndefined();
    }
  });

  it("throws in strict mode when model misclassifies explicit execution intent", async () => {
    await expect(
      routeTaskIntentWithModel(
        "请同步到 github",
        { confidenceThreshold: 0.55, strict: true },
        {
          codex: {
            completeWithStreaming: async () => JSON.stringify({
              kind: "explain",
              confidence: 0.95,
              summary: "Explains git synchronization flow"
            })
          }
        }
      )
    ).rejects.toBeInstanceOf(ModelRouterStrictError);
  });

  it("throws in strict mode when model confidence is low", async () => {
    await expect(
      routeTaskIntentWithModel(
        "run pnpm test",
        { confidenceThreshold: 0.8, strict: true },
        {
          codex: {
            completeWithStreaming: async () => JSON.stringify({
              kind: "run",
              confidence: 0.6,
              summary: "low confidence run",
              params: {
                cmd: "pnpm test"
              }
            })
          }
        }
      )
    ).rejects.toBeInstanceOf(ModelRouterStrictError);
  });

  it("sanitizes dangerous shell fragments in model params", async () => {
    const result = await routeTaskIntentWithModel(
      "run tests",
      { confidenceThreshold: 0.55 },
      {
        codex: {
          completeWithStreaming: async () => JSON.stringify({
            kind: "run",
            confidence: 0.95,
            summary: "run tests",
            params: {
              cmd: "pnpm test && rm -rf /"
            }
          })
        }
      }
    );
    expect(result.source).toBe("model");
    expect(result.intent.params?.cmd).toBe("pnpm test");
  });
});
