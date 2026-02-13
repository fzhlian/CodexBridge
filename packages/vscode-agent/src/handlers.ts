import path from "node:path";
import process from "node:process";
import type { CommandEnvelope, ResultEnvelope } from "@codexbridge/shared";
import { PatchCache } from "./patch-cache.js";
import { requireLocalConfirmation } from "./local-confirmation.js";
import { applyUnifiedDiff } from "./patch-apply.js";
import { generatePatchFromCodex } from "./codex-patch.js";
import type { RuntimeContextSnapshot } from "./context.js";
import {
  getDefaultTestCommand,
  isAllowedTestCommand,
  runTestCommand
} from "./test-runner.js";

const patchCache = new PatchCache();
const workspaceRoot = process.env.WORKSPACE_ROOT ?? process.cwd();

export type CommandExecutionContext = {
  signal?: AbortSignal;
  runtimeContext?: RuntimeContextSnapshot;
};

export async function handleCommand(
  command: CommandEnvelope,
  context: CommandExecutionContext = {}
): Promise<ResultEnvelope> {
  if (context.signal?.aborted) {
    return cancelled(command, "command cancelled before execution");
  }

  switch (command.kind) {
    case "help":
      return {
        commandId: command.commandId,
        machineId: command.machineId,
        status: "ok",
        summary: "supported: help, status, plan, patch, apply, test",
        createdAt: new Date().toISOString()
      };
    case "status":
      return {
        commandId: command.commandId,
        machineId: command.machineId,
        status: "ok",
        summary: `workspace=${workspaceRoot} platform=${process.platform} node=${process.version}`,
        createdAt: new Date().toISOString()
      };
    case "patch": {
      if (!command.prompt?.trim()) {
        return {
          commandId: command.commandId,
          machineId: command.machineId,
          status: "error",
          summary: "patch missing prompt",
          createdAt: new Date().toISOString()
        };
      }

      let generated: { diff: string; summary: string };
      try {
        generated = await generatePatchFromCodex(
          command.prompt,
          workspaceRoot,
          context.runtimeContext
        );
      } catch (error) {
        if (context.signal?.aborted) {
          return cancelled(command, "patch generation cancelled");
        }
        const detail = error instanceof Error ? error.message : "unknown codex error";
        return {
          commandId: command.commandId,
          machineId: command.machineId,
          status: "error",
          summary: `codex patch generation failed: ${detail}`,
          createdAt: new Date().toISOString()
        };
      }

      if (!looksLikeUnifiedDiff(generated.diff)) {
        return {
          commandId: command.commandId,
          machineId: command.machineId,
          status: "error",
          summary: "codex returned invalid patch format",
          createdAt: new Date().toISOString()
        };
      }

      const maxDiffBytes = Number(process.env.MAX_DIFF_BYTES ?? "200000");
      if (Buffer.byteLength(generated.diff, "utf8") > maxDiffBytes) {
        return {
          commandId: command.commandId,
          machineId: command.machineId,
          status: "rejected",
          summary: `patch too large; max ${maxDiffBytes} bytes`,
          createdAt: new Date().toISOString()
        };
      }

      const diff = generated.diff;
      patchCache.set(command.commandId, diff);
      return {
        commandId: command.commandId,
        machineId: command.machineId,
        status: "ok",
        summary: generated.summary,
        diff,
        createdAt: new Date().toISOString()
      };
    }
    case "apply": {
      if (!command.refId) {
        return {
          commandId: command.commandId,
          machineId: command.machineId,
          status: "error",
          summary: "apply missing refId",
          createdAt: new Date().toISOString()
        };
      }
      const diff = patchCache.get(command.refId);
      if (!diff) {
        return {
          commandId: command.commandId,
          machineId: command.machineId,
          status: "error",
          summary: `no cached patch found for refId=${command.refId}`,
          createdAt: new Date().toISOString()
        };
      }

      const approved = await requireLocalConfirmation(
        `Apply patch ${command.refId} to workspace ${path.basename(workspaceRoot)}?`
      );
      if (!approved) {
        return {
          commandId: command.commandId,
          machineId: command.machineId,
          status: "rejected",
          summary: "apply rejected by local user",
          createdAt: new Date().toISOString()
        };
      }

      const changedPaths = await applyUnifiedDiff(diff, workspaceRoot);
      if (context.signal?.aborted) {
        return cancelled(command, "apply cancelled");
      }
      return {
        commandId: command.commandId,
        machineId: command.machineId,
        status: "ok",
        summary: `apply completed: ${changedPaths.join(", ")}`,
        createdAt: new Date().toISOString()
      };
    }
    case "test": {
      const testCommand = command.prompt?.trim() || getDefaultTestCommand();
      if (!isAllowedTestCommand(testCommand)) {
        return {
          commandId: command.commandId,
          machineId: command.machineId,
          status: "rejected",
          summary: `test command not allowed: ${testCommand}`,
          createdAt: new Date().toISOString()
        };
      }

      const approved = await requireLocalConfirmation(`Execute test command: ${testCommand}?`);
      if (!approved) {
        return {
          commandId: command.commandId,
          machineId: command.machineId,
          status: "rejected",
          summary: "test execution rejected by local user",
          createdAt: new Date().toISOString()
        };
      }

      const result = await runTestCommand(testCommand, context.signal);
      if (result.cancelled) {
        return cancelled(command, `test cancelled: ${testCommand}`);
      }
      if (result.timedOut) {
        return {
          commandId: command.commandId,
          machineId: command.machineId,
          status: "error",
          summary: `test timed out: ${testCommand}\n${result.outputTail}`,
          createdAt: new Date().toISOString()
        };
      }

      const status = result.code === 0 ? "ok" : "error";
      return {
        commandId: command.commandId,
        machineId: command.machineId,
        status,
        summary: `test exit=${result.code} command=${testCommand}\n${result.outputTail}`,
        createdAt: new Date().toISOString()
      };
    }
    case "plan":
      return {
        commandId: command.commandId,
        machineId: command.machineId,
        status: "ok",
        summary: command.prompt ? `plan request accepted: ${command.prompt}` : "plan request accepted",
        createdAt: new Date().toISOString()
      };
    default:
      return {
        commandId: command.commandId,
        machineId: command.machineId,
        status: "error",
        summary: "unknown command",
        createdAt: new Date().toISOString()
      };
  }
}

function cancelled(command: CommandEnvelope, summary: string): ResultEnvelope {
  return {
    commandId: command.commandId,
    machineId: command.machineId,
    status: "cancelled",
    summary,
    createdAt: new Date().toISOString()
  };
}

function looksLikeUnifiedDiff(diff: string): boolean {
  return (
    diff.includes("diff --git") ||
    (diff.includes("\n--- ") && diff.includes("\n+++ ")) ||
    (diff.startsWith("--- ") && diff.includes("\n+++ "))
  );
}
