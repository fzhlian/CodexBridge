import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as vscode from "vscode";
import { parseDevCommand, type CommandEnvelope, type ParsedDevCommand, type ResultEnvelope, type ResultStatus } from "@codexbridge/shared";
import { generatePatchFromCodex } from "../codex-patch.js";
import { CodexClientFacade } from "../codex/codexClientFacade.js";
import type { RuntimeContextSnapshot } from "../context.js";
import { handleCommand } from "../handlers.js";
import { VirtualDiffDocumentProvider } from "../diff/virtualDocs.js";
import { syncRuntimeLocaleFromReplyText, t } from "../i18n/messages.js";
import {
  applyDiffWithConfirmation,
  DiffStore,
  runCommandWithConfirmation,
  runTestWithConfirmation,
  viewDiff
} from "./chatActions.js";
import { collectChatContext } from "./contextCollector.js";
import type { ChatMessageDTO, ExtToUI, TaskEventMessage, UIContextRequest } from "./chatProtocol.js";
import { parseUIToExtMessage, toMessageDTO, type Attachment, type UIToExt } from "./chatProtocol.js";
import { ChatStateStore } from "./chatState.js";
import { TaskEngine } from "../nl/taskEngine.js";
import { collectTaskContext } from "../nl/taskContext.js";
import { routeTaskIntent } from "../nl/taskRouter.js";
import { ModelRouterStrictError, routeTaskIntentWithModel } from "../nl/modelRouter.js";
import { detectUnreadableTaskInput } from "../nl/inputReadability.js";
import { runTask, type GitTaskConfig } from "../nl/taskRunner.js";
import { requestApproval, type ApprovalSource } from "../nl/approvalGate.js";
import { LocalGitTool } from "../nl/gitTool.js";
import { isSafeGitCommand } from "../nl/commandExecution.js";
import type { GitSyncProposal, TaskIntent, TaskResult, TaskState, UserRequest } from "../nl/taskTypes.js";
import { sanitizeCmd as sanitizeRunCommand } from "../nl/validate.js";
import { getDefaultTestCommand, isAllowedTestCommand, runTestCommand } from "../test-runner.js";

const DEFAULT_THREAD_ID = "default";
const LOCAL_CHAT_MACHINE_ID = "chat-local";
const AGENT_NATIVE_COMMAND_KINDS = new Set<CommandEnvelope["kind"]>(["help", "status"]);
const GIT_SYNC_STEP_ORDER: Array<"add" | "commit" | "push"> = ["add", "commit", "push"];

type PendingRemoteAssistant = {
  threadId: string;
  messageId: string;
};

type RemoteUiExecutionContext = {
  signal?: AbortSignal;
  runtimeContext?: RuntimeContextSnapshot;
};

type TaskExecutionInput = {
  threadId: string;
  messageId: string;
  text: string;
  contextRequest: UIContextRequest;
  source: UserRequest["source"];
  fromUser?: string;
  signal?: AbortSignal;
  runtimeContext?: RuntimeContextSnapshot;
};

type CommandTaskBinding = {
  taskId: string;
  flow: "single";
};

type GitSyncStepId = "add" | "commit" | "push";
type GitSyncStepState = "pending" | "completed" | "failed" | "skipped";

type GitSyncSession = {
  taskId: string;
  threadId: string;
  messageId: string;
  source: UserRequest["source"];
  workspaceRoot: string;
  proposal: GitSyncProposal;
  primaryAction: "run_all" | "push";
  stepState: Record<GitSyncStepId, GitSyncStepState>;
  stepLogs: Partial<Record<GitSyncStepId, string>>;
  commitSha?: string;
  pushSummary?: string;
};

type ChangeValidationResult = {
  ok: boolean;
  summary: string;
  logs: string;
};

type ChatViewProviderOptions = {
  onRemoteTaskMilestone?: (payload: {
    commandId: string;
    machineId: string;
    status: ResultStatus;
    summary: string;
  }) => void;
  onLocalCommandSummary?: (payload: {
    commandId: string;
    machineId: string;
    status: ResultStatus;
    summary: string;
  }) => void;
};

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "codexbridge.chatView";

  private webviewView?: vscode.WebviewView;
  private readonly stateStore: ChatStateStore;
  private readonly codex = new CodexClientFacade();
  private readonly gitTool = new LocalGitTool();
  private readonly diffStore = new DiffStore(20);
  private readonly virtualDocs = new VirtualDiffDocumentProvider();
  private readonly pendingRemoteAssistants = new Map<string, PendingRemoteAssistant>();
  private readonly chatHandledRemoteResultIds = new Set<string>();
  private readonly remotePatchDiffIds = new Map<string, string>();
  private readonly remoteGitSyncTaskByTaskId = new Map<string, { commandId: string; machineId: string }>();
  private readonly taskEngine: TaskEngine;
  private readonly taskStartAtMs = new Map<string, number>();
  private readonly taskInputById = new Map<string, TaskExecutionInput>();
  private readonly taskAbortById = new Map<string, AbortController>();
  private readonly diffTaskByDiffId = new Map<string, string>();
  private readonly commandTaskByKey = new Map<string, CommandTaskBinding>();
  private readonly gitSyncSessionByTaskId = new Map<string, GitSyncSession>();
  private readonly gitSyncTaskLock = new Set<string>();
  private didWarnStrictRawOutputOutsideDev = false;
  private didWarnModelRouterDisabledIgnored = false;
  private didWarnModelRouterStrictDisabledIgnored = false;

  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly options: ChatViewProviderOptions = {}
  ) {
    this.stateStore = new ChatStateStore(extensionContext);
    this.taskEngine = new TaskEngine({
      onTaskStart: (event) => {
        this.taskStartAtMs.set(event.taskId, Date.now());
        this.emitTaskEvent({
          type: "task_start",
          threadId: event.threadId,
          taskId: event.taskId,
          intent: event.intent
        });
        const source = this.taskEngine.getTask(event.taskId)?.request.source ?? "unknown";
        this.logTask(
          `taskId=${event.taskId} event=start source=${source} intent=${event.intent.kind} summary=${toSingleLine(event.intent.summary, 120)}`
        );
      },
      onTaskState: (event) => {
        this.emitTaskEvent({
          type: "task_state",
          threadId: event.threadId,
          taskId: event.taskId,
          state: event.state,
          message: event.message
        });
        this.logTask(
          `taskId=${event.taskId} event=state state=${event.state}${event.message ? ` message="${toSingleLine(event.message, 140)}"` : ""}`
        );
      },
      onTaskStreamChunk: (event) => {
        this.emitTaskEvent({
          type: "task_stream_chunk",
          threadId: event.threadId,
          taskId: event.taskId,
          messageId: event.messageId,
          chunk: event.chunk
        });
      },
      onTaskProposal: (event) => {
        this.emitTaskEvent({
          type: "task_proposal",
          threadId: event.threadId,
          taskId: event.taskId,
          result: event.result
        });
        this.logTask(`taskId=${event.taskId} event=proposal type=${event.result.proposal.type}`);
      },
      onTaskEnd: (event) => {
        this.emitTaskEvent({
          type: "task_end",
          threadId: event.threadId,
          taskId: event.taskId,
          status: event.status
        });
        const startedAt = this.taskStartAtMs.get(event.taskId);
        const durationMs = startedAt ? Date.now() - startedAt : undefined;
        this.taskStartAtMs.delete(event.taskId);
        this.logTask(
          `taskId=${event.taskId} event=end status=${event.status}${durationMs !== undefined ? ` durationMs=${durationMs}` : ""}`
        );
      }
    });
  }

  async initialize(): Promise<void> {
    await this.stateStore.load(this.resolveMaxMessages());
  }

  register(subscriptions: { push(item: vscode.Disposable): void }): void {
    subscriptions.push(
      vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, this, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );
    subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider("codexbridge", this.virtualDocs)
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionContext.extensionUri, "media")]
    };

    void this.renderWebview(webviewView.webview).catch((error) => {
      this.log(`failed to render webview: ${error instanceof Error ? error.message : String(error)}`);
    });

    webviewView.webview.onDidReceiveMessage((raw) => {
      void this.handleRawMessage(raw);
    });

    webviewView.onDidDispose(() => {
      this.webviewView = undefined;
    });
  }

  onRemoteCommand(command: CommandEnvelope): void {
    if (this.pendingRemoteAssistants.has(command.commandId)) {
      return;
    }
    const threadId = DEFAULT_THREAD_ID;
    const remoteMessage = this.stateStore.appendMessage(threadId, {
      role: "remote",
      author: command.userId || "WeCom",
      text: formatRemoteCommand(command),
      meta: {
        source: "wecom",
        commandId: command.commandId,
        kind: command.kind
      }
    });
    this.postMessage({
      type: "append_message",
      threadId,
      message: toMessageDTO(remoteMessage)
    });

    const assistant = this.stateStore.appendMessage(threadId, {
      role: "assistant",
      text: t("chat.remote.processing"),
      meta: {
        source: "remote-result",
        commandId: command.commandId
      }
    });
    this.pendingRemoteAssistants.set(command.commandId, {
      threadId,
      messageId: assistant.id
    });
    this.postMessage({
      type: "append_message",
      threadId,
      message: toMessageDTO(assistant)
    });
  }

  canExecuteRemoteCommandViaChat(): boolean {
    if (!this.isChatViewEnabled()) {
      this.log("ui.enableChatView=false, but remote command execution still routes through task engine");
    }
    return true;
  }

  consumeChatHandledRemoteResult(commandId: string): boolean {
    return this.chatHandledRemoteResultIds.delete(commandId);
  }

  async executeRemoteCommandViaChat(
    command: CommandEnvelope,
    context: RemoteUiExecutionContext = {}
  ): Promise<ResultEnvelope | undefined> {
    this.canExecuteRemoteCommandViaChat();

    const pending = this.pendingRemoteAssistants.get(command.commandId);
    const threadId = pending?.threadId ?? DEFAULT_THREAD_ID;
    let assistantMessageId = pending?.messageId;
    if (!assistantMessageId) {
      const injectedInput = formatInjectedRemoteCommand(command);
      const userMessage = this.stateStore.appendMessage(threadId, {
        role: "remote",
        author: command.userId || "WeCom",
        text: injectedInput,
        meta: {
          source: "wecom-ui-injected",
          commandId: command.commandId,
          kind: command.kind
        }
      });
      this.postMessage({
        type: "append_message",
        threadId,
        message: toMessageDTO(userMessage)
      });

      const assistant = this.stateStore.appendMessage(threadId, {
        role: "assistant",
        text: t("chat.remote.processing"),
        meta: {
          source: "wecom-ui-result",
          commandId: command.commandId
        }
      });
      this.postMessage({
        type: "append_message",
        threadId,
        message: toMessageDTO(assistant)
      });
      assistantMessageId = assistant.id;
      this.pendingRemoteAssistants.set(command.commandId, {
        threadId,
        messageId: assistant.id
      });
    }

    let result: ResultEnvelope;
    switch (command.kind) {
      case "help":
      case "status":
      case "plan":
      case "patch":
      case "apply":
      case "test":
      case "task": {
        const taskCommand = asRemoteTaskCommand(command);
        if (command.kind !== "task") {
          this.log(`route remote-legacy kind=${command.kind} -> task commandId=${command.commandId}`);
        }
        result = await this.executeRemoteTaskCommand(taskCommand, threadId, assistantMessageId, context);
        break;
      }
      default:
        result = this.createRemoteResult(command, "error", t("chat.remote.unknownCommand"));
        this.updateAssistantMessage(threadId, assistantMessageId, {
          text: result.summary,
          attachments: [{
            type: "error",
            code: "remote_unknown_command",
            message: result.summary
          }]
        });
        break;
    }

    this.chatHandledRemoteResultIds.add(command.commandId);
    this.pendingRemoteAssistants.delete(command.commandId);
    return result;
  }

  onRemoteResult(command: CommandEnvelope, result: ResultEnvelope): void {
    syncRuntimeLocaleFromReplyText(result.summary);
    const pending = this.pendingRemoteAssistants.get(result.commandId);
    this.pendingRemoteAssistants.delete(result.commandId);
    const threadId = pending?.threadId ?? DEFAULT_THREAD_ID;
    const messageId = pending?.messageId;
    const attachments = this.buildAttachmentsForResult(result);

    if (messageId) {
      this.postMessage({ type: "stream_start", threadId, messageId });
      for (const chunk of chunkText(result.summary || "")) {
        this.postMessage({ type: "stream_chunk", threadId, messageId, chunk });
      }
      this.postMessage({ type: "stream_end", threadId, messageId });
      const updated = this.stateStore.updateMessage(threadId, messageId, {
        text: result.summary,
        attachments
      });
      if (updated) {
        this.postMessage({
          type: "update_message",
          threadId,
          messageId,
          patch: {
            text: updated.text,
            attachments: updated.attachments
          }
        });
      }
      return;
    }

    const message = this.stateStore.appendMessage(threadId, {
      role: "assistant",
      text: result.summary,
      attachments,
      meta: {
        source: "remote-result",
        commandId: result.commandId,
        kind: command.kind
      }
    });
    this.postMessage({
      type: "append_message",
      threadId,
      message: toMessageDTO(message)
    });
  }

  refreshFromSettings(): void {
    this.stateStore.setMaxMessages(this.resolveMaxMessages());
    this.sendThreadState(DEFAULT_THREAD_ID);
  }

  private async renderWebview(webview: vscode.Webview): Promise<void> {
    const htmlPath = vscode.Uri.joinPath(this.extensionContext.extensionUri, "media", "chat.html");
    const rawHtml = await fs.readFile(htmlPath.fsPath, "utf8");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionContext.extensionUri, "media", "chat.js")
    );
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionContext.extensionUri, "media", "styles.css")
    );
    const nonce = createNonce();
    const webviewLocale = resolveWebviewLocale();
    webview.html = rawHtml
      .replaceAll("{{STYLE_URI}}", String(stylesUri))
      .replaceAll("{{SCRIPT_URI}}", String(scriptUri))
      .replaceAll("{{NONCE}}", nonce)
      .replaceAll("{{CSP_SOURCE}}", webview.cspSource)
      .replaceAll("{{UI_LOCALE}}", webviewLocale);
  }

  private async handleRawMessage(raw: unknown): Promise<void> {
    const message = parseUIToExtMessage(raw);
    if (!message) {
      this.postMessage({
        type: "toast",
        level: "warn",
        message: t("chat.warn.invalidWebviewMessage")
      });
      return;
    }
    if (!this.isChatViewEnabled()) {
      this.postMessage({
        type: "toast",
        level: "warn",
        message: t("chat.warn.chatViewDisabled")
      });
      return;
    }

    await this.handleMessage(message);
  }

  private async handleMessage(message: UIToExt): Promise<void> {
    switch (message.type) {
      case "ui_ready":
        if (message.version !== 1) {
          this.postMessage({
            type: "toast",
            level: "warn",
            message: t("chat.warn.uiProtocolVersionMismatch", { version: message.version })
          });
        }
        this.sendThreadState(DEFAULT_THREAD_ID);
        break;
      case "request_state":
        this.sendThreadState(message.threadId);
        break;
      case "set_context":
        this.stateStore.setContext(message.threadId, message.context);
        this.sendThreadState(message.threadId);
        break;
      case "clear_thread":
        this.stateStore.clearThread(message.threadId);
        this.sendThreadState(message.threadId);
        this.postMessage({
          type: "toast",
          level: "info",
          message: t("chat.info.threadCleared")
        });
        break;
      case "copy_to_clipboard":
        await vscode.env.clipboard.writeText(message.text);
        this.postMessage({
          type: "action_result",
          action: "copy_to_clipboard",
          ok: true,
          message: t("chat.info.copiedToClipboard")
        });
        break;
      case "view_diff":
        await this.handleViewDiff(message.threadId, message.diffId);
        break;
      case "apply_diff":
        await this.handleApplyDiff(message.threadId, message.diffId);
        break;
      case "run_command":
        await this.handleRunCommand(message.threadId, message.cmd, message.cwd);
        break;
      case "run_test":
        await this.handleRunTest(message.threadId, message.cmd);
        break;
      case "git_sync_action":
        await this.handleGitSyncAction(message.threadId, message.taskId, message.action);
        break;
      case "retry_task":
        await this.handleRetryTask(message.threadId, message.taskId);
        break;
      case "cancel_task":
        await this.handleCancelTask(message.threadId, message.taskId);
        break;
      case "send_message":
        await this.handleSendMessage(message.threadId, message.text, message.context);
        break;
      default:
        break;
    }
  }

  private async handleSendMessage(
    threadId: string,
    text: string,
    contextRequest: UIContextRequest
  ): Promise<void> {
    const prompt = text.trim();
    if (!prompt) {
      this.postMessage({
        type: "toast",
        level: "warn",
        message: t("chat.warn.emptyMessage")
      });
      return;
    }
    this.stateStore.setContext(threadId, contextRequest);
    const userMessage = this.stateStore.appendMessage(threadId, {
      role: "user",
      text: prompt
    });
    this.postMessage({
      type: "append_message",
      threadId,
      message: toMessageDTO(userMessage)
    });

    const assistant = this.stateStore.appendMessage(threadId, {
      role: "assistant",
      text: ""
    });
    this.postMessage({
      type: "append_message",
      threadId,
      message: toMessageDTO(assistant)
    });
    const normalizedTaskText = normalizeLocalTaskPrompt(prompt);
    if (normalizedTaskText !== prompt) {
      this.logTask(
        `event=local_shortcut_normalized input="${toSingleLine(prompt, 120)}" task="${toSingleLine(normalizedTaskText, 120)}"`
      );
    }
    if (!this.isNaturalLanguageTaskEnabled()) {
      this.log("nl.enable=false, but local UI message still routes through task engine");
    }
    try {
      await this.executeTaskRequest({
        threadId,
        messageId: assistant.id,
        text: normalizedTaskText,
        contextRequest,
        source: "local_ui"
      });
    } catch (error) {
      const message = extractErrorMessage(error);
      this.updateAssistantMessage(threadId, assistant.id, {
        text: t("chat.error.taskExecutionFailed"),
        attachments: this.buildTaskFailureAttachments(error, "task_execution_failed")
      });
      this.postMessage({
        type: "toast",
        level: "error",
        message: t("chat.error.taskExecutionFailedWithReason", { message })
      });
    }
  }

  private async resolveAssistantStream(
    threadId: string,
    messageId: string,
    prompt: string,
    contextRequest: UIContextRequest
  ): Promise<void> {
    this.syncCodexRuntimeFlagsFromConfig();
    const parsed = parseNativeAgentCommand(prompt);
    if (parsed && isAgentNativeCommandKind(parsed.kind)) {
      await this.resolveAgentNativeCommand(threadId, messageId, parsed, contextRequest);
      return;
    }
    this.postMessage({ type: "stream_start", threadId, messageId });
    let finalText = "";
    try {
      const context = await collectChatContext(contextRequest);
      finalText = await this.codex.completeWithStreaming(
        prompt,
        context.renderedContext,
        {
          onChunk: (chunk) => {
            this.postMessage({ type: "stream_chunk", threadId, messageId, chunk });
          }
        },
        undefined,
        context.runtime?.workspaceRoot
      );
      this.postMessage({ type: "stream_end", threadId, messageId });
      syncRuntimeLocaleFromReplyText(finalText);
      this.updateAssistantMessage(threadId, messageId, {
        text: finalText
      });
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      this.log(`codex complete failed: ${errorMessage}`);
      this.postMessage({ type: "stream_end", threadId, messageId });
      this.updateAssistantMessage(threadId, messageId, {
        text: t("chat.error.codexResponseFailed"),
        attachments: [toErrorAttachment("codex_complete_failed", error)]
      });
      this.postMessage({
        type: "toast",
        level: "error",
        message: t("chat.error.codexRequestFailed", { message: errorMessage })
      });
    }
  }

  private async resolveAgentNativeCommand(
    threadId: string,
    messageId: string,
    parsed: ParsedDevCommand,
    contextRequest: UIContextRequest
  ): Promise<void> {
    this.postMessage({ type: "stream_start", threadId, messageId });
    const command = buildLocalChatCommand(parsed);
    try {
      this.log(`route local-agent-native kind=${parsed.kind}`);
      const collected = await collectChatContext(contextRequest);
      const result = await handleCommand(command, {
        runtimeContext: collected.runtime
      });
      for (const chunk of chunkText(result.summary)) {
        this.postMessage({ type: "stream_chunk", threadId, messageId, chunk });
      }
      this.postMessage({ type: "stream_end", threadId, messageId });
      this.updateAssistantMessage(threadId, messageId, {
        text: result.summary,
        attachments: this.buildAttachmentsForResult(result)
      });
      this.emitLocalCommandSummary({
        commandId: command.commandId,
        machineId: command.machineId,
        status: result.status,
        summary: result.summary
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.postMessage({ type: "stream_end", threadId, messageId });
      this.updateAssistantMessage(threadId, messageId, {
        text: t("chat.error.agentCommandFailed"),
        attachments: [toErrorAttachment("agent_native_command_failed", error)]
      });
      this.postMessage({
        type: "toast",
        level: "error",
        message: t("chat.error.agentCommandFailedWithReason", { message: errorMessage })
      });
      this.emitLocalCommandSummary({
        commandId: command.commandId,
        machineId: command.machineId,
        status: "error",
        summary: t("chat.error.agentCommandFailedWithReason", { message: errorMessage })
      });
    }
  }

  private async resolveLegacyDslCommand(
    threadId: string,
    messageId: string,
    parsed: ParsedDevCommand,
    contextRequest: UIContextRequest
  ): Promise<boolean> {
    if (parsed.kind === "help" || parsed.kind === "status") {
      await this.resolveAgentNativeCommand(threadId, messageId, parsed, contextRequest);
      return true;
    }
    if (parsed.kind === "test") {
      await this.resolveTestSlash(threadId, messageId, parsed.prompt ?? "");
      return true;
    }
    if (parsed.kind === "patch") {
      await this.resolvePatchSlash(threadId, messageId, parsed.prompt ?? "", contextRequest);
      return true;
    }
    if (parsed.kind === "plan") {
      await this.resolveAssistantStream(
        threadId,
        messageId,
        parsed.prompt ? `Create a concise plan for:\n${parsed.prompt}` : "Create a concise implementation plan.",
        contextRequest
      );
      return true;
    }
    if (parsed.kind === "apply") {
      if (!parsed.refId) {
        this.updateAssistantMessage(threadId, messageId, {
          text: t("chat.error.applyRequiresRefId")
        });
        return true;
      }
      await this.handleApplyDiff(threadId, parsed.refId);
      this.updateAssistantMessage(threadId, messageId, {
        text: t("chat.info.applyRequestedForRefId", { refId: parsed.refId })
      });
      return true;
    }
    return false;
  }

  private async executeRemoteAgentNativeCommand(
    command: CommandEnvelope,
    threadId: string,
    messageId: string,
    context: RemoteUiExecutionContext
  ): Promise<ResultEnvelope> {
    this.postMessage({ type: "stream_start", threadId, messageId });
    try {
      this.log(`route remote-agent-native kind=${command.kind} commandId=${command.commandId}`);
      const result = await handleCommand(command, {
        signal: context.signal,
        runtimeContext: context.runtimeContext
      });
      for (const chunk of chunkText(result.summary)) {
        this.postMessage({ type: "stream_chunk", threadId, messageId, chunk });
      }
      this.postMessage({ type: "stream_end", threadId, messageId });
      this.updateAssistantMessage(threadId, messageId, {
        text: result.summary,
        attachments: this.buildAttachmentsForResult(result)
      });
      return result;
    } catch (error) {
      this.postMessage({ type: "stream_end", threadId, messageId });
      const message = error instanceof Error ? error.message : String(error);
      const result = this.createRemoteResult(
        command,
        "error",
        t("chat.error.remoteAgentCommandFailedWithReason", { message })
      );
      this.updateAssistantMessage(threadId, messageId, {
        text: t("chat.error.agentCommandFailed"),
        attachments: [toErrorAttachment("agent_native_command_failed", error)]
      });
      return result;
    }
  }

  private async executeRemoteConversationCommand(
    command: CommandEnvelope,
    threadId: string,
    messageId: string,
    context: RemoteUiExecutionContext
  ): Promise<ResultEnvelope> {
    this.syncCodexRuntimeFlagsFromConfig();
    this.postMessage({ type: "stream_start", threadId, messageId });
    try {
      const contextRequest = this.stateStore.getStateDTO(threadId).context;
      const collected = await collectChatContext(contextRequest);
      const workspaceRoot = this.resolveRemoteWorkspaceRoot(
        context.runtimeContext,
        collected.runtime?.workspaceRoot
      );
      const prompt = buildRemoteConversationPrompt(command);
      const finalText = await this.codex.completeWithStreaming(
        prompt,
        collected.renderedContext,
        {
          onChunk: (chunk) => {
            this.postMessage({ type: "stream_chunk", threadId, messageId, chunk });
          }
        },
        context.signal,
        workspaceRoot
      );
      this.postMessage({ type: "stream_end", threadId, messageId });
      const summary = finalText.trim() || "empty assistant response";
      syncRuntimeLocaleFromReplyText(summary);
      this.updateAssistantMessage(threadId, messageId, {
        text: summary
      });
      return this.createRemoteResult(command, "ok", summary);
    } catch (error) {
      this.postMessage({ type: "stream_end", threadId, messageId });
      const message = extractErrorMessage(error);
      const summary = `codex complete failed: ${message}`;
      this.updateAssistantMessage(threadId, messageId, {
        text: t("chat.error.codexResponseFailed"),
        attachments: [toErrorAttachment("codex_complete_failed", error)]
      });
      return this.createRemoteResult(command, "error", summary);
    }
  }

  private async executeRemoteTaskCommand(
    command: CommandEnvelope,
    threadId: string,
    messageId: string,
    context: RemoteUiExecutionContext
  ): Promise<ResultEnvelope> {
    const prompt = command.prompt?.trim();
    if (!prompt) {
      const summary = t("chat.error.taskMissingPrompt");
      this.updateAssistantMessage(threadId, messageId, {
        text: summary,
        attachments: [{
          type: "error",
          code: "task_missing_prompt",
          message: summary
        }]
      });
      return this.createRemoteResult(command, "error", summary);
    }

    try {
      const contextRequest = this.stateStore.getStateDTO(threadId).context;
      const result = await this.executeTaskRequest({
        threadId,
        messageId,
        text: prompt,
        contextRequest,
        source: "wecom",
        fromUser: command.userId,
        signal: context.signal,
        runtimeContext: context.runtimeContext
      });
      if (result.proposal.type === "diff" && result.proposal.diffId) {
        this.remotePatchDiffIds.set(command.commandId, result.proposal.diffId);
      }
      if (result.requires.mode === "local_approval") {
        this.remoteGitSyncTaskByTaskId.set(result.taskId, {
          commandId: command.commandId,
          machineId: command.machineId
        });
      }
      return this.createRemoteResult(
        command,
        "ok",
        formatTaskResultForRemote(command.commandId, result, command.machineId),
        result.proposal.type === "diff" ? result.proposal.unifiedDiff : undefined
      );
    } catch (error) {
      if (context.signal?.aborted) {
        return this.createRemoteResult(command, "cancelled", t("chat.error.taskExecutionCancelled"));
      }
      this.updateAssistantMessage(threadId, messageId, {
        text: t("chat.error.taskExecutionFailed"),
        attachments: this.buildTaskFailureAttachments(error, "task_execution_failed")
      });
      const summary = t("chat.error.taskExecutionFailedWithReason", {
        message: extractErrorMessage(error)
      });
      return this.createRemoteResult(command, "error", summary);
    }
  }

  private async executeTaskRequest(input: TaskExecutionInput): Promise<TaskResult> {
    this.syncCodexRuntimeFlagsFromConfig();
    let resolvedIntent: Awaited<ReturnType<ChatViewProvider["resolveTaskIntent"]>>;
    try {
      if (input.source === "local_ui") {
        const unreadableReason = detectUnreadableTaskInput(input.text);
        if (unreadableReason) {
          this.logTask(`event=task_input_unreadable source=local_ui reason=${unreadableReason}`);
          throw new Error(t("chat.error.taskInputUnreadable"));
        }
      }
      resolvedIntent = await this.resolveTaskIntent(input.text, input.signal, input.source);
    } catch (error) {
      if (input.source === "local_ui") {
        this.emitLocalCommandSummary({
          status: input.signal?.aborted ? "cancelled" : "error",
          summary: input.signal?.aborted
            ? t("chat.error.taskExecutionCancelled")
            : t("chat.error.taskExecutionFailedWithReason", { message: extractErrorMessage(error) })
        });
      }
      throw error;
    }
    const { intent, routeSource } = resolvedIntent;
    const request: UserRequest = {
      source: input.source,
      threadId: input.threadId,
      fromUser: input.fromUser,
      text: input.text
    };
    const task = this.taskEngine.createTask(request, intent);
    this.taskInputById.set(task.taskId, {
      ...input,
      contextRequest: cloneContextRequest(input.contextRequest)
    });
    const localAbort = new AbortController();
    const taskSignal = mergeAbortSignals(input.signal, localAbort);
    this.taskAbortById.set(task.taskId, localAbort);
    let streamStarted = false;
    try {
      this.taskEngine.updateState(
        task.taskId,
        "ROUTED",
        intent.kind === "git_sync"
          ? t("chat.gitSync.collectingStatusAndDiffMetadata")
          : t("chat.task.state.intentRouter", { intent: intent.kind, router: routeSource })
      );
      const collected = await collectTaskContext(intent, input.contextRequest);
      this.taskEngine.updateState(
        task.taskId,
        "CONTEXT_COLLECTED",
        intent.kind === "git_sync" ? t("chat.gitSync.summarizingChanges") : undefined
      );
      this.taskEngine.updateState(
        task.taskId,
        "PROPOSING",
        intent.kind === "git_sync" ? t("chat.gitSync.preparingProposal") : undefined
      );
      this.postMessage({ type: "stream_start", threadId: input.threadId, messageId: input.messageId });
      streamStarted = true;
      const result = await runTask(
        {
          taskId: task.taskId,
          request,
          intent,
          renderedContext: collected.renderedContext,
          runtime: input.runtimeContext ?? collected.runtime,
          git: this.resolveGitTaskConfig(),
          signal: taskSignal,
          onChunk: (chunk) => {
            this.postMessage({
              type: "stream_chunk",
              threadId: input.threadId,
              messageId: input.messageId,
              chunk
            });
            this.taskEngine.emitStreamChunk(task.taskId, input.messageId, chunk);
          }
        },
        { codex: this.codex }
      );
      this.taskEngine.updateState(task.taskId, "PROPOSAL_READY");
      this.taskEngine.emitProposal(task.taskId, result);
      const text = renderTaskResultText(result);
      syncRuntimeLocaleFromReplyText(text);
      const attachments = this.buildAttachmentsForTaskResult(result, {
        threadId: input.threadId,
        messageId: input.messageId,
        source: input.source
      });
      if (streamStarted) {
        this.postMessage({ type: "stream_end", threadId: input.threadId, messageId: input.messageId });
      }
      this.updateAssistantMessage(input.threadId, input.messageId, {
        text,
        attachments
      });
      if (result.requires.mode === "local_approval") {
        const message = result.proposal.type === "git_sync_plan"
          ? t("chat.task.waitingApproval.gitSyncPlanReady")
          : result.requires.action === "apply_diff"
            ? t("chat.task.waitingApproval.diffProposalReady")
            : t("chat.task.waitingApproval.commandProposalReady");
        this.taskEngine.updateState(task.taskId, "WAITING_APPROVAL", message);
        await this.autoExecuteTaskAfterProposal(task.taskId, result, input);
        return result;
      } else {
        this.taskEngine.updateState(task.taskId, "COMPLETED");
        this.taskEngine.finish(task.taskId, "ok");
        if (input.source === "local_ui") {
          this.emitRemoteTaskMilestone(
            task.taskId,
            "ok",
            summarizeTaskResultForRemote(result) || result.summary,
            true
          );
        }
      }
      return result;
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      if (streamStarted) {
        this.postMessage({ type: "stream_end", threadId: input.threadId, messageId: input.messageId });
      }
      const aborted = taskSignal.aborted || isAbortError(error);
      const failedText = aborted
        ? t("chat.error.taskExecutionCancelled")
        : t("chat.error.taskExecutionFailed");
      this.updateAssistantMessage(input.threadId, input.messageId, {
        text: failedText,
        attachments: this.buildTaskFailureAttachments(
          error,
          aborted ? "task_execution_cancelled" : "task_execution_failed"
        )
      });
      const current = this.taskEngine.getTask(task.taskId);
      if (current && current.state !== "FAILED" && current.state !== "COMPLETED" && current.state !== "REJECTED") {
        this.taskEngine.updateState(
          task.taskId,
          "FAILED",
          aborted ? t("chat.error.taskCancelledInternal") : errorMessage
        );
      }
      this.taskEngine.finish(task.taskId, "error");
      if (input.source === "local_ui") {
        this.emitRemoteTaskMilestone(
          task.taskId,
          aborted ? "cancelled" : "error",
          aborted
            ? t("chat.error.taskExecutionCancelled")
            : t("chat.error.taskExecutionFailedWithReason", { message: errorMessage }),
          true
        );
      }
      throw error;
    } finally {
      this.taskAbortById.delete(task.taskId);
    }
  }

  private async autoExecuteTaskAfterProposal(
    taskId: string,
    result: TaskResult,
    input: TaskExecutionInput
  ): Promise<void> {
    if (input.source !== "local_ui" || result.requires.mode !== "local_approval") {
      return;
    }
    if (result.proposal.type === "command") {
      this.logTask(`taskId=${taskId} event=auto_execute action=run_command source=${input.source}`);
      await this.handleRunCommand(input.threadId, result.proposal.cmd, result.proposal.cwd);
      return;
    }
    if (result.proposal.type === "git_sync_plan") {
      this.logTask(`taskId=${taskId} event=auto_execute action=git_sync_run_all source=${input.source}`);
      await this.handleGitSyncAction(input.threadId, taskId, "run_all");
    }
  }

  private async executeRemotePatchCommand(
    command: CommandEnvelope,
    threadId: string,
    messageId: string,
    context: RemoteUiExecutionContext
  ): Promise<ResultEnvelope> {
    if (!command.prompt?.trim()) {
      const summary = t("chat.error.patchMissingPromptSummary");
      this.updateAssistantMessage(threadId, messageId, {
        text: t("chat.error.missingPatchPrompt"),
        attachments: [{
          type: "error",
          code: "patch_missing_prompt",
          message: summary
        }]
      });
      return this.createRemoteResult(command, "error", summary);
    }

    this.postMessage({ type: "stream_start", threadId, messageId });
    try {
      const contextRequest = this.stateStore.getStateDTO(threadId).context;
      const collected = await collectChatContext(contextRequest);
      const workspaceRoot = this.resolveRemoteWorkspaceRoot(
        context.runtimeContext,
        collected.runtime?.workspaceRoot
      );
      const generated = await generatePatchFromCodex(
        command.prompt,
        workspaceRoot,
        context.runtimeContext ?? collected.runtime,
        context.signal
      );
      if (!looksLikeUnifiedDiff(generated.diff)) {
        const summary = t("chat.error.patchInvalidDiffSummary");
        this.postMessage({ type: "stream_end", threadId, messageId });
        this.updateAssistantMessage(threadId, messageId, {
          text: t("chat.error.patchGenerationFailed"),
          attachments: [{
            type: "error",
            code: "patch_invalid_diff",
            message: summary
          }]
        });
        return this.createRemoteResult(command, "error", summary);
      }

      const maxDiffBytes = Number(process.env.MAX_DIFF_BYTES ?? "200000");
      if (Buffer.byteLength(generated.diff, "utf8") > maxDiffBytes) {
        const summary = t("chat.error.patchTooLargeSummary", { maxBytes: maxDiffBytes });
        this.postMessage({ type: "stream_end", threadId, messageId });
        this.updateAssistantMessage(threadId, messageId, {
          text: t("chat.error.patchGenerationFailed"),
          attachments: [{
            type: "error",
            code: "patch_too_large",
            message: summary
          }]
        });
        return this.createRemoteResult(command, "rejected", summary);
      }

      const record = this.diffStore.put(generated.diff, `Remote diff ${command.commandId}`);
      this.remotePatchDiffIds.set(command.commandId, record.diffId);
      const detailSummary = [
        generated.summary,
        `Files: ${record.files.length}`,
        ...record.files.map((item) => `- ${item.path} (+${item.additions} -${item.deletions})`)
      ].join("\n");
      for (const chunk of chunkText(detailSummary)) {
        this.postMessage({ type: "stream_chunk", threadId, messageId, chunk });
      }
      this.postMessage({ type: "stream_end", threadId, messageId });
      syncRuntimeLocaleFromReplyText(generated.summary);
      this.updateAssistantMessage(threadId, messageId, {
        text: detailSummary,
        attachments: [this.diffStore.toAttachment(record.diffId)].filter(Boolean) as Attachment[]
      });
      return this.createRemoteResult(command, "ok", generated.summary, generated.diff);
    } catch (error) {
      this.postMessage({ type: "stream_end", threadId, messageId });
      if (context.signal?.aborted) {
        const summary = t("chat.error.patchGenerationCancelledSummary");
        this.updateAssistantMessage(threadId, messageId, {
          text: summary
        });
        return this.createRemoteResult(command, "cancelled", summary);
      }
      const detail = error instanceof Error ? error.message : "unknown codex error";
      const summary = t("chat.error.codexPatchGenerationFailedWithReason", { message: detail });
      this.updateAssistantMessage(threadId, messageId, {
        text: t("chat.error.patchGenerationFailed"),
        attachments: [toErrorAttachment("patch_generation_failed", error)]
      });
      return this.createRemoteResult(command, "error", summary);
    }
  }

  private async executeRemoteApplyCommand(
    command: CommandEnvelope,
    threadId: string,
    messageId: string,
    context: RemoteUiExecutionContext
  ): Promise<ResultEnvelope> {
    this.postMessage({ type: "stream_start", threadId, messageId });
    if (!command.refId) {
      const summary = t("chat.error.applyMissingRefIdSummary");
      this.postMessage({ type: "stream_end", threadId, messageId });
      this.updateAssistantMessage(threadId, messageId, {
        text: summary,
        attachments: [{
          type: "error",
          code: "apply_missing_refid",
          message: summary
        }]
      });
      return this.createRemoteResult(command, "error", summary);
    }
    const diffId = this.remotePatchDiffIds.get(command.refId);
    if (!diffId) {
      const summary = t("chat.error.applyMissingCachedPatchSummary", { refId: command.refId });
      this.postMessage({ type: "stream_end", threadId, messageId });
      this.updateAssistantMessage(threadId, messageId, {
        text: summary,
        attachments: [{
          type: "error",
          code: "apply_missing_cached_patch",
          message: summary
        }]
      });
      return this.createRemoteResult(command, "error", summary);
    }

    const workspaceRoot = this.resolveRemoteWorkspaceRoot(context.runtimeContext);
    const result = await applyDiffWithConfirmation(this.diffStore, diffId, workspaceRoot, {
      source: "wecom"
    });
    const normalizedSummary = normalizeApplySummary(result.message, result.ok);
    this.postMessage({ type: "stream_chunk", threadId, messageId, chunk: normalizedSummary });
    this.postMessage({ type: "stream_end", threadId, messageId });
    this.updateAssistantMessage(threadId, messageId, {
      text: normalizedSummary,
      attachments: result.ok
        ? undefined
        : [{
          type: "error",
          code: result.rejected ? "apply_rejected" : "apply_failed",
          message: normalizedSummary,
          details: result.details
        }]
    });
    return this.createRemoteResult(
      command,
      result.ok ? "ok" : (result.rejected ? "rejected" : "error"),
      normalizedSummary
    );
  }

  private async executeRemoteTestCommand(
    command: CommandEnvelope,
    threadId: string,
    messageId: string,
    context: RemoteUiExecutionContext
  ): Promise<ResultEnvelope> {
    this.postMessage({ type: "stream_start", threadId, messageId });
    const workspaceRoot = this.resolveRemoteWorkspaceRoot(context.runtimeContext);
    const result = await runTestWithConfirmation(workspaceRoot, command.prompt?.trim() || undefined, {
      source: "wecom"
    });
    const summary = result.logs ? `${result.message}\n${result.logs}` : result.message;
    for (const chunk of chunkText(summary)) {
      this.postMessage({ type: "stream_chunk", threadId, messageId, chunk });
    }
    this.postMessage({ type: "stream_end", threadId, messageId });
    this.updateAssistantMessage(threadId, messageId, {
      text: summary,
      attachments: result.logs
        ? [{ type: "logs", title: t("chat.task.attachment.testOutputTitle"), text: result.logs }]
        : (result.ok ? undefined : [{
          type: "error",
          code: result.rejected ? "test_rejected" : "test_failed",
          message: result.message
        }])
    });
    return this.createRemoteResult(
      command,
      result.ok ? "ok" : (result.rejected ? "rejected" : "error"),
      summary
    );
  }

  private createRemoteResult(
    command: CommandEnvelope,
    status: ResultStatus,
    summary: string,
    diff?: string
  ): ResultEnvelope {
    return {
      commandId: command.commandId,
      machineId: command.machineId,
      status,
      summary,
      diff,
      createdAt: new Date().toISOString()
    };
  }

  private resolveRemoteWorkspaceRoot(
    runtimeContext?: RuntimeContextSnapshot,
    collectedWorkspaceRoot?: string
  ): string {
    const fromContext = runtimeContext?.workspaceRoot?.trim();
    if (fromContext) {
      return fromContext;
    }
    const fromCollected = collectedWorkspaceRoot?.trim();
    if (fromCollected) {
      return fromCollected;
    }
    return resolveWorkspaceRoot() ?? process.env.WORKSPACE_ROOT ?? process.cwd();
  }

  private async resolvePatchSlash(
    threadId: string,
    messageId: string,
    arg: string,
    contextRequest: UIContextRequest
  ): Promise<void> {
    const patchPrompt = arg.trim();
    if (!patchPrompt) {
      this.updateAssistantMessage(threadId, messageId, {
        text: t("chat.error.patchPromptRequired"),
        attachments: [{
          type: "error",
          code: "patch_missing_prompt",
          message: t("chat.error.patchPromptAttachmentRequired")
        }]
      });
      this.emitLocalCommandSummary({
        status: "error",
        summary: t("chat.error.patchPromptRequired")
      });
      return;
    }
    const context = await collectChatContext(contextRequest);
    const workspaceRoot = context.runtime?.workspaceRoot ?? resolveWorkspaceRoot();
    if (!workspaceRoot) {
      this.updateAssistantMessage(threadId, messageId, {
        text: t("chat.error.noWorkspaceOpen"),
        attachments: [{
          type: "error",
          code: "workspace_missing",
          message: t("chat.error.patchWorkspaceRequired")
        }]
      });
      this.emitLocalCommandSummary({
        status: "error",
        summary: t("chat.error.noWorkspaceOpen")
      });
      return;
    }

    this.postMessage({ type: "stream_start", threadId, messageId });
    try {
      const generated = await generatePatchFromCodex(
        patchPrompt,
        workspaceRoot,
        context.runtime
      );
      const record = this.diffStore.put(generated.diff, "Generated Patch");
      const summary = [
        generated.summary,
        `Files: ${record.files.length}`,
        ...record.files.map((item) => `- ${item.path} (+${item.additions} -${item.deletions})`)
      ].join("\n");
      for (const chunk of chunkText(summary)) {
        this.postMessage({ type: "stream_chunk", threadId, messageId, chunk });
      }
      this.postMessage({ type: "stream_end", threadId, messageId });
      this.updateAssistantMessage(threadId, messageId, {
        text: summary,
        attachments: [this.diffStore.toAttachment(record.diffId)].filter(Boolean) as Attachment[]
      });
      this.emitLocalCommandSummary({
        status: "ok",
        summary: generated.summary
      });
    } catch (error) {
      this.log(`patch generation failed: ${error instanceof Error ? error.message : String(error)}`);
      this.postMessage({ type: "stream_end", threadId, messageId });
      this.updateAssistantMessage(threadId, messageId, {
        text: t("chat.error.patchGenerationFailed"),
        attachments: [toErrorAttachment("patch_generation_failed", error)]
      });
      this.postMessage({
        type: "toast",
        level: "error",
        message: t("chat.error.patchGenerationFailedWithReason", {
          message: error instanceof Error ? error.message : String(error)
        })
      });
      this.emitLocalCommandSummary({
        status: "error",
        summary: t("chat.error.patchGenerationFailedWithReason", {
          message: error instanceof Error ? error.message : String(error)
        })
      });
    }
  }

  private async resolveTestSlash(threadId: string, messageId: string, commandText: string): Promise<void> {
    const workspaceRoot = resolveWorkspaceRoot() ?? process.env.WORKSPACE_ROOT ?? process.cwd();
    const result = await runTestWithConfirmation(workspaceRoot, commandText || undefined);
    const attachments: Attachment[] = result.logs
      ? [{ type: "logs", title: t("chat.task.attachment.testOutputTitle"), text: result.logs }]
      : [];
    this.updateAssistantMessage(threadId, messageId, {
      text: result.message,
      attachments
    });
    this.postMessage({
      type: "action_result",
      action: "run_test",
      ok: result.ok,
      message: result.message
    });
    this.emitLocalCommandSummary({
      status: resolveResultStatus(result.ok, result.rejected),
      summary: result.message
    });
  }

  private async handleViewDiff(threadId: string, diffId: string): Promise<void> {
    const workspaceRoot = resolveWorkspaceRoot() ?? process.env.WORKSPACE_ROOT ?? process.cwd();
    const result = await viewDiff(this.diffStore, this.virtualDocs, diffId, workspaceRoot);
    this.postMessage({
      type: "action_result",
      action: "view_diff",
      ok: result.ok,
      message: result.message
    });
    if (!result.ok) {
      this.postMessage({ type: "toast", level: "warn", message: result.message });
    }
    this.sendThreadState(threadId);
  }

  private async handleApplyDiff(threadId: string, diffId: string): Promise<void> {
    const workspaceRoot = resolveWorkspaceRoot() ?? process.env.WORKSPACE_ROOT ?? process.cwd();
    const taskId = this.diffTaskByDiffId.get(diffId);
    const result = await applyDiffWithConfirmation(this.diffStore, diffId, workspaceRoot, {
      source: "local_ui",
      onApproved: () => {
        if (taskId) {
          this.transitionTaskToExecuting(taskId, t("chat.state.executingApprovedDiff"));
        }
      }
    });
    let validation: ChangeValidationResult | undefined;
    if (taskId && result.ok && !result.rejected) {
      validation = await this.runPostApplyValidation(taskId, workspaceRoot);
      const finalTaskSummary = [result.message, validation.summary].filter(Boolean).join("\n");
      this.finalizeTaskExecutionFromAction(taskId, validation.ok, false, finalTaskSummary);
    } else if (taskId) {
      this.finalizeTaskExecutionFromAction(taskId, result.ok, result.rejected, result.message);
    }

    const overallOk = result.ok && (!validation || validation.ok);
    const mergedMessage = [result.message, validation?.summary].filter(Boolean).join("\n");
    const detailsText = [result.details ? String(result.details) : "", validation?.logs || ""]
      .filter(Boolean)
      .join("\n")
      .trim();
    const attachments: Attachment[] = [];
    if (validation?.logs) {
      attachments.push({
        type: "logs",
        title: t("chat.task.attachment.validationLogsTitle"),
        text: validation.logs
      });
    }
    if (!overallOk) {
      attachments.push({
        type: "error",
        code: result.rejected
          ? "apply_rejected"
          : (result.ok ? "validation_failed" : "apply_failed"),
        message: mergedMessage,
        details: detailsText || undefined
      });
    }
    const message = this.stateStore.appendMessage(threadId, {
      role: "tool",
      text: mergedMessage,
      attachments: attachments.length > 0 ? attachments : undefined
    });
    this.postMessage({
      type: "append_message",
      threadId,
      message: toMessageDTO(message)
    });
    this.postMessage({
      type: "action_result",
      action: "apply_diff",
      ok: overallOk,
      message: mergedMessage,
      details: detailsText || result.details
    });
    this.postMessage({
      type: "toast",
      level: overallOk ? "info" : "warn",
      message: mergedMessage
    });
    if (!taskId) {
      this.emitLocalCommandSummary({
        status: result.rejected ? "rejected" : (overallOk ? "ok" : "error"),
        summary: mergedMessage
      });
    }
  }

  private async runPostApplyValidation(taskId: string, workspaceRoot: string): Promise<ChangeValidationResult> {
    const config = vscode.workspace.getConfiguration("codexbridge");
    const configuredDefault = config.get<string>("defaultTestCommand", getDefaultTestCommand());
    const command = configuredDefault?.trim() || getDefaultTestCommand();
    this.safeTransitionTask(taskId, "VERIFYING", t("chat.state.verifyingChanges", { command }));

    const allowRunTerminal = config.get<boolean>("allowRunTerminal", false);
    if (!allowRunTerminal) {
      return {
        ok: true,
        summary: t("chat.state.verificationSkippedRunDisabled", { command }),
        logs: ""
      };
    }
    if (!isAllowedTestCommand(command)) {
      return {
        ok: true,
        summary: t("chat.state.verificationSkippedCommandNotAllowed", { command }),
        logs: ""
      };
    }

    const run = await runTestCommand(command, undefined, workspaceRoot);
    if (run.cancelled) {
      return {
        ok: false,
        summary: t("chat.state.verificationCancelled", { command }),
        logs: run.outputTail
      };
    }
    if (run.timedOut) {
      return {
        ok: false,
        summary: t("chat.state.verificationTimedOut", { command }),
        logs: run.outputTail
      };
    }
    const exitCode = typeof run.code === "number" ? run.code : -1;
    if (exitCode !== 0) {
      return {
        ok: false,
        summary: t("chat.state.verificationFailed", { command, code: String(exitCode) }),
        logs: run.outputTail
      };
    }
    return {
      ok: true,
      summary: t("chat.state.verificationPassed", { command }),
      logs: run.outputTail
    };
  }

  private async handleRunTest(threadId: string, cmd?: string): Promise<void> {
    const workspaceRoot = resolveWorkspaceRoot() ?? process.env.WORKSPACE_ROOT ?? process.cwd();
    const result = await runTestWithConfirmation(workspaceRoot, cmd);
    const attachments: Attachment[] = result.logs
      ? [{ type: "logs", title: t("chat.task.attachment.testOutputTitle"), text: result.logs }]
      : [];
    const message = this.stateStore.appendMessage(threadId, {
      role: "tool",
      text: result.message,
      attachments
    });
    this.postMessage({
      type: "append_message",
      threadId,
      message: toMessageDTO(message)
    });
    this.postMessage({
      type: "action_result",
      action: "run_test",
      ok: result.ok,
      message: result.message
    });
    this.emitLocalCommandSummary({
      status: resolveResultStatus(result.ok, result.rejected),
      summary: result.message
    });
  }

  private async handleRunCommand(threadId: string, cmd: string, cwd?: string): Promise<void> {
    const normalizedCommand = sanitizeRunCommand(cmd);
    if (!normalizedCommand) {
      this.postMessage({
        type: "action_result",
        action: "run_command",
        ok: false,
        message: t("chatActions.error.commandEmpty")
      });
      this.emitLocalCommandSummary({
        status: "error",
        summary: t("chatActions.error.commandEmpty")
      });
      return;
    }
    const workspaceRoot = cwd?.trim()
      || resolveWorkspaceRoot()
      || process.env.WORKSPACE_ROOT
      || process.cwd();
    const commandKey = buildCommandTaskKey(normalizedCommand, workspaceRoot);
    const binding = this.commandTaskByKey.get(commandKey);
    const result = await runCommandWithConfirmation(workspaceRoot, normalizedCommand, {
      source: "local_ui",
      requireAllowRunTerminal: !isSafeGitCommand(normalizedCommand),
      onApproved: () => {
        if (binding) {
          this.transitionTaskToExecuting(binding.taskId, t("chat.state.executingApprovedCommand"));
        }
      }
    });
    if (binding) {
      this.finalizeTaskExecutionFromAction(binding.taskId, result.ok, result.rejected, result.message);
    }
    const attachments: Attachment[] = result.logs
      ? [{ type: "logs", title: t("chat.task.attachment.commandOutputTitle"), text: result.logs }]
      : [];
    const message = this.stateStore.appendMessage(threadId, {
      role: "tool",
      text: result.message,
      attachments
    });
    this.postMessage({
      type: "append_message",
      threadId,
      message: toMessageDTO(message)
    });
    this.postMessage({
      type: "action_result",
      action: "run_command",
      ok: result.ok,
      message: result.message
    });
    if (!binding) {
      this.emitLocalCommandSummary({
        status: resolveResultStatus(result.ok, result.rejected),
        summary: result.message
      });
    }
  }

  private async handleGitSyncAction(
    threadId: string,
    taskId: string,
    action: "run_all" | "add" | "commit" | "push"
  ): Promise<void> {
    const session = this.gitSyncSessionByTaskId.get(taskId)
      ?? this.rehydrateGitSyncSession(threadId, taskId);
    if (!session || session.threadId !== threadId) {
      this.postMessage({
        type: "action_result",
        action: "git_sync_action",
        ok: false,
        message: t("chat.gitSync.taskNotFound", { taskId })
      });
      return;
    }
    const task = this.taskEngine.getTask(taskId);
    if (!task) {
      this.postMessage({
        type: "action_result",
        action: "git_sync_action",
        ok: false,
        message: t("chat.error.unknownTask", { taskId })
      });
      return;
    }
    if (isTerminalTaskState(task.state)) {
      this.postMessage({
        type: "action_result",
        action: "git_sync_action",
        ok: false,
        message: t("chat.error.taskAlreadyFinished", { taskId })
      });
      return;
    }
    if (this.gitSyncTaskLock.has(taskId)) {
      this.postMessage({
        type: "action_result",
        action: "git_sync_action",
        ok: false,
        message: t("chat.gitSync.taskAlreadyExecuting")
      });
      return;
    }

    this.gitSyncTaskLock.add(taskId);
    try {
      let outcome: { ok: boolean; message: string };
      if (action === "run_all") {
        outcome = await this.executeGitSyncRunAll(session);
      } else {
        outcome = await this.executeGitSyncSingleStep(session, action);
      }
      this.postMessage({
        type: "action_result",
        action: "git_sync_action",
        ok: outcome.ok,
        message: outcome.message
      });
      this.postMessage({
        type: "toast",
        level: outcome.ok ? "info" : "warn",
        message: outcome.message
      });
      if (!outcome.ok) {
        const latest = this.taskEngine.getTask(taskId);
        if (latest && latest.state === "EXECUTING") {
          this.safeTransitionTask(taskId, "FAILED", outcome.message);
          this.safeFinishTask(taskId, "error");
          this.emitRemoteTaskMilestone(taskId, "error", outcome.message, true);
        } else if (
          latest
          && latest.request.source === "local_ui"
          && !isTerminalTaskState(latest.state)
        ) {
          this.emitLocalCommandSummary({
            status: "error",
            summary: outcome.message
          });
        }
      }
    } catch (error) {
      const message = extractErrorMessage(error);
      this.postMessage({
        type: "action_result",
        action: "git_sync_action",
        ok: false,
        message
      });
      this.postMessage({
        type: "toast",
        level: "error",
        message
      });
      const latest = this.taskEngine.getTask(taskId);
      if (latest && !isTerminalTaskState(latest.state)) {
        this.safeTransitionTask(taskId, "FAILED", message);
        this.safeFinishTask(taskId, "error");
        this.emitRemoteTaskMilestone(taskId, "error", message, true);
      }
    } finally {
      this.gitSyncTaskLock.delete(taskId);
      this.refreshGitSyncCard(session);
    }
  }

  private async executeGitSyncRunAll(session: GitSyncSession): Promise<{ ok: boolean; message: string }> {
    const pendingSteps = this.getPendingGitSyncSteps(session);
    if (pendingSteps.length <= 0) {
      return { ok: true, message: t("chat.gitSync.noPendingActions") };
    }

    const approved = await this.requestGitSyncRunAllApproval(session, pendingSteps);
    if (!approved) {
      this.safeTransitionTask(
        session.taskId,
        "WAITING_APPROVAL",
        t("chat.gitSync.runAllApprovalRejectedState")
      );
      this.emitRemoteTaskMilestone(
        session.taskId,
        "rejected",
        t("chat.gitSync.runAllApprovalRejectedMilestone")
      );
      return { ok: false, message: t("chat.gitSync.executionRejectedLocally") };
    }

    this.safeTransitionTask(session.taskId, "EXECUTING", t("chat.gitSync.executingApprovedActions"));
    for (const stepId of pendingSteps) {
      const stepResult = await this.executeGitSyncStep(session, stepId);
      if (!stepResult.ok) {
        return stepResult;
      }
    }
    return await this.finalizeGitSyncSuccess(session);
  }

  private async executeGitSyncSingleStep(
    session: GitSyncSession,
    stepId: GitSyncStepId
  ): Promise<{ ok: boolean; message: string }> {
    const action = this.getGitSyncStepAction(session, stepId);
    if (!action) {
      return { ok: false, message: t("chat.gitSync.stepNotAvailableInPlan", { stepId }) };
    }
    if (session.stepState[stepId] === "completed") {
      return { ok: true, message: t("chat.gitSync.stepAlreadyCompleted", { stepId }) };
    }

    const blockedReason = this.validateGitSyncStepPrerequisites(session, stepId);
    if (blockedReason) {
      return { ok: false, message: blockedReason };
    }

    const approved = await this.requestGitSyncStepApproval(session, action.id);
    if (!approved) {
      this.safeTransitionTask(
        session.taskId,
        "WAITING_APPROVAL",
        t("chat.gitSync.stepApprovalRejectedState", { stepId: action.id })
      );
      this.emitRemoteTaskMilestone(
        session.taskId,
        "rejected",
        t("chat.gitSync.stepApprovalRejectedMilestone", { stepId: action.id })
      );
      return {
        ok: false,
        message: t("chat.gitSync.stepRejectedLocally", { stepId: action.id })
      };
    }

    this.safeTransitionTask(session.taskId, "EXECUTING", t("chat.gitSync.executingStep", { stepId: action.id }));
    const stepResult = await this.executeGitSyncStep(session, action.id);
    if (!stepResult.ok) {
      return stepResult;
    }
    if (this.getPendingGitSyncSteps(session).length <= 0) {
      return await this.finalizeGitSyncSuccess(session);
    }
    this.safeTransitionTask(
      session.taskId,
      "WAITING_APPROVAL",
      t("chat.gitSync.stepCompletedWaitingApproval", { stepId: action.id })
    );
    return { ok: true, message: t("chat.gitSync.stepCompleted", { stepId: action.id }) };
  }

  private async executeGitSyncStep(
    session: GitSyncSession,
    stepId: GitSyncStepId
  ): Promise<{ ok: boolean; message: string }> {
    const action = this.getGitSyncStepAction(session, stepId);
    if (!action) {
      return { ok: false, message: t("chat.gitSync.unknownStepAction", { stepId }) };
    }

    this.taskEngine.emitStreamChunk(
      session.taskId,
      session.messageId,
      `${t("chat.gitSync.stepExecutingMilestone", { stepId })}\n`
    );
    this.emitRemoteTaskMilestone(
      session.taskId,
      "ok",
      t("chat.gitSync.stepExecutingMilestone", { stepId })
    );
    this.logTask(`taskId=${session.taskId} event=git_sync_step step=${stepId} status=executing`);

    let ok = false;
    let message = "";
    let raw = "";

    if (stepId === "add") {
      const result = await this.gitTool.addAll(session.workspaceRoot);
      ok = result.ok;
      raw = result.raw;
      message = ok ? t("chat.gitSync.addCompleted") : t("chat.gitSync.addFailed");
    } else if (stepId === "commit") {
      const commitMessage = sanitizeGitSyncCommitMessage(session.proposal.commitMessage ?? "");
      if (!commitMessage) {
        return { ok: false, message: t("chat.gitSync.missingCommitMessage") };
      }
      const result = await this.gitTool.commit(session.workspaceRoot, commitMessage);
      ok = result.ok;
      raw = result.raw ?? "";
      message = result.message ?? (ok ? t("chat.gitSync.commitCompleted") : t("chat.gitSync.commitFailed"));
      if (ok && result.commitSha) {
        session.commitSha = result.commitSha;
      }
    } else if (stepId === "push") {
      const remote = action.remote?.trim() || this.resolveGitTaskConfig().defaultRemote;
      const branch = action.branch?.trim() || session.proposal.branch?.trim() || "HEAD";
      const result = await this.gitTool.push(session.workspaceRoot, remote, branch, Boolean(action.setUpstream));
      ok = result.ok;
      raw = result.raw ?? "";
      message = result.message ?? (ok ? t("chat.gitSync.pushCompleted") : t("chat.gitSync.pushFailed"));
      if (ok && result.message) {
        session.pushSummary = result.message;
      }
    }

    if (!ok) {
      session.stepState[stepId] = "failed";
      session.stepLogs[stepId] = clipMultiline(raw || message, 4000);
      this.refreshGitSyncCard(session);
      const failed = t("chat.gitSync.stepFailedSummary", { stepId, message });
      this.safeTransitionTask(session.taskId, "FAILED", failed);
      this.safeFinishTask(session.taskId, "error");
      this.emitRemoteTaskMilestone(session.taskId, "error", failed, true);
      this.logTask(`taskId=${session.taskId} event=git_sync_step step=${stepId} status=failed`);
      return { ok: false, message: failed };
    }

    session.stepState[stepId] = "completed";
    session.stepLogs[stepId] = clipMultiline(raw || message, 4000);
    this.refreshGitSyncCard(session);
    this.taskEngine.emitStreamChunk(
      session.taskId,
      session.messageId,
      `${t("chat.gitSync.stepCompleted", { stepId })}\n`
    );
    this.logTask(`taskId=${session.taskId} event=git_sync_step step=${stepId} status=completed`);
    return { ok: true, message };
  }

  private async finalizeGitSyncSuccess(session: GitSyncSession): Promise<{ ok: true; message: string }> {
    try {
      const latestStatus = await this.gitTool.getStatus(session.workspaceRoot);
      session.proposal.ahead = latestStatus.ahead;
      session.proposal.behind = latestStatus.behind;
      session.proposal.staged = latestStatus.staged;
      session.proposal.unstaged = latestStatus.unstaged;
      session.proposal.untracked = latestStatus.untracked;
      session.proposal.diffStat = latestStatus.diffStat;
      session.proposal.branch = latestStatus.branch;
      session.proposal.upstream = latestStatus.upstream;
    } catch (error) {
      this.logTask(
        `taskId=${session.taskId} event=git_sync_status_refresh_failed error=${extractErrorMessage(error)}`
      );
    }

    const pieces = [
      t("chat.gitSync.completedPrefix"),
      session.commitSha ? `commit=${session.commitSha}` : "",
      session.pushSummary ? `push=${toSingleLine(session.pushSummary, 160)}` : "",
      `ahead=${session.proposal.ahead} behind=${session.proposal.behind}`
    ].filter(Boolean);
    const message = pieces.join(" ");
    this.refreshGitSyncCard(session);
    this.safeTransitionTask(session.taskId, "COMPLETED", message);
    this.safeFinishTask(session.taskId, "ok");
    this.emitRemoteTaskMilestone(session.taskId, "ok", message, true);
    return { ok: true, message };
  }

  private getPendingGitSyncSteps(session: GitSyncSession): GitSyncStepId[] {
    const pending: GitSyncStepId[] = [];
    for (const stepId of GIT_SYNC_STEP_ORDER) {
      const action = this.getGitSyncStepAction(session, stepId);
      if (!action) {
        continue;
      }
      if (session.stepState[stepId] === "pending") {
        pending.push(stepId);
      }
    }
    return pending;
  }

  private validateGitSyncStepPrerequisites(
    session: GitSyncSession,
    stepId: GitSyncStepId
  ): string | undefined {
    if (stepId === "commit") {
      const addAction = this.getGitSyncStepAction(session, "add");
      if (addAction && session.stepState.add !== "completed") {
        return t("chat.gitSync.prereqApproveAddBeforeCommit");
      }
    }
    if (stepId === "push") {
      const commitAction = this.getGitSyncStepAction(session, "commit");
      if (commitAction && session.stepState.commit !== "completed") {
        return t("chat.gitSync.prereqApproveCommitBeforePush");
      }
    }
    return undefined;
  }

  private getGitSyncStepAction(
    session: GitSyncSession,
    stepId: GitSyncStepId
  ): GitSyncProposal["actions"][number] | undefined {
    return session.proposal.actions.find((action) => action.id === stepId);
  }

  private async requestGitSyncRunAllApproval(
    session: GitSyncSession,
    steps: GitSyncStepId[]
  ): Promise<boolean> {
    const branchText = session.proposal.branch ?? t("chat.gitSync.placeholderDetached");
    const upstreamText = session.proposal.upstream ?? t("chat.gitSync.placeholderNone");
    const detailLines: string[] = [
      t("chat.gitSync.detailRepo", { repo: session.workspaceRoot }),
      t("chat.gitSync.detailBranch", { branch: branchText }),
      t("chat.gitSync.detailUpstream", { upstream: upstreamText }),
      t("chat.gitSync.detailStepsHeader")
    ];
    for (const stepId of steps) {
      const action = this.getGitSyncStepAction(session, stepId);
      if (action) {
        detailLines.push(`- ${action.cmd}`);
      }
    }
    if (session.proposal.commitMessage) {
      detailLines.push(t("chat.gitSync.detailCommitMessage", { message: session.proposal.commitMessage }));
    }
    if (steps.includes("push")) {
      detailLines.push(t("chat.gitSync.detailPushWarning"));
    }
    const decision = await requestApproval({
      action: "run_command",
      source: session.source as ApprovalSource,
      question: t("chat.gitSync.runAllApprovalQuestion"),
      approveLabel: session.primaryAction === "push"
        ? t("chat.gitSync.approvePushLabel")
        : t("chat.gitSync.approveRunAllLabel"),
      rejectLabel: t("chat.gitSync.rejectLabel"),
      details: detailLines
    });
    return decision === "approved";
  }

  private async requestGitSyncStepApproval(
    session: GitSyncSession,
    stepId: GitSyncStepId
  ): Promise<boolean> {
    const action = this.getGitSyncStepAction(session, stepId);
    if (!action) {
      return false;
    }
    const branchText = session.proposal.branch ?? t("chat.gitSync.placeholderDetached");
    const detailLines: string[] = [
      t("chat.gitSync.detailRepo", { repo: session.workspaceRoot }),
      t("chat.gitSync.detailBranch", { branch: branchText }),
      t("chat.gitSync.detailCommand", { command: action.cmd })
    ];
    if (stepId === "commit" && session.proposal.commitMessage) {
      detailLines.push(t("chat.gitSync.detailCommitMessage", { message: session.proposal.commitMessage }));
    }
    if (stepId === "push") {
      detailLines.push(t("chat.gitSync.detailPushWarning"));
    }
    const decision = await requestApproval({
      action: "run_command",
      source: session.source as ApprovalSource,
      question: t("chat.gitSync.stepApprovalQuestion", { stepId }),
      approveLabel: t("chat.gitSync.approveStepLabel", { stepId: capitalize(stepId) }),
      rejectLabel: t("chat.gitSync.rejectLabel"),
      details: detailLines
    });
    return decision === "approved";
  }

  private toGitSyncCardAttachment(session: GitSyncSession): Attachment {
    const steps = GIT_SYNC_STEP_ORDER
      .map((stepId) => {
        const action = this.getGitSyncStepAction(session, stepId);
        if (!action) {
          return undefined;
        }
        return {
          id: action.id,
          title: action.title,
          cmd: action.cmd,
          cwd: action.cwd,
          risk: action.risk,
          requiresApproval: action.requiresApproval,
          status: session.stepState[action.id]
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const stepLogs = GIT_SYNC_STEP_ORDER
      .map((stepId) => {
        const text = session.stepLogs[stepId];
        if (!text) {
          return undefined;
        }
        return { stepId, text };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return {
      type: "git_sync_action_card",
      taskId: session.taskId,
      title: t("chat.gitSync.cardTitle"),
      workspaceRoot: session.workspaceRoot,
      branch: session.proposal.branch,
      upstream: session.proposal.upstream,
      ahead: session.proposal.ahead,
      behind: session.proposal.behind,
      staged: session.proposal.staged,
      unstaged: session.proposal.unstaged,
      untracked: session.proposal.untracked,
      diffStat: session.proposal.diffStat,
      commitMessage: session.proposal.commitMessage,
      notes: session.proposal.notes ?? [],
      primaryAction: session.primaryAction,
      steps,
      stepLogs
    };
  }

  private refreshGitSyncCard(session: GitSyncSession): void {
    this.updateAssistantMessage(session.threadId, session.messageId, {
      attachments: [this.toGitSyncCardAttachment(session)]
    });
  }

  private rehydrateGitSyncSession(threadId: string, taskId: string): GitSyncSession | undefined {
    const state = this.stateStore.getStateDTO(threadId);
    for (const message of [...state.messages].reverse()) {
      for (const attachment of message.attachments ?? []) {
        if (attachment.type !== "git_sync_action_card" || attachment.taskId !== taskId) {
          continue;
        }
        const proposal: GitSyncProposal = {
          type: "git_sync_plan",
          branch: attachment.branch,
          upstream: attachment.upstream,
          ahead: attachment.ahead,
          behind: attachment.behind,
          staged: attachment.staged,
          unstaged: attachment.unstaged,
          untracked: attachment.untracked,
          diffStat: attachment.diffStat,
          commitMessage: attachment.commitMessage,
          notes: attachment.notes,
          actions: attachment.steps.map((step) => ({
            id: step.id,
            title: step.title,
            cmd: step.cmd,
            cwd: step.cwd,
            risk: step.risk,
            requiresApproval: true,
            remote: step.id === "push" ? extractPushRemote(step.cmd) : undefined,
            branch: step.id === "push" ? extractPushBranch(step.cmd) : undefined,
            setUpstream: step.id === "push" ? /^git\s+push\s+-(u|--set-upstream)\b/i.test(step.cmd.trim()) : undefined
          }))
        };
        const restored: GitSyncSession = {
          taskId,
          threadId,
          messageId: message.id,
          source: this.taskEngine.getTask(taskId)?.request.source ?? "local_ui",
          workspaceRoot: attachment.workspaceRoot
            || attachment.steps.find((step) => Boolean(step.cwd))?.cwd
            || resolveWorkspaceRoot()
            || process.env.WORKSPACE_ROOT
            || process.cwd(),
          proposal,
          primaryAction: attachment.primaryAction,
          stepState: {
            add: attachment.steps.find((step) => step.id === "add")?.status ?? "skipped",
            commit: attachment.steps.find((step) => step.id === "commit")?.status ?? "skipped",
            push: attachment.steps.find((step) => step.id === "push")?.status ?? "skipped"
          },
          stepLogs: Object.fromEntries(
            (attachment.stepLogs ?? []).map((item) => [item.stepId, item.text])
          ) as Partial<Record<GitSyncStepId, string>>
        };
        this.gitSyncSessionByTaskId.set(taskId, restored);
        return restored;
      }
    }
    return undefined;
  }

  private emitRemoteTaskMilestone(
    taskId: string,
    status: ResultStatus,
    summary: string,
    terminal = false
  ): void {
    if (terminal) {
      const task = this.taskEngine.getTask(taskId);
      if (task?.request.source === "local_ui") {
        this.emitLocalCommandSummary({
          commandId: `local-task-${taskId}`,
          status,
          summary
        });
      }
    }
    const meta = this.remoteGitSyncTaskByTaskId.get(taskId);
    if (!meta || !this.options.onRemoteTaskMilestone) {
      if (terminal) {
        this.remoteGitSyncTaskByTaskId.delete(taskId);
      }
      return;
    }
    // Only push terminal updates to remote endpoints (e.g. mobile),
    // so execution steps stay in local chat without spamming per-step status.
    if (!terminal) {
      return;
    }
    this.options.onRemoteTaskMilestone({
      commandId: meta.commandId,
      machineId: meta.machineId,
      status,
      summary
    });
    if (terminal) {
      this.remoteGitSyncTaskByTaskId.delete(taskId);
    }
  }

  private emitLocalCommandSummary(payload: {
    commandId?: string;
    machineId?: string;
    status: ResultStatus;
    summary: string;
  }): void {
    if (!this.options.onLocalCommandSummary) {
      return;
    }
    const normalizedSummary = payload.summary?.trim();
    if (!normalizedSummary) {
      return;
    }
    this.options.onLocalCommandSummary({
      commandId: payload.commandId ?? `local-${randomUUID()}`,
      machineId: payload.machineId ?? resolveChatMachineId(),
      status: payload.status,
      summary: normalizedSummary
    });
  }

  private async handleRetryTask(threadId: string, taskId: string): Promise<void> {
    const previous = this.taskInputById.get(taskId);
    if (!previous) {
      this.postMessage({
        type: "action_result",
        action: "retry_task",
        ok: false,
        message: t("chat.error.retryTaskNotFound", { taskId })
      });
      return;
    }
    const assistant = this.stateStore.appendMessage(threadId, {
      role: "assistant",
      text: ""
    });
    this.postMessage({
      type: "append_message",
      threadId,
      message: toMessageDTO(assistant)
    });
    try {
      await this.executeTaskRequest({
        ...previous,
        threadId,
        messageId: assistant.id,
        signal: undefined
      });
      this.postMessage({
        type: "action_result",
        action: "retry_task",
        ok: true,
        message: t("chat.info.retriedTask", { taskId })
      });
    } catch (error) {
      this.postMessage({
        type: "action_result",
        action: "retry_task",
        ok: false,
        message: t("chat.error.retryTaskFailed", { message: extractErrorMessage(error) })
      });
    }
  }

  private async handleCancelTask(threadId: string, taskId: string): Promise<void> {
    const current = this.taskEngine.getTask(taskId);
    if (!current) {
      this.postMessage({
        type: "action_result",
        action: "cancel_task",
        ok: false,
        message: t("chat.error.unknownTask", { taskId })
      });
      return;
    }
    const controller = this.taskAbortById.get(taskId);
    if (controller) {
      controller.abort();
      this.emitRemoteTaskMilestone(taskId, "cancelled", t("chat.gitSync.cancelRequestedMilestone"), true);
    } else if (current.state === "WAITING_APPROVAL") {
      this.safeTransitionTask(taskId, "REJECTED", t("chat.state.cancelledWhileWaitingApproval"));
      this.safeFinishTask(taskId, "rejected");
      this.emitRemoteTaskMilestone(
        taskId,
        "rejected",
        t("chat.gitSync.cancelledWhileWaitingApprovalMilestone"),
        true
      );
    } else if (isTerminalTaskState(current.state)) {
      this.postMessage({
        type: "action_result",
        action: "cancel_task",
        ok: false,
        message: t("chat.error.taskAlreadyFinished", { taskId })
      });
      return;
    }
    this.gitSyncTaskLock.delete(taskId);
    this.postMessage({
      type: "action_result",
      action: "cancel_task",
      ok: true,
      message: t("chat.info.cancelRequestedTask", { taskId })
    });
    this.postMessage({
      type: "toast",
      level: "info",
      message: t("chat.info.cancelRequestedToast", { taskIdShort: taskId.slice(0, 8) })
    });
  }

  private sendThreadState(threadId: string): void {
    const state = this.stateStore.getStateDTO(threadId || DEFAULT_THREAD_ID);
    this.postMessage({
      type: "state",
      threadId: state.threadId,
      state
    });
    for (const event of this.stateStore.getTaskEvents(state.threadId)) {
      this.postMessage(event);
    }
  }

  private updateAssistantMessage(
    threadId: string,
    messageId: string,
    patch: Partial<ChatMessageDTO>
  ): void {
    const updated = this.stateStore.updateMessage(threadId, messageId, patch);
    if (!updated) {
      return;
    }
    this.postMessage({
      type: "update_message",
      threadId,
      messageId,
      patch: {
        text: updated.text,
        attachments: updated.attachments
      }
    });
  }

  private buildAttachmentsForTaskResult(
    result: TaskResult,
    context: { threadId: string; messageId: string; source: UserRequest["source"] }
  ): Attachment[] | undefined {
    const attachments: Attachment[] = [];
    if (result.proposal.type === "diff") {
      const record = this.diffStore.put(result.proposal.unifiedDiff, `Task diff ${result.taskId}`);
      result.proposal.diffId = record.diffId;
      this.diffTaskByDiffId.set(record.diffId, result.taskId);
      const diffAttachment = this.diffStore.toAttachment(record.diffId);
      if (diffAttachment) {
        attachments.push(diffAttachment);
      }
      return attachments.length > 0 ? attachments : undefined;
    }
    if (result.proposal.type === "command") {
      const commandText = sanitizeRunCommand(result.proposal.cmd) || result.proposal.cmd;
      const commandCwd = result.proposal.cwd?.trim()
        || resolveWorkspaceRoot()
        || process.env.WORKSPACE_ROOT
        || process.cwd();
      attachments.push({
        type: "command",
        title: t("chat.task.attachment.commandProposalTitle"),
        cmd: commandText,
        cwd: commandCwd,
        reason: result.proposal.reason,
        requiresApproval: true
      });
      this.commandTaskByKey.set(
        buildCommandTaskKey(commandText, commandCwd),
        {
          taskId: result.taskId,
          flow: "single"
        }
      );
      return attachments;
    }
    if (result.proposal.type === "git_sync_plan") {
      const workspaceRoot = result.proposal.actions.find((action) => Boolean(action.cwd))?.cwd
        ?? resolveWorkspaceRoot()
        ?? process.env.WORKSPACE_ROOT
        ?? process.cwd();
      const session = createGitSyncSession(
        result.taskId,
        result.proposal,
        workspaceRoot,
        context.threadId,
        context.messageId,
        context.source
      );
      this.gitSyncSessionByTaskId.set(result.taskId, session);
      attachments.push(this.toGitSyncCardAttachment(session));
      return attachments.length > 0 ? attachments : undefined;
    }
    if (result.proposal.type === "search_results") {
      attachments.push({
        type: "status",
        title: t("chat.task.attachment.searchResultsTitle"),
        json: result.proposal.items
      });
      return attachments;
    }
    return undefined;
  }

  private buildAttachmentsForResult(result: ResultEnvelope): Attachment[] | undefined {
    const attachments: Attachment[] = [];
    if (result.diff) {
      const record = this.diffStore.put(result.diff, `Remote diff ${result.commandId}`);
      const diffAttachment = this.diffStore.toAttachment(record.diffId);
      if (diffAttachment) {
        attachments.push(diffAttachment);
      }
    }
    if (result.status === "error" || result.status === "rejected" || result.status === "cancelled") {
      attachments.push({
        type: "error",
        code: `remote_${result.status}`,
        message: result.summary
      });
    }
    return attachments.length > 0 ? attachments : undefined;
  }

  private emitTaskEvent(event: TaskEventMessage): void {
    this.stateStore.appendTaskEvent(event.threadId, event);
    this.postMessage(event);
  }

  private transitionTaskToExecuting(taskId: string, message: string): void {
    const current = this.taskEngine.getTask(taskId);
    if (!current || current.state !== "WAITING_APPROVAL") {
      return;
    }
    this.safeTransitionTask(taskId, "EXECUTING", message);
  }

  private finalizeTaskExecutionFromAction(
    taskId: string,
    ok: boolean,
    rejected: boolean,
    message: string
  ): void {
    const current = this.taskEngine.getTask(taskId);
    if (!current || isTerminalTaskState(current.state)) {
      return;
    }
    if (rejected) {
      if (current.state !== "REJECTED") {
        this.safeTransitionTask(taskId, "REJECTED", message);
      }
      this.safeFinishTask(taskId, "rejected");
      this.clearCommandTaskBindings(taskId);
      this.emitRemoteTaskMilestone(taskId, "rejected", message, true);
      return;
    }
    if (ok) {
      const latest = this.taskEngine.getTask(taskId);
      if (latest && latest.state !== "COMPLETED") {
        if (latest.state === "WAITING_APPROVAL") {
          this.safeTransitionTask(taskId, "EXECUTING", t("chat.state.executionStarted"));
        }
        this.safeTransitionTask(taskId, "COMPLETED", message);
      }
      this.safeFinishTask(taskId, "ok");
      this.clearCommandTaskBindings(taskId);
      this.emitRemoteTaskMilestone(taskId, "ok", message, true);
      return;
    }
    this.safeTransitionTask(taskId, "FAILED", message);
    this.safeFinishTask(taskId, "error");
    this.clearCommandTaskBindings(taskId);
    this.emitRemoteTaskMilestone(taskId, "error", message, true);
  }

  private clearCommandTaskBindings(taskId: string): void {
    for (const [key, binding] of this.commandTaskByKey.entries()) {
      if (binding.taskId === taskId) {
        this.commandTaskByKey.delete(key);
      }
    }
  }

  private safeTransitionTask(taskId: string, state: TaskState, message?: string): void {
    try {
      const current = this.taskEngine.getTask(taskId);
      if (!current || isTerminalTaskState(current.state)) {
        return;
      }
      this.taskEngine.updateState(taskId, state, message);
    } catch (error) {
      this.logTask(`taskId=${taskId} transition_failed target=${state} error=${extractErrorMessage(error)}`);
    }
  }

  private safeFinishTask(taskId: string, status: "ok" | "error" | "rejected"): void {
    try {
      this.taskEngine.finish(taskId, status);
    } catch (error) {
      this.logTask(`taskId=${taskId} finish_failed status=${status} error=${extractErrorMessage(error)}`);
    }
  }

  private postMessage(message: ExtToUI): void {
    this.webviewView?.webview.postMessage(message);
  }

  private log(message: string): void {
    this.output.appendLine(`[chat] ${message}`);
  }

  private logTask(message: string): void {
    this.output.appendLine(`[task] ${message}`);
  }

  private isChatViewEnabled(): boolean {
    return vscode.workspace.getConfiguration("codexbridge").get<boolean>("ui.enableChatView", true);
  }

  private resolveMaxMessages(): number {
    return vscode.workspace.getConfiguration("codexbridge").get<number>("ui.maxMessages", 200);
  }

  private isNaturalLanguageTaskEnabled(): boolean {
    return vscode.workspace.getConfiguration("codexbridge").get<boolean>("nl.enable", true);
  }

  private shouldUseModelRouter(): boolean {
    const configEnabled = vscode.workspace.getConfiguration("codexbridge").get<boolean>("nl.useModelRouter", true);
    if (!configEnabled && !this.didWarnModelRouterDisabledIgnored) {
      this.didWarnModelRouterDisabledIgnored = true;
      this.logTask("event=model_router_policy_enforced reason=nl.useModelRouter=false_ignored");
    }
    return true;
  }

  private shouldUseStrictModelRouter(): boolean {
    const configEnabled = vscode.workspace.getConfiguration("codexbridge").get<boolean>("nl.modelRouterStrict", true);
    if (!configEnabled && !this.didWarnModelRouterStrictDisabledIgnored) {
      this.didWarnModelRouterStrictDisabledIgnored = true;
      this.logTask("event=model_router_strict_policy_enforced reason=nl.modelRouterStrict=false_ignored");
    }
    return true;
  }

  private isDevelopmentMode(): boolean {
    if (this.extensionContext.extensionMode === vscode.ExtensionMode.Development) {
      return true;
    }
    const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
    return nodeEnv === "development" || nodeEnv === "dev" || nodeEnv === "test";
  }

  private shouldAttachModelRouterRawOutputOnStrictFailure(): boolean {
    const configEnabled = vscode.workspace.getConfiguration("codexbridge").get<boolean>(
      "nl.modelRouterStrictAttachRawOutput",
      false
    );
    const envEnabled = parseBooleanEnv(process.env.CODEXBRIDGE_NL_MODEL_ROUTER_STRICT_ATTACH_RAW_OUTPUT);
    const requested = configEnabled || envEnabled;
    if (!requested) {
      this.didWarnStrictRawOutputOutsideDev = false;
      return false;
    }
    if (this.isDevelopmentMode()) {
      this.didWarnStrictRawOutputOutsideDev = false;
      return true;
    }
    if (!this.didWarnStrictRawOutputOutsideDev) {
      this.didWarnStrictRawOutputOutsideDev = true;
      this.logTask("event=strict_raw_output_disabled reason=development_mode_required");
    }
    return false;
  }

  private resolveNlConfidenceThreshold(): number {
    return vscode.workspace.getConfiguration("codexbridge").get<number>("nl.confidenceThreshold", 0.55);
  }

  private resolveGitTaskConfig(): GitTaskConfig {
    const config = vscode.workspace.getConfiguration("codexbridge");
    return {
      enable: config.get<boolean>("git.enable", true),
      autoRunReadOnly: config.get<boolean>("git.autoRunReadOnly", true),
      defaultRemote: config.get<string>("git.defaultRemote", "origin") || "origin",
      requireApprovalForCommit: config.get<boolean>("git.requireApprovalForCommit", true),
      requireApprovalForPush: config.get<boolean>("git.requireApprovalForPush", true)
    };
  }

  private buildTaskFailureAttachments(error: unknown, code: string): Attachment[] {
    const attachments: Attachment[] = [toErrorAttachment(code, error)];
    const debug = this.buildModelRouterDebugAttachment(error);
    if (debug) {
      attachments.push(debug);
    }
    return attachments;
  }

  private buildModelRouterDebugAttachment(error: unknown): Attachment | undefined {
    if (!this.shouldAttachModelRouterRawOutputOnStrictFailure()) {
      return undefined;
    }
    const details = extractErrorDetails(error);
    if (!details || typeof details !== "object") {
      return undefined;
    }
    const value = details as {
      source?: unknown;
      reason?: unknown;
      rawModelOutput?: unknown;
      confidence?: unknown;
      confidenceThreshold?: unknown;
      causeMessage?: unknown;
    };
    if (value.source !== "model_router_strict") {
      return undefined;
    }

    const lines: string[] = ["source=model_router_strict"];
    if (typeof value.reason === "string" && value.reason.trim()) {
      lines.push(`reason=${value.reason.trim()}`);
    }
    if (typeof value.confidence === "number" && Number.isFinite(value.confidence)) {
      lines.push(`confidence=${value.confidence}`);
    }
    if (typeof value.confidenceThreshold === "number" && Number.isFinite(value.confidenceThreshold)) {
      lines.push(`confidenceThreshold=${value.confidenceThreshold}`);
    }
    if (typeof value.causeMessage === "string" && value.causeMessage.trim()) {
      lines.push(`cause=${toSingleLine(value.causeMessage, 400)}`);
    }
    lines.push("");
    lines.push("raw_model_output:");
    if (typeof value.rawModelOutput === "string" && value.rawModelOutput.trim()) {
      lines.push(value.rawModelOutput);
    } else {
      lines.push("(empty)");
    }

    return {
      type: "logs",
      title: t("chat.debug.modelRouterTitle"),
      text: lines.join("\n")
    };
  }

  private async resolveTaskIntent(
    text: string,
    signal?: AbortSignal,
    source?: UserRequest["source"]
  ): Promise<{ intent: TaskIntent; routeSource: "deterministic" | "model" | "model_fallback" }> {
    const confidenceThreshold = this.resolveNlConfidenceThreshold();
    if (!this.shouldUseModelRouter()) {
      return {
        intent: routeTaskIntent(text, { confidenceThreshold }),
        routeSource: "deterministic"
      };
    }

    let routed: Awaited<ReturnType<typeof routeTaskIntentWithModel>>;
    try {
      routed = await routeTaskIntentWithModel(
        text,
        {
          confidenceThreshold,
          strict: this.shouldUseStrictModelRouter(),
          attachRawOutputOnStrictFailure: this.shouldAttachModelRouterRawOutputOnStrictFailure(),
          signal
        },
        { codex: this.codex }
      );
    } catch (error) {
      if (source === "local_ui" && error instanceof ModelRouterStrictError) {
        this.logTask(
          `event=model_router_strict_local_fallback reason=${toSingleLine(error.reason, 160)}`
        );
        return {
          intent: routeTaskIntent(text, { confidenceThreshold }),
          routeSource: "model_fallback"
        };
      }
      throw error;
    }
    if (routed.source === "model") {
      return {
        intent: routed.intent,
        routeSource: "model"
      };
    }
    this.logTask(`event=router_fallback reason=${toSingleLine(routed.reason ?? "unknown", 160)}`);
    return {
      intent: routed.intent,
      routeSource: "model_fallback"
    };
  }

  private syncCodexRuntimeFlagsFromConfig(): void {
    const config = vscode.workspace.getConfiguration("codexbridge");
    const fallbackFromConfig = config.get<boolean>("chat.enableExecFallback", false);
    const bypassFromConfig = config.get<boolean>("chat.execBypassApprovalsAndSandbox", false);
    const fallbackFromEnv = parseBooleanEnv(process.env.CODEX_CHAT_ENABLE_EXEC_FALLBACK);
    const bypassFromEnv = parseBooleanEnv(process.env.CODEX_CHAT_EXEC_BYPASS_APPROVALS_AND_SANDBOX);
    process.env.CODEX_CHAT_ENABLE_EXEC_FALLBACK = (fallbackFromConfig || fallbackFromEnv) ? "1" : "0";
    process.env.CODEX_CHAT_EXEC_BYPASS_APPROVALS_AND_SANDBOX = (bypassFromConfig || bypassFromEnv) ? "1" : "0";
  }
}

function renderTaskResultText(result: TaskResult): string {
  if (result.proposal.type === "answer") {
    return result.proposal.text;
  }
  if (result.proposal.type === "plan") {
    return result.proposal.text;
  }
  if (result.proposal.type === "diff") {
    const lines = [
      result.summary,
      ...result.proposal.files.map((file) => `- ${file.path} (+${file.additions} -${file.deletions})`)
    ];
    return lines.join("\n");
  }
  if (result.proposal.type === "command") {
    return [
      result.summary,
      t("chat.task.render.commandLine", { command: result.proposal.cmd }),
      result.proposal.cwd ? t("chat.task.render.cwdLine", { cwd: result.proposal.cwd }) : "",
      result.details ?? ""
    ].filter(Boolean).join("\n");
  }
  if (result.proposal.type === "git_sync_plan") {
    const diffFirstLine = firstNonEmptyLine(result.proposal.diffStat) ?? t("chat.gitSync.placeholderNoDiffStat");
    const branch = result.proposal.branch ?? t("chat.gitSync.placeholderDetached");
    const upstream = result.proposal.upstream ?? t("chat.gitSync.placeholderNone");
    const lines = [
      t("chat.gitSync.proposalReadyTitle"),
      t("chat.gitSync.summaryBranchUpstream", { branch, upstream }),
      t("chat.gitSync.summaryAheadBehind", { ahead: result.proposal.ahead, behind: result.proposal.behind }),
      t("chat.gitSync.summaryChanges", {
        staged: result.proposal.staged,
        unstaged: result.proposal.unstaged,
        untracked: result.proposal.untracked
      }),
      t("chat.gitSync.summaryDiffStat", { diffStat: toSingleLine(diffFirstLine, 200) }),
      result.proposal.commitMessage ? t("chat.gitSync.summaryCommit", { message: result.proposal.commitMessage }) : "",
      t("chat.gitSync.summaryPlannedSteps"),
      ...result.proposal.actions.map((action) => `- ${action.cmd}`),
      ...(result.proposal.notes ?? []).map((note) => t("chat.gitSync.summaryNote", { note }))
    ];
    return lines.filter(Boolean).join("\n");
  }
  if (result.proposal.type === "search_results") {
    const lines = [
      result.summary,
      ...result.proposal.items.map((item) => `${item.path}${item.preview ? ` - ${item.preview}` : ""}`)
    ];
    return lines.join("\n");
  }
  return result.details || result.summary;
}

function formatTaskResultForRemote(
  commandId: string,
  result: TaskResult,
  machineId: string
): string {
  const lines: string[] = [
    t("chat.remoteResult.taskIdLine", { taskId: commandId }),
    t("chat.remoteResult.intentLine", { intent: localizeRemoteIntentKind(result.intent.kind) }),
    t("chat.remoteResult.summaryLine", { summary: toSingleLine(result.summary, 220) })
  ];
  const finalSummary = summarizeTaskResultForRemote(result);
  if (finalSummary) {
    lines.push(t("chat.remoteResult.finalSummaryLine", { summary: toSingleLine(finalSummary, 220) }));
  }
  if (result.proposal.type === "diff") {
    const additions = result.proposal.files.reduce((acc, item) => acc + item.additions, 0);
    const deletions = result.proposal.files.reduce((acc, item) => acc + item.deletions, 0);
    lines.push(
      t("chat.remoteResult.diffLine", {
        count: result.proposal.files.length,
        additions,
        deletions
      })
    );
  }
  if (result.proposal.type === "command") {
    lines.push(
      t("chat.remoteResult.commandLine", { command: toSingleLine(result.proposal.cmd, 160) })
    );
  }
  if (result.proposal.type === "git_sync_plan") {
    const diffFirstLine = firstNonEmptyLine(result.proposal.diffStat) ?? t("chat.gitSync.placeholderNoDiffStat");
    const stepIds = result.proposal.actions.map((action) => action.id).join(",");
    const branch = result.proposal.branch ?? t("chat.gitSync.placeholderDetached");
    const upstream = result.proposal.upstream ?? t("chat.gitSync.placeholderNone");
    lines.push(t("chat.remoteResult.statusProposalReadyLine"));
    lines.push(t("chat.remoteResult.branchLine", { branch }));
    lines.push(t("chat.remoteResult.upstreamLine", { upstream }));
    lines.push(t("chat.remoteResult.changesLine", { changes: toSingleLine(diffFirstLine, 180) }));
    lines.push(t("chat.remoteResult.stepsLine", { steps: stepIds || t("chat.remoteResult.none") }));
    lines.push(t("chat.remoteResult.nextWaitingApprovalLine", { machineId }));
  }
  if (result.requires.mode === "local_approval" && result.proposal.type !== "git_sync_plan") {
    lines.push(t("chat.remoteResult.nextWaitingApprovalLine", { machineId }));
  }
  const cappedLines = lines.map((line) => toSingleLine(line, 220)).slice(0, 10);
  const joined = cappedLines.join("\n").trim();
  if (joined.length <= 600) {
    return joined;
  }
  return `${joined.slice(0, 597)}...`;
}

function summarizeTaskResultForRemote(result: TaskResult): string {
  if (result.proposal.type === "diff") {
    const additions = result.proposal.files.reduce((acc, item) => acc + item.additions, 0);
    const deletions = result.proposal.files.reduce((acc, item) => acc + item.deletions, 0);
    return `${result.summary} (${result.proposal.files.length} files, +${additions} -${deletions})`;
  }
  if (result.proposal.type === "command") {
    return `${result.summary} ${result.proposal.cmd}`.trim();
  }
  if (result.proposal.type === "git_sync_plan") {
    const stepIds = result.proposal.actions.map((action) => action.id).join(",");
    return `${result.summary} steps=${stepIds || "none"}`.trim();
  }
  if (result.proposal.type === "search_results") {
    return `${result.summary} count=${result.proposal.items.length}`.trim();
  }
  if (result.details?.trim()) {
    return result.details.trim();
  }
  return result.summary.trim();
}

function localizeRemoteIntentKind(kind: TaskIntent["kind"]): string {
  switch (kind) {
    case "help":
      return t("chat.remoteResult.intentKind.help");
    case "status":
      return t("chat.remoteResult.intentKind.status");
    case "explain":
      return t("chat.remoteResult.intentKind.explain");
    case "change":
      return t("chat.remoteResult.intentKind.change");
    case "run":
      return t("chat.remoteResult.intentKind.run");
    case "git_sync":
      return t("chat.remoteResult.intentKind.gitSync");
    case "diagnose":
      return t("chat.remoteResult.intentKind.diagnose");
    case "search":
      return t("chat.remoteResult.intentKind.search");
    case "review":
      return t("chat.remoteResult.intentKind.review");
    default:
      return kind;
  }
}

function parseSlashCommand(
  text: string
): { name: "plan" | "patch" | "test" | "help" | "status"; arg: string } | undefined {
  if (!text.startsWith("/")) {
    return undefined;
  }
  const [command, ...rest] = text.split(/\s+/);
  const name = command.slice(1).trim().toLowerCase();
  const arg = rest.join(" ").trim();
  if (name === "plan" || name === "patch" || name === "test" || name === "help" || name === "status") {
    return { name, arg };
  }
  return undefined;
}

function normalizeLocalTaskPrompt(input: string): string {
  const prompt = input.trim();
  if (!prompt) {
    return prompt;
  }
  const slash = parseSlashCommand(prompt);
  if (slash) {
    if (slash.name === "plan") {
      return slash.arg
        ? `Create a concise plan for:\n${slash.arg}`
        : "Create a concise implementation plan.";
    }
    return `@dev ${slash.name}${slash.arg ? ` ${slash.arg}` : ""}`.trim();
  }
  const parsed = parseDevCommand(prompt);
  if (!parsed) {
    return prompt;
  }
  return buildTaskPromptFromLegacyCommand(parsed, prompt);
}

function buildTaskPromptFromLegacyCommand(parsed: ParsedDevCommand, fallback: string): string {
  switch (parsed.kind) {
    case "help":
    case "status":
      return `@dev ${parsed.kind}`;
    case "test":
      return parsed.prompt?.trim() ? `@dev test ${parsed.prompt.trim()}` : "@dev test";
    case "patch":
      return parsed.prompt?.trim() ? `@dev patch ${parsed.prompt.trim()}` : fallback;
    case "plan":
      return parsed.prompt?.trim()
        ? `Create a concise plan for:\n${parsed.prompt.trim()}`
        : "Create a concise implementation plan.";
    case "apply":
      return parsed.refId?.trim() ? `@dev apply ${parsed.refId.trim()}` : fallback;
    default:
      return parsed.prompt?.trim() || fallback;
  }
}

function resolveWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function formatRemoteCommand(command: CommandEnvelope): string {
  if (command.kind === "task") {
    return command.prompt?.trim() || "@dev";
  }
  const payload = command.kind === "apply"
    ? command.refId ?? ""
    : command.prompt ?? "";
  return `@dev ${command.kind}${payload ? ` ${payload}` : ""}`.trim();
}

function asRemoteTaskCommand(command: CommandEnvelope): CommandEnvelope {
  if (command.kind === "task") {
    return command;
  }
  const prompt = buildRemoteTaskPrompt(command);
  return {
    ...command,
    kind: "task",
    prompt
  };
}

function buildRemoteTaskPrompt(command: CommandEnvelope): string | undefined {
  if (command.kind === "plan") {
    const content = command.prompt?.trim();
    return content ? `Create a concise plan for:\n${content}` : "Create a concise implementation plan.";
  }
  const normalized = stripDevPrefix(formatRemoteCommand(command));
  if (normalized) {
    return normalized;
  }
  const fallback = command.prompt?.trim();
  return fallback || undefined;
}

function stripDevPrefix(text: string): string {
  return text.replace(/^@dev\b(?:\s*[:\uFF1A]\s*|\s+)?/i, "").trim();
}

function formatInjectedRemoteCommand(command: CommandEnvelope): string {
  if (command.kind === "task") {
    return command.prompt?.trim() || "@dev";
  }
  const payload = command.kind === "apply"
    ? command.refId ?? ""
    : command.prompt ?? "";
  if (command.kind === "patch" || command.kind === "test" || command.kind === "plan") {
    return `/${command.kind}${payload ? ` ${payload}` : ""}`.trim();
  }
  return payload ? `${command.kind} ${payload}` : command.kind;
}

function buildRemoteConversationPrompt(command: CommandEnvelope): string {
  if (command.kind === "plan") {
    const content = command.prompt?.trim();
    return content ? `Create a concise plan for:\n${content}` : "Create a concise implementation plan.";
  }
  if (command.kind === "status") {
    return command.prompt?.trim() || "Summarize current workspace and execution status.";
  }
  if (command.kind === "help") {
    return command.prompt?.trim() || "List available capabilities and recommended usage.";
  }
  return command.prompt?.trim() || command.kind;
}

function isAgentNativeCommandKind(kind: CommandEnvelope["kind"]): boolean {
  return AGENT_NATIVE_COMMAND_KINDS.has(kind);
}

function parseNativeAgentCommand(input: string): ParsedDevCommand | undefined {
  const raw = input.trim();
  if (!raw) {
    return undefined;
  }
  const parsed = parseDevCommand(raw);
  if (!parsed || !isAgentNativeCommandKind(parsed.kind)) {
    return undefined;
  }
  return parsed;
}

function buildLocalChatCommand(parsed: ParsedDevCommand): CommandEnvelope {
  return {
    commandId: `chat-${randomUUID()}`,
    machineId: resolveChatMachineId(),
    userId: "chat-user",
    kind: parsed.kind,
    prompt: parsed.prompt,
    refId: parsed.refId,
    createdAt: new Date().toISOString()
  };
}

function resolveChatMachineId(): string {
  const fromEnv = process.env.MACHINE_ID?.trim() || process.env.CODEXBRIDGE_MACHINE_ID?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const fromConfig = vscode.workspace.getConfiguration("codexbridge").get<string>("machineId", "");
  if (fromConfig?.trim()) {
    return fromConfig.trim();
  }
  return process.env.COMPUTERNAME?.trim() || LOCAL_CHAT_MACHINE_ID;
}

function looksLikeUnifiedDiff(diff: string): boolean {
  return diff.includes("diff --git")
    || (diff.includes("\n--- ") && diff.includes("\n+++ "))
    || (diff.startsWith("--- ") && diff.includes("\n+++ "));
}

function normalizeApplySummary(message: string, ok: boolean): string {
  const trimmed = message.trim();
  if (ok && trimmed.startsWith("applied:")) {
    return `apply completed:${trimmed.slice("applied:".length)}`;
  }
  return trimmed;
}

function resolveResultStatus(ok: boolean, rejected?: boolean): ResultStatus {
  if (rejected) {
    return "rejected";
  }
  return ok ? "ok" : "error";
}

function chunkText(text: string, size = 80): string[] {
  if (!text) {
    return [""];
  }
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

function toSingleLine(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function firstNonEmptyLine(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const normalized = line.trim();
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function clipMultiline(text: string, maxLength: number): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function sanitizeGitSyncCommitMessage(value: string): string {
  const normalized = value
    .replace(/\r?\n/g, " ")
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= 80) {
    return normalized;
  }
  return normalized.slice(0, 80).trim();
}

function createGitSyncSession(
  taskId: string,
  proposal: GitSyncProposal,
  workspaceRoot: string,
  threadId: string,
  messageId: string,
  source: UserRequest["source"]
): GitSyncSession {
  const clonedProposal: GitSyncProposal = {
    ...proposal,
    commitMessage: sanitizeGitSyncCommitMessage(proposal.commitMessage ?? "") || undefined,
    actions: proposal.actions.map((action) => ({
      ...action
    })),
    notes: proposal.notes ? [...proposal.notes] : []
  };
  const stepState: Record<GitSyncStepId, GitSyncStepState> = {
    add: "skipped",
    commit: "skipped",
    push: "skipped"
  };
  for (const action of clonedProposal.actions) {
    stepState[action.id] = "pending";
  }
  const primaryAction = clonedProposal.actions.length === 1 && clonedProposal.actions[0]?.id === "push"
    ? "push"
    : "run_all";
  return {
    taskId,
    threadId,
    messageId,
    source,
    workspaceRoot,
    proposal: clonedProposal,
    primaryAction,
    stepState,
    stepLogs: {}
  };
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1);
}

function extractPushRemote(command: string): string | undefined {
  const parsed = parsePushCommand(command);
  return parsed?.remote;
}

function extractPushBranch(command: string): string | undefined {
  const parsed = parsePushCommand(command);
  return parsed?.branch;
}

function parsePushCommand(command: string): { remote: string; branch: string } | undefined {
  const normalized = command.trim();
  const match = normalized.match(
    /^git\s+push(?:\s+-(?:u|--set-upstream))?\s+([A-Za-z0-9._/-]+)\s+([A-Za-z0-9._/-]+)$/i
  );
  if (!match) {
    return undefined;
  }
  return {
    remote: match[1],
    branch: match[2]
  };
}

function buildCommandTaskKey(cmd: string, cwd?: string): string {
  const normalizedCmd = cmd.trim().replace(/\s+/g, " ");
  const normalizedCwd = (cwd ?? "").trim();
  return `${normalizedCwd}::${normalizedCmd}`;
}

function cloneContextRequest(input: UIContextRequest): UIContextRequest {
  return {
    includeActiveFile: input.includeActiveFile,
    includeSelection: input.includeSelection,
    includeWorkspaceSummary: input.includeWorkspaceSummary,
    files: input.files ? [...input.files] : undefined
  };
}

function mergeAbortSignals(
  externalSignal: AbortSignal | undefined,
  localAbort: AbortController
): AbortSignal {
  if (externalSignal) {
    if (externalSignal.aborted) {
      localAbort.abort();
    } else {
      externalSignal.addEventListener("abort", () => localAbort.abort(), { once: true });
    }
  }
  if (!externalSignal) {
    return localAbort.signal;
  }
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([externalSignal, localAbort.signal]);
  }
  return localAbort.signal;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "AbortError" || /aborted|cancelled/i.test(error.message);
  }
  return false;
}

function isTerminalTaskState(state: TaskState): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "REJECTED";
}

function toErrorAttachment(code: string, error: unknown): Attachment {
  const details = extractErrorDetails(error);
  return {
    type: "error",
    code,
    message: extractErrorMessage(error),
    details
  };
}

function extractErrorMessage(error: unknown): string {
  const base = error instanceof Error ? error.message : String(error);
  const details = extractErrorDetails(error);
  if (!details || typeof details !== "object") {
    return base;
  }
  const hint = (details as { hint?: unknown }).hint;
  if (typeof hint !== "string" || !hint.trim()) {
    return base;
  }
  const normalizedHint = hint.trim();
  if (base.includes(normalizedHint)) {
    return base;
  }
  return `${base} ${t("errors.hintPrefix", { hint: normalizedHint })}`;
}

function extractErrorDetails(error: unknown): unknown {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const value = error as { details?: unknown };
  return value.details;
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

function parseBooleanEnv(raw: string | undefined): boolean {
  const normalized = raw?.trim().toLowerCase();
  return normalized === "1"
    || normalized === "true"
    || normalized === "yes"
    || normalized === "on";
}

function resolveWebviewLocale(): "zh-CN" | "en" {
  const fromEnv = process.env.CODEXBRIDGE_UI_LOCALE?.trim();
  if (fromEnv) {
    return normalizeWebviewLocale(fromEnv);
  }
  return normalizeWebviewLocale(vscode.env.language);
}

function normalizeWebviewLocale(raw: string | undefined): "zh-CN" | "en" {
  return raw?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
