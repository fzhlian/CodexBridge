import { describe, expect, it } from "vitest";
import {
  ModelRouterStrictError,
  routeTaskIntentWithModel
} from "../src/nl/modelRouter.js";

describe("routeTaskIntentWithModel", () => {
  it("normalizes sync requests to git_sync when model output is valid", async () => {
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
    expect(result.intent.kind).toBe("git_sync");
    expect(result.intent.params?.mode).toBe("sync");
  });

  it("infers git_sync mode when model returns run without mode for sync-to-github", async () => {
    const result = await routeTaskIntentWithModel(
      "\u540c\u6b65\u9879\u76ee\u5230github",
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
    expect(result.intent.kind).toBe("git_sync");
    expect(result.intent.params?.mode).toBe("sync");
  });

  it("overrides model-provided push_only mode for generic sync request", async () => {
    const result = await routeTaskIntentWithModel(
      "\u540c\u6b65github",
      { confidenceThreshold: 0.55 },
      {
        codex: {
          completeWithStreaming: async () => JSON.stringify({
            kind: "git_sync",
            confidence: 0.92,
            summary: "sync repo",
            params: {
              mode: "push_only"
            }
          })
        }
      }
    );
    expect(result.source).toBe("model");
    expect(result.intent.kind).toBe("git_sync");
    expect(result.intent.params?.mode).toBe("sync");
  });

  it("keeps git_sync routing even when confidence is below threshold", async () => {
    const result = await routeTaskIntentWithModel(
      "\u540c\u6b65\u9879\u76ee\u5230github",
      { confidenceThreshold: 0.99, strict: true },
      {
        codex: {
          completeWithStreaming: async () => JSON.stringify({
            kind: "explain",
            confidence: 0.2,
            summary: "sync to github"
          })
        }
      }
    );
    expect(result.source).toBe("model");
    expect(result.intent.kind).toBe("git_sync");
    expect(result.intent.params?.mode).toBe("sync");
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

  it("forces git_sync intent for github sync even when model returns explain", async () => {
    const result = await routeTaskIntentWithModel(
      "sync github repository",
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
    );
    expect(result.source).toBe("model");
    expect(result.intent.kind).toBe("git_sync");
    expect(result.intent.params?.mode).toBe("sync");
  });

  it("keeps explain intent for explanatory git sync question", async () => {
    const result = await routeTaskIntentWithModel(
      "explain how to sync github repository",
      { confidenceThreshold: 0.55, strict: true },
      {
        codex: {
          completeWithStreaming: async () => JSON.stringify({
            kind: "explain",
            confidence: 0.95,
            summary: "Explain sync flow"
          })
        }
      }
    );
    expect(result.source).toBe("model");
    expect(result.intent.kind).toBe("explain");
  });

  it("normalizes full-width github text when inferring git_sync mode", async () => {
    const result = await routeTaskIntentWithModel(
      "\u540c\u6b65 \uFF27\uFF49\uFF54\uFF28\uFF55\uFF42 \u4ed3\u5e93",
      { confidenceThreshold: 0.55 },
      {
        codex: {
          completeWithStreaming: async () => JSON.stringify({
            kind: "run",
            confidence: 0.91,
            summary: "sync repo"
          })
        }
      }
    );
    expect(result.source).toBe("model");
    expect(result.intent.kind).toBe("git_sync");
    expect(result.intent.params?.mode).toBe("sync");
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

