import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import type { CommandEnvelope, ResultEnvelope } from "@codexbridge/shared";
import { PatchCache } from "./patch-cache.js";
import { requireLocalConfirmation } from "./local-confirmation.js";
import { applyUnifiedDiff } from "./patch-apply.js";
import { generatePatchFromCodex } from "./codex-patch.js";
import type { RuntimeContextSnapshot } from "./context.js";
import type { CloudflaredRuntimeInfo } from "./cloudflared.js";
import { inspectCloudflaredRuntime } from "./cloudflared.js";
import { resolveOutboundIp } from "./network.js";
import {
  getDefaultTestCommand,
  isAllowedTestCommand,
  runTestCommand
} from "./test-runner.js";

const patchCache = new PatchCache();

type AppendInstruction = {
  filePath: string;
  line: string;
};

type UiLocale = "zh-CN" | "en";

export type CommandExecutionContext = {
  signal?: AbortSignal;
  runtimeContext?: RuntimeContextSnapshot;
  confirm?: (question: string) => Promise<boolean>;
};

export async function handleCommand(
  command: CommandEnvelope,
  context: CommandExecutionContext = {}
): Promise<ResultEnvelope> {
  const workspaceRoot = resolveWorkspaceRoot(context.runtimeContext);
  const locale = resolveUiLocale(context.runtimeContext);
  if (context.signal?.aborted) {
    return cancelled(
      command,
      locale === "zh-CN"
        ? "\u547d\u4ee4\u5728\u6267\u884c\u524d\u5df2\u53d6\u6d88"
        : "command cancelled before execution"
    );
  }

  switch (command.kind) {
    case "help":
      return {
        commandId: command.commandId,
        machineId: command.machineId,
        status: "ok",
        summary: buildHelpSummary(locale),
        createdAt: new Date().toISOString()
      };
    case "status": {
      const cloudflared = inspectCloudflaredRuntime(workspaceRoot);
      const outboundIp = await resolveOutboundIp({
        signal: context.signal,
        timeoutMs: 2500
      });
      return {
        commandId: command.commandId,
        machineId: command.machineId,
        status: "ok",
        summary: formatStatusSummary(workspaceRoot, cloudflared, locale, outboundIp),
        createdAt: new Date().toISOString()
      };
    }
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

      let generated: { diff: string; summary: string } | undefined;
      try {
        generated = await generatePatchLocallyIfSimplePrompt(command.prompt, workspaceRoot);
      } catch {
        generated = undefined;
      }

      if (!generated) {
        try {
          generated = await generatePatchFromCodex(
            command.prompt,
            workspaceRoot,
            context.runtimeContext,
            context.signal
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

      patchCache.set(command.commandId, generated.diff);
      return {
        commandId: command.commandId,
        machineId: command.machineId,
        status: "ok",
        summary: generated.summary,
        diff: generated.diff,
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

      const approved = await askConfirmation(
        context,
        buildApplyConfirmationQuestion(command, workspaceRoot, locale)
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

      const approved = await askConfirmation(
        context,
        buildTestConfirmationQuestion(testCommand, locale)
      );
      if (!approved) {
        return {
          commandId: command.commandId,
          machineId: command.machineId,
          status: "rejected",
          summary: "test execution rejected by local user",
          createdAt: new Date().toISOString()
        };
      }

      const result = await runTestCommand(testCommand, context.signal, workspaceRoot);
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
        summary: command.prompt
          ? (locale === "zh-CN"
            ? `\u8ba1\u5212\u8bf7\u6c42\u5df2\u63a5\u6536\uff1a${command.prompt}`
            : `plan request accepted: ${command.prompt}`)
          : (locale === "zh-CN" ? "\u8ba1\u5212\u8bf7\u6c42\u5df2\u63a5\u6536" : "plan request accepted"),
        createdAt: new Date().toISOString()
      };
    case "task":
      return {
        commandId: command.commandId,
        machineId: command.machineId,
        status: "error",
        summary: locale === "zh-CN"
          ? "\u8bf7\u5728\u672c\u673a\u6253\u5f00 CodexBridge Chat \u89c6\u56fe\u6267\u884c\u81ea\u7136\u8bed\u8a00\u4efb\u52a1"
          : "Natural-language task execution requires the local CodexBridge chat task engine.",
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

function resolveUiLocale(runtimeContext?: RuntimeContextSnapshot): UiLocale {
  const fromContext = runtimeContext?.uiLanguage?.trim();
  if (fromContext) {
    return normalizeUiLocale(fromContext);
  }

  const fromEnv = process.env.VSCODE_UI_LANGUAGE?.trim();
  if (fromEnv) {
    return normalizeUiLocale(fromEnv);
  }

  const rawNls = process.env.VSCODE_NLS_CONFIG?.trim();
  if (rawNls) {
    try {
      const parsed = JSON.parse(rawNls) as { locale?: string };
      if (parsed.locale?.trim()) {
        return normalizeUiLocale(parsed.locale);
      }
    } catch {
      // Ignore malformed VSCODE_NLS_CONFIG and fall back to default locale.
    }
  }

  return "zh-CN";
}

function normalizeUiLocale(locale: string): UiLocale {
  return locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function buildHelpSummary(locale: UiLocale): string {
  if (locale === "en") {
    return [
      "Command Help",
      "",
      "English Commands:",
      "1. help - show help",
      "2. status - show agent status",
      "3. plan <content> - create a plan",
      "4. patch <prompt> - generate patch",
      "5. apply <patchId> - apply patch",
      "6. test [command] - run tests",
      "",
      "Recognized Chinese Phrases:",
      "1. \u5e2e\u52a9 / \u5e2e\u5fd9 / \u547d\u4ee4\u5217\u8868",
      "2. \u72b6\u6001 / \u67e5\u770b\u72b6\u6001 / \u5065\u5eb7\u68c0\u67e5",
      "3. \u8ba1\u5212 / \u89c4\u5212 + content",
      "4. \u8865\u4e01 / \u4fee\u6539 / \u4fee\u590d / \u65b0\u589e / \u8ffd\u52a0 + prompt",
      "5. \u5e94\u7528\u8865\u4e01 / \u6267\u884c\u8865\u4e01 / \u6253\u8865\u4e01 + patchId",
      "6. \u6d4b\u8bd5 / \u8fd0\u884c\u6d4b\u8bd5 / \u8dd1\u6d4b",
      "",
      "Examples:",
      "- patch Please update README.md and append one line at the end",
      "- \u5e94\u7528\u8865\u4e01 fc3949f3-c96f-4f3a-af61-94950652a9a8",
      "- test pnpm -r test",
      "",
      "Note: natural language commands are supported without @dev"
    ].join("\n");
  }
  return [
    "\u547d\u4ee4\u5e2e\u52a9",
    "",
    "\u82f1\u6587\u547d\u4ee4:",
    "1. help - \u67e5\u770b\u5e2e\u52a9",
    "2. status - \u67e5\u770b\u72b6\u6001",
    "3. plan <\u5185\u5bb9> - \u751f\u6210\u8ba1\u5212",
    "4. patch <\u9700\u6c42> - \u751f\u6210\u8865\u4e01",
    "5. apply <\u8865\u4e01ID> - \u5e94\u7528\u8865\u4e01",
    "6. test [\u547d\u4ee4] - \u6267\u884c\u6d4b\u8bd5",
    "",
    "\u5e38\u7528\u4e2d\u6587\u8bf4\u6cd5:",
    "1. \u5e2e\u52a9 / \u5e2e\u5fd9 / \u547d\u4ee4\u5217\u8868",
    "2. \u72b6\u6001 / \u67e5\u770b\u72b6\u6001 / \u5065\u5eb7\u68c0\u67e5",
    "3. \u8ba1\u5212 / \u89c4\u5212 + \u5185\u5bb9",
    "4. \u8865\u4e01 / \u4fee\u6539 / \u4fee\u590d / \u65b0\u589e / \u8ffd\u52a0 + \u9700\u6c42",
    "5. \u5e94\u7528\u8865\u4e01 / \u6267\u884c\u8865\u4e01 / \u6253\u8865\u4e01 + \u8865\u4e01ID",
    "6. \u6d4b\u8bd5 / \u8fd0\u884c\u6d4b\u8bd5 / \u8dd1\u6d4b",
    "",
    "\u793a\u4f8b:",
    "- patch \u8bf7\u4fee\u6539 README.md\uff0c\u5728\u672b\u5c3e\u8ffd\u52a0\u4e00\u884c",
    "- \u5e94\u7528\u8865\u4e01 fc3949f3-c96f-4f3a-af61-94950652a9a8",
    "- \u8fd0\u884c\u6d4b\u8bd5 pnpm -r test",
    "",
    "\u8bf4\u660e: \u652f\u6301\u4e0d\u5e26 @dev \u7684\u81ea\u7136\u8bed\u8a00\u6307\u4ee4"
  ].join("\n");
}

function buildTestConfirmationQuestion(testCommand: string, locale: UiLocale): string {
  if (locale === "en") {
    return `Execute test command: ${testCommand}?`;
  }
  return `\u662f\u5426\u6267\u884c\u6d4b\u8bd5\u547d\u4ee4\uff1a${testCommand}\uff1f`;
}
function looksLikeUnifiedDiff(diff: string): boolean {
  return (
    diff.includes("diff --git")
    || (diff.includes("\n--- ") && diff.includes("\n+++ "))
    || (diff.startsWith("--- ") && diff.includes("\n+++ "))
  );
}

async function askConfirmation(
  context: CommandExecutionContext,
  question: string
): Promise<boolean> {
  if (context.confirm) {
    return context.confirm(question);
  }
  return requireLocalConfirmation(question);
}

function buildApplyConfirmationQuestion(
  command: CommandEnvelope,
  workspaceRoot: string,
  locale: UiLocale
): string {
  if (locale === "en") {
    const wecomCommand = command.prompt?.trim() || "apply patch";
    const lines = [
      "Incoming WeCom command:",
      wecomCommand,
      "",
      `Workspace: ${path.basename(workspaceRoot)}`,
      "",
      "Execute apply now?"
    ];
    return lines.join("\n");
  }

  const wecomCommand = command.prompt?.trim() || "\u5e94\u7528\u8865\u4e01";
  const lines = [
    "\u6536\u5230\u4f01\u4e1a\u5fae\u4fe1\u547d\u4ee4\uff1a",
    wecomCommand,
    "",
    `\u5de5\u4f5c\u533a\uff1a${path.basename(workspaceRoot)}`,
    "",
    "\u662f\u5426\u6267\u884c apply\uff1f"
  ];
  return lines.join("\n");
}

function resolveWorkspaceRoot(runtimeContext?: RuntimeContextSnapshot): string {
  const fromContext = runtimeContext?.workspaceRoot?.trim();
  if (fromContext) {
    return fromContext;
  }
  const fromEnv = process.env.WORKSPACE_ROOT?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return process.cwd();
}

function formatStatusSummary(
  workspaceRoot: string,
  cloudflared: CloudflaredRuntimeInfo,
  locale: UiLocale,
  outboundIp?: string
): string {
  const callback = cloudflared.callbackUrl ?? "unknown";
  const keepPid = cloudflared.keepPid ? String(cloudflared.keepPid) : "none";
  const terminated =
    cloudflared.terminatedPids.length > 0 ? cloudflared.terminatedPids.join(",") : "none";
  const resolvedOutboundIp = outboundIp?.trim() || "unknown";
  if (locale === "en") {
    const base =
      `workspace=${workspaceRoot} platform=${process.platform} node=${process.version} `
      + `callback=${callback} `
      + `outboundIp=${resolvedOutboundIp} `
      + `cloudflared(total=${cloudflared.totalProcessCount},managed=${cloudflared.managedProcessCount},`
      + `keepPid=${keepPid},terminated=${terminated})`;
    return cloudflared.warning ? `${base} warning=${cloudflared.warning}` : base;
  }
  const base =
    `\u5de5\u4f5c\u533a=${workspaceRoot} \u5e73\u53f0=${process.platform} Node\u7248\u672c=${process.version} `
    + `\u56de\u8c03\u5730\u5740=${callback} `
    + `\u51fa\u53e3IP=${resolvedOutboundIp} `
    + `cloudflared(\u603b\u8fdb\u7a0b=${cloudflared.totalProcessCount},\u6258\u7ba1\u8fdb\u7a0b=${cloudflared.managedProcessCount},`
    + `\u4fdd\u7559PID=${keepPid},\u5df2\u6e05\u7406PID=${terminated})`;
  return cloudflared.warning ? `${base} \u8b66\u544a=${cloudflared.warning}` : base;
}

async function generatePatchLocallyIfSimplePrompt(
  prompt: string,
  workspaceRoot: string
): Promise<{ diff: string; summary: string } | undefined> {
  const instruction = parseAppendInstruction(prompt);
  if (!instruction) {
    return undefined;
  }

  const safePath = safeWorkspacePath(workspaceRoot, instruction.filePath);
  let current = "";
  let exists = true;
  try {
    current = await fs.readFile(safePath, "utf8");
  } catch (error: unknown) {
    const maybe = error as { code?: string };
    if (maybe.code === "ENOENT") {
      exists = false;
    } else {
      return undefined;
    }
  }

  return {
    diff: buildAppendDiff(instruction, current, exists),
    summary: "patch generated by local fast append"
  };
}

function parseAppendInstruction(prompt: string): AppendInstruction | undefined {
  const filePath = prompt.match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9_+-]+)/)?.[1];
  if (!filePath) {
    return undefined;
  }

  const quoted = prompt.match(
    /(?:\u8ffd\u52a0|\u65b0\u589e|\u63d2\u5165)[^“"'`]*[“"'`]([^”"'`]+)[”"'`]/
  )?.[1]?.trim();
  if (quoted) {
    return {
      filePath,
      line: quoted
    };
  }

  const colonTail = prompt.match(
    /(?:\u8ffd\u52a0|\u65b0\u589e|\u63d2\u5165)[^：:]*[:：]\s*(.+)$/
  )?.[1]?.trim();
  if (colonTail) {
    const cleaned = colonTail.replace(/[。.!]$/, "").trim();
    if (cleaned) {
      return {
        filePath,
        line: cleaned
      };
    }
  }

  return undefined;
}

function buildAppendDiff(
  instruction: AppendInstruction,
  original: string,
  exists: boolean
): string {
  const filePath = instruction.filePath.replaceAll("\\", "/");
  const normalized = original.replace(/\r\n/g, "\n");
  const lines = normalized === "" ? [] : normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  if (!exists) {
    return [
      `diff --git a/${filePath} b/${filePath}`,
      "--- /dev/null",
      `+++ b/${filePath}`,
      "@@ -0,0 +1 @@",
      `+${instruction.line}`
    ].join("\n");
  }

  if (lines.length === 0) {
    return [
      `diff --git a/${filePath} b/${filePath}`,
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      "@@ -0,0 +1 @@",
      `+${instruction.line}`
    ].join("\n");
  }

  const lineNo = lines.length;
  const prevLine = lines[lineNo - 1];
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${lineNo},1 +${lineNo},2 @@`,
    ` ${prevLine}`,
    `+${instruction.line}`
  ].join("\n");
}

function safeWorkspacePath(workspaceRoot: string, relPath: string): string {
  const root = path.resolve(workspaceRoot);
  const fullPath = path.resolve(root, relPath);
  if (!(fullPath === root || fullPath.startsWith(`${root}${path.sep}`))) {
    throw new Error(`path traversal in prompt: ${relPath}`);
  }
  return fullPath;
}


