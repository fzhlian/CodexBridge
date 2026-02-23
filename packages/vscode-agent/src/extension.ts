import * as vscode from "vscode";
import { existsSync } from "node:fs";
import path from "node:path";
import { RelayAgent } from "./agent.js";
import type { RuntimeContextSnapshot } from "./context.js";
import type { CommandEnvelope } from "@codexbridge/shared";
import type { CloudflaredRuntimeInfo, EnsuredCloudflaredRuntimeInfo } from "./cloudflared.js";
import { ensureCloudflaredRuntime } from "./cloudflared.js";
import { ChatViewProvider } from "./chat/chatProvider.js";
import { isIgnoredContextPath } from "./context-ignore.js";

type UiLocale = "zh-CN" | "en";

let runningAgent: RelayAgent | undefined;
let cloudflaredMonitor: NodeJS.Timeout | undefined;
let cloudflaredMonitorWorkspaceRoot: string | undefined;
let lastKnownCallbackUrl: string | undefined;
let chatViewProvider: ChatViewProvider | undefined;
let didWarnStrictAttachOutsideDev = false;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("CodexBridge");
  context.subscriptions.push(output);
  ensureCodexCommand(output);
  syncRuntimeSettingsFromConfig(context, output);

  chatViewProvider = new ChatViewProvider(context, output, {
    onRemoteTaskMilestone: (payload) => {
      runningAgent?.pushTaskMilestone(payload);
    }
  });
  chatViewProvider.register(context.subscriptions);
  void chatViewProvider.initialize().catch((error) => {
    appendOutputLine(output, `[chat] initialize failed: ${error instanceof Error ? error.message : String(error)}`);
  });

  const configChange = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration("codexbridge")) {
      return;
    }
    syncRuntimeSettingsFromConfig(context, output);
    chatViewProvider?.refreshFromSettings();
  });
  context.subscriptions.push(configChange);

  const start = vscode.commands.registerCommand("codexbridge.startAgent", () => {
    const locale = resolveUiLocaleFromVscode();
    if (runningAgent) {
      vscode.window.showInformationMessage(locale === "zh-CN"
        ? "CodexBridge 代理已在运行。"
        : "CodexBridge agent is already running.");
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
      appendOutputLine(
        output,
        locale === "zh-CN"
          ? `工作区路径: ${workspaceRoot}`
          : `Workspace path: ${workspaceRoot}`
      );
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
        appendOutputLine(output, `[agent] ${event}`, {
          blankLineBefore: shouldInsertBlankBeforeAgentEvent(event)
        }),
      contextProvider: () => collectRuntimeContext(),
      confirmationProvider: (command, question) =>
        confirmInVscode(command, question),
      executeCommand: async (command, executionContext) =>
        chatViewProvider?.executeRemoteCommandViaChat(command, {
          signal: executionContext.signal,
          runtimeContext: executionContext.runtimeContext
        }),
      onCommandReceived: (command) => {
        chatViewProvider?.onRemoteCommand(command);
      },
      onCommandResult: (command, result) => {
        if (chatViewProvider?.consumeChatHandledRemoteResult(result.commandId)) {
          return;
        }
        chatViewProvider?.onRemoteResult(command, result);
      }
    });
    runningAgent.start();
    appendOutputLine(
      output,
      locale === "zh-CN"
        ? `代理已启动 relayUrl=${relayUrl} machineId=${machineId} 排队超时=${pendingTimeoutMs}ms`
        : `Agent started relayUrl=${relayUrl} machineId=${machineId} pendingTimeout=${pendingTimeoutMs}ms`
    );
    startCloudflaredMonitor(output, runtimeWorkspace);
    vscode.window.showInformationMessage(
      locale === "zh-CN"
        ? `CodexBridge 代理已启动。回调地址: ${cloudflared.callbackUrl ?? "未知"}`
        : `CodexBridge agent started. Callback URL: ${cloudflared.callbackUrl ?? "unknown"}`
    );
  });

  const stop = vscode.commands.registerCommand("codexbridge.stopAgent", () => {
    const locale = resolveUiLocaleFromVscode();
    if (!runningAgent) {
      vscode.window.showInformationMessage(locale === "zh-CN"
        ? "CodexBridge 代理当前未运行。"
        : "CodexBridge agent is not running.");
      return;
    }
    stopCloudflaredMonitor();
    runningAgent.stop();
    runningAgent = undefined;
    appendOutputLine(output, locale === "zh-CN" ? "代理已停止" : "Agent stopped");
    vscode.window.showInformationMessage(locale === "zh-CN"
      ? "CodexBridge 代理已停止。"
      : "CodexBridge agent stopped.");
  });

  const status = vscode.commands.registerCommand("codexbridge.agentStatus", () => {
    const locale = resolveUiLocaleFromVscode();
    const state = runningAgent ? "running" : "stopped";
    const runtimeWorkspace = resolveRuntimeWorkspaceRoot();
    const cloudflared = ensureCloudflaredRuntime(runtimeWorkspace);
    logCloudflaredRuntime(output, "status", cloudflared, { blankLineBefore: true });
    logCloudflaredEnsureResult(output, "status", cloudflared);
    lastKnownCallbackUrl = cloudflared.callbackUrl;
    const summary = locale === "zh-CN"
      ? [
        `状态=${state === "running" ? "运行中" : "已停止"}`,
        `回调地址=${cloudflared.callbackUrl ?? "未知"}`,
        `cloudflared(总进程=${cloudflared.totalProcessCount},托管进程=${cloudflared.managedProcessCount},保留PID=${cloudflared.keepPid ?? "none"})`
      ].join(" ")
      : [
        `state=${state}`,
        `callback=${cloudflared.callbackUrl ?? "unknown"}`,
        `cloudflared(total=${cloudflared.totalProcessCount},managed=${cloudflared.managedProcessCount},keepPid=${cloudflared.keepPid ?? "none"})`
      ].join(" ");
    const warning = cloudflared.warning
      ? (locale === "zh-CN" ? ` 警告=${cloudflared.warning}` : ` warning=${cloudflared.warning}`)
      : "";
    appendOutputLine(output, `${locale === "zh-CN" ? "[代理状态]" : "[agent-status]"} ${summary}${warning}`);
    vscode.window.showInformationMessage(
      locale === "zh-CN"
        ? `CodexBridge 代理状态: ${summary}${warning}`
        : `CodexBridge agent status: ${summary}${warning}`
    );
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
  const uiLanguage = vscode.env.language;
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return workspaceRoot ? { workspaceRoot, uiLanguage } : { uiLanguage };
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
  const ignoreActiveFile = isIgnoredContextPath(activeFilePath ?? doc.uri.fsPath);

  const selectedText = ignoreActiveFile || editor.selection.isEmpty
    ? undefined
    : doc.getText(editor.selection).slice(0, maxSelectionChars);

  return {
    workspaceRoot: root,
    activeFilePath: ignoreActiveFile ? undefined : activeFilePath,
    activeFileContent: ignoreActiveFile ? undefined : doc.getText().slice(0, maxFileChars),
    selectedText,
    languageId: doc.languageId,
    uiLanguage
  };
}

async function confirmInVscode(
  _command: CommandEnvelope,
  question: string
): Promise<boolean> {
  const locale = resolveUiLocaleFromVscode();
  const yes = locale === "zh-CN" ? "批准" : "Approve";
  const no = locale === "zh-CN" ? "拒绝" : "Reject";
  const choice = await vscode.window.showWarningMessage(
    question,
    { modal: true },
    yes,
    no
  );
  return choice === yes;
}

function syncRuntimeSettingsFromConfig(
  extensionContext?: vscode.ExtensionContext,
  output?: vscode.OutputChannel
): void {
  const config = vscode.workspace.getConfiguration("codexbridge");
  process.env.CODEXBRIDGE_UI_LOCALE = resolveConfiguredUiLocale(
    config.get<string>("ui.locale", "auto")
  );
  process.env.TEST_DEFAULT_COMMAND = config.get<string>("defaultTestCommand", "pnpm test");
  process.env.CONTEXT_MAX_FILES = String(config.get<number>("contextMaxFiles", 10));
  process.env.CONTEXT_MAX_FILE_CHARS = String(config.get<number>("contextMaxFileBytes", 12000));
  process.env.CODEXBRIDGE_NL_ENABLE = config.get<boolean>("nl.enable", true) ? "1" : "0";
  process.env.CODEXBRIDGE_NL_USE_MODEL_ROUTER = config.get<boolean>("nl.useModelRouter", true) ? "1" : "0";
  process.env.CODEXBRIDGE_NL_MODEL_ROUTER_STRICT = config.get<boolean>("nl.modelRouterStrict", true) ? "1" : "0";
  const strictAttachRawOutput = resolveBooleanRuntimeFlag(
    config.get<boolean>("nl.modelRouterStrictAttachRawOutput", false),
    process.env.CODEXBRIDGE_NL_MODEL_ROUTER_STRICT_ATTACH_RAW_OUTPUT
  );
  if (strictAttachRawOutput === "1" && !isDevelopmentExtensionMode(extensionContext)) {
    process.env.CODEXBRIDGE_NL_MODEL_ROUTER_STRICT_ATTACH_RAW_OUTPUT = "0";
    if (!didWarnStrictAttachOutsideDev && output) {
      didWarnStrictAttachOutsideDev = true;
      const locale = resolveUiLocaleFromVscode();
      const warning = locale === "zh-CN"
        ? "codexbridge.nl.modelRouterStrictAttachRawOutput 仅在开发模式生效，当前环境已自动忽略。"
        : "codexbridge.nl.modelRouterStrictAttachRawOutput is development-mode only and has been ignored.";
      appendOutputLine(
        output,
        "[nl] codexbridge.nl.modelRouterStrictAttachRawOutput is ignored outside development mode"
      );
      void vscode.window.showWarningMessage(warning);
    }
  } else {
    process.env.CODEXBRIDGE_NL_MODEL_ROUTER_STRICT_ATTACH_RAW_OUTPUT = strictAttachRawOutput;
    if (strictAttachRawOutput === "0") {
      didWarnStrictAttachOutsideDev = false;
    }
  }
  process.env.CODEXBRIDGE_NL_CONFIDENCE_THRESHOLD = String(
    config.get<number>("nl.confidenceThreshold", 0.55)
  );
  process.env.CODEX_CHAT_ENABLE_EXEC_FALLBACK = resolveBooleanRuntimeFlag(
    config.get<boolean>("chat.enableExecFallback", false),
    process.env.CODEX_CHAT_ENABLE_EXEC_FALLBACK
  );
  process.env.CODEX_CHAT_EXEC_BYPASS_APPROVALS_AND_SANDBOX = resolveBooleanRuntimeFlag(
    config.get<boolean>("chat.execBypassApprovalsAndSandbox", false),
    process.env.CODEX_CHAT_EXEC_BYPASS_APPROVALS_AND_SANDBOX
  );
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
  appendOutputLine(
    output,
    resolveUiLocaleFromVscode() === "zh-CN"
      ? `已解析 Codex 命令路径: ${candidate}`
      : `Resolved Codex command path: ${candidate}`
  );
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
  const locale = resolveUiLocaleFromVscode();
  const contextLabel = locale === "zh-CN"
    ? (context === "startup" ? "启动" : "状态")
    : context;
  const base = [
    `[cloudflared:${contextLabel}]`,
    `${locale === "zh-CN" ? "回调地址" : "callback"}=${runtime.callbackUrl ?? "unknown"}`,
    `${locale === "zh-CN" ? "日志" : "log"}=${runtime.logPath}`,
    `${locale === "zh-CN" ? "总进程" : "total"}=${runtime.totalProcessCount}`,
    `${locale === "zh-CN" ? "托管进程" : "managed"}=${runtime.managedProcessCount}`,
    `${locale === "zh-CN" ? "保留PID" : "keepPid"}=${runtime.keepPid ?? "none"}`
  ].join(" ");
  appendOutputLine(output, base, { blankLineBefore: options.blankLineBefore });
  if (runtime.terminatedPids.length > 0) {
    appendOutputLine(
      output,
      locale === "zh-CN"
        ? `[cloudflared:${contextLabel}] 已终止多余进程: ${runtime.terminatedPids.join(",")}`
        : `[cloudflared:${contextLabel}] terminated extra processes: ${runtime.terminatedPids.join(",")}`
    );
  }
  if (runtime.warning) {
    appendOutputLine(
      output,
      locale === "zh-CN"
        ? `[cloudflared:${contextLabel}] 警告: ${runtime.warning}`
        : `[cloudflared:${contextLabel}] warning: ${runtime.warning}`
    );
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
  const locale = resolveUiLocaleFromVscode();
  const contextLabel = locale === "zh-CN"
    ? (context === "startup" ? "启动" : "状态")
    : context;
  if (runtime.started) {
    appendOutputLine(
      output,
      locale === "zh-CN"
        ? `[cloudflared:${contextLabel}] 检测到进程退出，已自动重启`
        : `[cloudflared:${contextLabel}] process exited and was restarted automatically`
    );
  }
  if (runtime.startError) {
    appendOutputLine(
      output,
      locale === "zh-CN"
        ? `[cloudflared:${contextLabel}] 自动启动失败: ${runtime.startError}`
        : `[cloudflared:${contextLabel}] auto-start failed: ${runtime.startError}`
    );
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
      appendOutputLine(
        output,
        resolveUiLocaleFromVscode() === "zh-CN"
          ? `[cloudflared:状态] 回调地址已更新: ${ensured.callbackUrl}`
          : `[cloudflared:status] callback updated: ${ensured.callbackUrl}`
      );
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

function resolveUiLocaleFromVscode(): UiLocale {
  return vscode.env.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function resolveConfiguredUiLocale(raw: string | undefined): UiLocale {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return resolveUiLocaleFromVscode();
  }
  if (normalized === "zh-cn" || normalized === "zh") {
    return "zh-CN";
  }
  if (normalized === "en") {
    return "en";
  }
  return resolveUiLocaleFromVscode();
}

function isDevelopmentExtensionMode(context?: vscode.ExtensionContext): boolean {
  if (context?.extensionMode === vscode.ExtensionMode.Development) {
    return true;
  }
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  return nodeEnv === "development" || nodeEnv === "dev" || nodeEnv === "test";
}

function resolveBooleanRuntimeFlag(settingValue: boolean, envValue: string | undefined): "1" | "0" {
  if (typeof envValue === "string") {
    const normalized = envValue.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return "1";
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return "0";
    }
  }
  return settingValue ? "1" : "0";
}
