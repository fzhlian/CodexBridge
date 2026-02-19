import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildChatExecCommandArgs,
  CodexChatFallbackError,
  isChatExecFallbackEnabled,
  isChatExecUnsafeBypassEnabled,
  parseCommandExecTextResponse
} from "../src/codex/codexClientFacade.js";

describe("codex chat exec fallback", () => {
  it("keeps fallback and unsafe bypass opt-in by default", () => {
    expect(isChatExecFallbackEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isChatExecFallbackEnabled({
        CODEX_CHAT_ENABLE_EXEC_FALLBACK: "1"
      } as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(isChatExecUnsafeBypassEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isChatExecUnsafeBypassEnabled({
        CODEX_CHAT_EXEC_BYPASS_APPROVALS_AND_SANDBOX: "true"
      } as NodeJS.ProcessEnv)
    ).toBe(true);
  });

  it("adds dangerous bypass flag only when explicitly enabled", () => {
    const safe = buildChatExecCommandArgs({
      command: "codex",
      cwd: "D:\\workspace",
      outputPath: "D:\\tmp\\out.txt",
      prompt: "hello",
      unsafeBypassEnabled: false
    });
    expect(safe).not.toContain("--dangerously-bypass-approvals-and-sandbox");

    const unsafe = buildChatExecCommandArgs({
      command: "codex",
      cwd: "D:\\workspace",
      outputPath: "D:\\tmp\\out.txt",
      prompt: "hello",
      unsafeBypassEnabled: true
    });
    expect(unsafe).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("throws structured error when command/exec response has no assistant text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codexbridge-chat-fallback-"));
    const outputPath = path.join(root, "empty.txt");
    await writeFile(outputPath, "", "utf8");
    const prevFallback = process.env.CODEX_CHAT_ENABLE_EXEC_FALLBACK;
    const prevUnsafe = process.env.CODEX_CHAT_EXEC_BYPASS_APPROVALS_AND_SANDBOX;
    process.env.CODEX_CHAT_ENABLE_EXEC_FALLBACK = "1";
    process.env.CODEX_CHAT_EXEC_BYPASS_APPROVALS_AND_SANDBOX = "0";
    try {
      await expect(
        parseCommandExecTextResponse(
          {
            exitCode: 0,
            stdout: "",
            stderr: "",
            foo: "bar"
          },
          outputPath
        )
      ).rejects.toBeInstanceOf(CodexChatFallbackError);

      try {
        await parseCommandExecTextResponse(
          {
            exitCode: 0,
            stdout: "",
            stderr: "",
            foo: "bar"
          },
          outputPath
        );
      } catch (error) {
        const typed = error as CodexChatFallbackError;
        expect(typed.details.code).toBe("missing_assistant_message");
        expect(typed.details.responseKeys).toContain("foo");
      }
    } finally {
      if (prevFallback === undefined) {
        delete process.env.CODEX_CHAT_ENABLE_EXEC_FALLBACK;
      } else {
        process.env.CODEX_CHAT_ENABLE_EXEC_FALLBACK = prevFallback;
      }
      if (prevUnsafe === undefined) {
        delete process.env.CODEX_CHAT_EXEC_BYPASS_APPROVALS_AND_SANDBOX;
      } else {
        process.env.CODEX_CHAT_EXEC_BYPASS_APPROVALS_AND_SANDBOX = prevUnsafe;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});
