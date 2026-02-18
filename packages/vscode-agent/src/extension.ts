import * as vscode from "vscode";
import { existsSync } from "node:fs";
import path from "node:path";
import { RelayAgent } from "./agent.js";
import type { RuntimeContextSnapshot } from "./context.js";
import type { CommandEnvelope } from "@codexbridge/shared";
import type { CloudflaredRuntimeInfo, EnsuredCloudflaredRuntimeInfo } from "./cloudflared.js";
import { ensureCloudflaredRuntime } from "./cloudflared.js";

let runningAgent: RelayAgent | undefined;
let cloudflaredMonitor: NodeJS.Timeout | undefined;
let cloudflaredMonitorWorkspaceRoot: string | undefined;
let lastKnownCallbackUrl: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("CodexBridge");
  context.subscriptions.push(output);
  ensureCodexCommand(output);

  const start = vscode.commands.registerCommand("codexbridge.startAgent", () => {
    if (runningAgent) {
      vscode.window.showInformationMessage("CodexBridge 代理已在运行。");
      return;
    }

    const config = vscode.workspace.getConfiguration("codexbridge");
    const relayUrl = config.get<string>("relayUrl") ?? "ws://127.0.0.1:8787/agent";
    const machineId = config.get<string>("machineId") ?? `${process.env.COMPUTERNAME ?? "local-machine"}`;
    const reconnectMs = config.get<number>("reconnectMs") ?? 3000;
    const heartbeatMs = config.get<number>("heartbeatMs") ?? 10000;
    const pendingTimeoutMs = config.get<number>("pendingTimeoutMs") ?? 300000;
    const workspaceRoot = resolveWorkspaceRoot();
    if (workspaceRoot) {
      process.env.WORKSPACE_ROOT = workspaceRoot;
      appendOutputLine(output, `工作区路径: ${workspaceRoot}`);
    }
    const runtimeWorkspace = workspaceRoot ?? resolveRuntimeWorkspaceRoot();
    const cloudflared = ensureCloudflaredRuntime(runtimeWorkspace);
    logCloudflaredRuntime(output, "startup", cloudflared);
    logCloudflaredEnsureResult(output, "startup", cloudflared);
    lastKnownCallbackUrl = cloudflared.callbackUrl;

    runningAgent = new RelayAgent({
      relayUrl,
      machineId,
      reconnectMs,
      heartbeatMs,
      pendingTimeoutMs,
      version: context.extension.packageJSON.version,
      eventLogger: (event) =>
        appendOutputLine(output, `[代理] ${event}`, {
          blankLineBefore: shouldInsertBlankBeforeAgentEvent(event)
        }),
      contextProvider: () => collectRuntimeContext(),
      confirmationProvider: (command, question) => confirmInVscode(command, question)
    });
    runningAgent.start();
    appendOutputLine(
      output,
      `代理已启动 relayUrl=${relayUrl} machineId=${machineId} 排队超时=${pendingTimeoutMs}ms`
    );
    startCloudflaredMonitor(output, runtimeWorkspace);
    vscode.window.showInformationMessage(
      `CodexBridge 代理已启动。回调地址: ${cloudflared.callbackUrl ?? "未知"}`
    );
  });

  const stop = vscode.commands.registerCommand("codexbridge.stopAgent", () => {
    if (!runningAgent) {
      vscode.window.showInformationMessage("CodexBridge 代理当前未运行。");
      return;
    }
    stopCloudflaredMonitor();
    runningAgent.stop();
    runningAgent = undefined;
    appendOutputLine(output, "代理已停止");
    vscode.window.showInformationMessage("CodexBridge 代理已停止。");
  });

  const status = vscode.commands.registerCommand("codexbridge.agentStatus", () => {
    const state = runningAgent ? "running" : "stopped";
    const runtimeWorkspace = resolveRuntimeWorkspaceRoot();
    const cloudflared = ensureCloudflaredRuntime(runtimeWorkspace);
    logCloudflaredRuntime(output, "status", cloudflared, { blankLineBefore: true });
    logCloudflaredEnsureResult(output, "status", cloudflared);
    lastKnownCallbackUrl = cloudflared.callbackUrl;
    const summary = [
      `状态=${state === "running" ? "运行中" : "已停止"}`,
      `回调地址=${cloudflared.callbackUrl ?? "未知"}`,
      `cloudflared(总进程=${cloudflared.totalProcessCount},托管进程=${cloudflared.managedProcessCount},保留PID=${cloudflared.keepPid ?? "none"})`
    ].join(" ");
    const warning = cloudflared.warning ? ` 警告=${cloudflared.warning}` : "";
    appendOutputLine(output, `[代理状态] ${summary}${warning}`);
    vscode.window.showInformationMessage(`CodexBridge 代理状态: ${summary}${warning}`);
  });

  context.subscriptions.push(start, stop, status);

  const autostart = vscode.workspace
    .getConfiguration("codexbridge")
    .get<boolean>("autostart", false);
  if (autostart) {
    void vscode.commands.executeCommand("codexbridge.startAgent");
  }
}

export function deactivate(): void {
  stopCloudflaredMonitor();
  if (runningAgent) {
    runningAgent.stop();
    runningAgent = undefined;
  }
}

function collectRuntimeContext(): RuntimeContextSnapshot | undefined {
  const workspaceRoot = resolveWorkspaceRoot();
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return workspaceRoot ? { workspaceRoot } : undefined;
  }

  const doc = editor.document;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
  const maxFileChars = Number(
    vscode.workspace.getConfiguration("codexbridge").get<number>("contextMaxFileChars", 12000)
  );
  const maxSelectionChars = Number(
    vscode.workspace.getConfiguration("codexbridge").get<number>("contextMaxSelectionChars", 6000)
  );

  let activeFilePath: string | undefined;
  const root = workspaceFolder?.uri.fsPath ?? workspaceRoot;
  if (root) {
    const rel = path.relative(root, doc.uri.fsPath).replaceAll("\\", "/");
    if (rel && !rel.startsWith("..")) {
      activeFilePath = rel;
    }
  }

  const selectedText = editor.selection.isEmpty
    ? undefined
    : doc.getText(editor.selection).slice(0, maxSelectionChars);

  return {
    workspaceRoot: root,
    activeFilePath,
    activeFileContent: doc.getText().slice(0, maxFileChars),
    selectedText,
    languageId: doc.languageId
  };
}

async function confirmInVscode(
  command: CommandEnvelope,
  question: string
): Promise<boolean> {
  const yes = "批准";
  const no = "拒绝";
  const choice = await vscode.window.showWarningMessage(
    `[${command.kind}] ${question}`,
    { modal: true },
    yes,
    no
  );
  return choice === yes;
}

function ensureCodexCommand(output: vscode.OutputChannel): void {
  const current = process.env.CODEX_COMMAND?.trim();
  const generic = !current || /^(codex|codex\.exe)$/i.test(current);
  if (!generic) {
    return;
  }

  const ext = vscode.extensions.getExtension("openai.chatgpt");
  if (!ext) {
    return;
  }
  const candidate = path.join(ext.extensionPath, "bin", "windows-x86_64", "codex.exe");
  if (!existsSync(candidate)) {
    return;
  }
  process.env.CODEX_COMMAND = candidate;
  appendOutputLine(output, `已解析 Codex 命令路径: ${candidate}`);
}

function resolveWorkspaceRoot(): string | undefined {
  const firstFolder = vscode.workspace.workspaceFolders?.[0];
  return firstFolder?.uri.fsPath;
}

function resolveRuntimeWorkspaceRoot(): string {
  const fromWorkspace = resolveWorkspaceRoot();
  if (fromWorkspace) {
    return fromWorkspace;
  }
  const fromInit = process.env.INIT_CWD?.trim();
  if (fromInit) {
    return fromInit;
  }
  const fromEnv = process.env.WORKSPACE_ROOT?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return process.cwd();
}

function logCloudflaredRuntime(
  output: vscode.OutputChannel,
  context: "startup" | "status",
  runtime: CloudflaredRuntimeInfo,
  options: { blankLineBefore?: boolean } = {}
): void {
  const contextLabel = context === "startup" ? "启动" : "状态";
  const base = [
    `[cloudflared:${contextLabel}]`,
    `回调地址=${runtime.callbackUrl ?? "未知"}`,
    `日志=${runtime.logPath}`,
    `总进程=${runtime.totalProcessCount}`,
    `托管进程=${runtime.managedProcessCount}`,
    `保留PID=${runtime.keepPid ?? "none"}`
  ].join(" ");
  appendOutputLine(output, base, { blankLineBefore: options.blankLineBefore });
  if (runtime.terminatedPids.length > 0) {
    appendOutputLine(
      output,
      `[cloudflared:${contextLabel}] 已终止多余进程: ${runtime.terminatedPids.join(",")}`
    );
  }
  if (runtime.warning) {
    appendOutputLine(output, `[cloudflared:${contextLabel}] 警告: ${runtime.warning}`);
  }
}

function appendOutputLine(
  output: vscode.OutputChannel,
  message: string,
  options: { blankLineBefore?: boolean } = {}
): void {
  if (options.blankLineBefore) {
    output.appendLine("");
  }
  output.appendLine(`[${formatTimestamp(new Date())}] ${message}`);
}

function logCloudflaredEnsureResult(
  output: vscode.OutputChannel,
  context: "startup" | "status",
  runtime: EnsuredCloudflaredRuntimeInfo
): void {
  const contextLabel = context === "startup" ? "启动" : "状态";
  if (runtime.started) {
    appendOutputLine(output, `[cloudflared:${contextLabel}] 检测到进程退出，已自动重启`);
  }
  if (runtime.startError) {
    appendOutputLine(output, `[cloudflared:${contextLabel}] 自动启动失败: ${runtime.startError}`);
  }
}

function formatTimestamp(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  const second = String(value.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function shouldInsertBlankBeforeAgentEvent(event: string): boolean {
  return /\bstage=command_received\b/.test(event);
}

function startCloudflaredMonitor(
  output: vscode.OutputChannel,
  workspaceRoot: string
): void {
  stopCloudflaredMonitor();
  cloudflaredMonitorWorkspaceRoot = workspaceRoot;
  const configured = vscode.workspace
    .getConfiguration("codexbridge")
    .get<number>("cloudflaredCheckMs", 15000);
  const intervalMs = Number.isFinite(configured) && Number(configured) >= 3000
    ? Number(configured)
    : 15000;
  cloudflaredMonitor = setInterval(() => {
    if (!runningAgent || !cloudflaredMonitorWorkspaceRoot) {
      return;
    }
    const ensured = ensureCloudflaredRuntime(cloudflaredMonitorWorkspaceRoot);
    logCloudflaredEnsureResult(output, "status", ensured);
    if (ensured.callbackUrl && ensured.callbackUrl !== lastKnownCallbackUrl) {
      lastKnownCallbackUrl = ensured.callbackUrl;
      appendOutputLine(output, `[cloudflared:状态] 回调地址已更新: ${ensured.callbackUrl}`);
    }
  }, intervalMs);
}

function stopCloudflaredMonitor(): void {
  if (cloudflaredMonitor) {
    clearInterval(cloudflaredMonitor);
    cloudflaredMonitor = undefined;
  }
  cloudflaredMonitorWorkspaceRoot = undefined;
}
