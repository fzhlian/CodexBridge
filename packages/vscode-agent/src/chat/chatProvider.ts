import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as vscode from "vscode";
import { parseDevCommand, type CommandEnvelope, type ParsedDevCommand, type ResultEnvelope, type ResultStatus } from "@codexbridge/shared";
import { generatePatchFromCodex } from "../codex-patch.js";
import { CodexClientFacade } from "../codex/codexClientFacade.js";
import type { RuntimeContextSnapshot } from "../context.js";
import { handleCommand } from "../handlers.js";
import { VirtualDiffDocumentProvider } from "../diff/virtualDocs.js";
import { t } from "../i18n/messages.js";
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
import { runTask } from "../nl/taskRunner.js";
import type { TaskResult, TaskState, UserRequest } from "../nl/taskTypes.js";

const DEFAULT_THREAD_ID = "default";
const LOCAL_CHAT_MACHINE_ID = "chat-local";
const AGENT_NATIVE_COMMAND_KINDS = new Set<CommandEnvelope["kind"]>(["help", "status"]);

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

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "codexbridge.chatView";

  private webviewView?: vscode.WebviewView;
  private readonly stateStore: ChatStateStore;
  private readonly codex = new CodexClientFacade();
  private readonly diffStore = new DiffStore(20);
  private readonly virtualDocs = new VirtualDiffDocumentProvider();
  private readonly pendingRemoteAssistants = new Map<string, PendingRemoteAssistant>();
  private readonly chatHandledRemoteResultIds = new Set<string>();
  private readonly remotePatchDiffIds = new Map<string, string>();
  private readonly taskEngine: TaskEngine;
  private readonly taskStartAtMs = new Map<string, number>();
  private readonly taskInputById = new Map<string, TaskExecutionInput>();
  private readonly taskAbortById = new Map<string, AbortController>();
  private readonly diffTaskByDiffId = new Map<string, string>();
  private readonly commandTaskByKey = new Map<string, string>();

  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
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
      text: "",
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
    return this.isChatViewEnabled();
  }

  consumeChatHandledRemoteResult(commandId: string): boolean {
    return this.chatHandledRemoteResultIds.delete(commandId);
  }

  async executeRemoteCommandViaChat(
    command: CommandEnvelope,
    context: RemoteUiExecutionContext = {}
  ): Promise<ResultEnvelope | undefined> {
    if (!this.canExecuteRemoteCommandViaChat()) {
      return undefined;
    }

    const threadId = DEFAULT_THREAD_ID;
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
      text: "",
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

    let result: ResultEnvelope;
    switch (command.kind) {
      case "patch":
        result = await this.executeRemotePatchCommand(command, threadId, assistant.id, context);
        break;
      case "apply":
        result = await this.executeRemoteApplyCommand(command, threadId, assistant.id, context);
        break;
      case "test":
        result = await this.executeRemoteTestCommand(command, threadId, assistant.id, context);
        break;
      case "help":
      case "status":
        result = await this.executeRemoteAgentNativeCommand(command, threadId, assistant.id, context);
        break;
      case "plan":
        result = await this.executeRemoteConversationCommand(command, threadId, assistant.id, context);
        break;
      case "task":
        result = await this.executeRemoteTaskCommand(command, threadId, assistant.id, context);
        break;
      default:
        result = this.createRemoteResult(command, "error", "unknown command");
        this.updateAssistantMessage(threadId, assistant.id, {
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
    return result;
  }

  onRemoteResult(command: CommandEnvelope, result: ResultEnvelope): void {
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
          message: "Thread cleared."
        });
        break;
      case "copy_to_clipboard":
        await vscode.env.clipboard.writeText(message.text);
        this.postMessage({
          type: "action_result",
          action: "copy_to_clipboard",
          ok: true,
          message: "Copied to clipboard."
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

    const slash = parseSlashCommand(prompt);
    if (slash?.name === "test") {
      await this.resolveTestSlash(threadId, assistant.id, slash.arg);
      return;
    }
    if (slash?.name === "patch") {
      await this.resolvePatchSlash(threadId, assistant.id, slash.arg, contextRequest);
      return;
    }
    if (slash?.name === "help" || slash?.name === "status") {
      await this.resolveAgentNativeCommand(
        threadId,
        assistant.id,
        { kind: slash.name },
        contextRequest
      );
      return;
    }

    const parsed = parseNativeAgentCommand(prompt);
    if (parsed && isAgentNativeCommandKind(parsed.kind)) {
      await this.resolveAgentNativeCommand(threadId, assistant.id, parsed, contextRequest);
      return;
    }
    const legacyDsl = parseDevCommand(prompt);
    if (legacyDsl && legacyDsl.kind !== "task") {
      const handled = await this.resolveLegacyDslCommand(threadId, assistant.id, legacyDsl, contextRequest);
      if (handled) {
        return;
      }
    }
    if (slash?.name === "plan" || !this.isNaturalLanguageTaskEnabled()) {
      await this.resolveAssistantStream(
        threadId,
        assistant.id,
        slash?.name === "plan" ? `Create a concise plan for:\n${slash.arg}` : prompt,
        contextRequest
      );
      return;
    }
    await this.executeTaskRequest({
      threadId,
      messageId: assistant.id,
      text: prompt,
      contextRequest,
      source: "local_ui"
    });
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
    try {
      this.log(`route local-agent-native kind=${parsed.kind}`);
      const collected = await collectChatContext(contextRequest);
      const command = buildLocalChatCommand(parsed);
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
        text: `Apply requested for refId=${parsed.refId}`
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
      const summary = t("chat.error.taskExecutionFailedWithReason", {
        message: extractErrorMessage(error)
      });
      return this.createRemoteResult(command, "error", summary);
    }
  }

  private async executeTaskRequest(input: TaskExecutionInput): Promise<TaskResult> {
    this.syncCodexRuntimeFlagsFromConfig();
    const intent = routeTaskIntent(input.text, {
      confidenceThreshold: this.resolveNlConfidenceThreshold()
    });
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
      this.taskEngine.updateState(task.taskId, "ROUTED", `intent=${intent.kind}`);
      const collected = await collectTaskContext(intent, input.contextRequest);
      this.taskEngine.updateState(task.taskId, "CONTEXT_COLLECTED");
      this.taskEngine.updateState(task.taskId, "PROPOSING");
      this.postMessage({ type: "stream_start", threadId: input.threadId, messageId: input.messageId });
      streamStarted = true;
      const result = await runTask(
        {
          taskId: task.taskId,
          request,
          intent,
          renderedContext: collected.renderedContext,
          runtime: input.runtimeContext ?? collected.runtime,
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
      const attachments = this.buildAttachmentsForTaskResult(result);
      if (streamStarted) {
        this.postMessage({ type: "stream_end", threadId: input.threadId, messageId: input.messageId });
      }
      this.updateAssistantMessage(input.threadId, input.messageId, {
        text,
        attachments
      });
      if (result.requires.mode === "local_approval") {
        const message = result.requires.action === "apply_diff"
          ? "Diff proposal ready. Waiting for local approval to apply."
          : "Command proposal ready. Waiting for local approval to run.";
        this.taskEngine.updateState(task.taskId, "WAITING_APPROVAL", message);
        return result;
      } else {
        this.taskEngine.updateState(task.taskId, "COMPLETED");
        this.taskEngine.finish(task.taskId, "ok");
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
        attachments: [toErrorAttachment(aborted ? "task_execution_cancelled" : "task_execution_failed", error)]
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
      throw error;
    } finally {
      this.taskAbortById.delete(task.taskId);
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
        ? [{ type: "logs", title: "Test Output", text: result.logs }]
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
    }
  }

  private async resolveTestSlash(threadId: string, messageId: string, commandText: string): Promise<void> {
    const workspaceRoot = resolveWorkspaceRoot() ?? process.env.WORKSPACE_ROOT ?? process.cwd();
    const result = await runTestWithConfirmation(workspaceRoot, commandText || undefined);
    const attachments: Attachment[] = result.logs
      ? [{ type: "logs", title: "Test Output", text: result.logs }]
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
    if (taskId) {
      this.finalizeTaskExecutionFromAction(taskId, result.ok, result.rejected, result.message);
    }
    const message = this.stateStore.appendMessage(threadId, {
      role: "tool",
      text: result.message,
      attachments: result.ok
        ? undefined
        : [{
          type: "error",
          code: result.rejected ? "apply_rejected" : "apply_failed",
          message: result.message,
          details: result.details
        }]
    });
    this.postMessage({
      type: "append_message",
      threadId,
      message: toMessageDTO(message)
    });
    this.postMessage({
      type: "action_result",
      action: "apply_diff",
      ok: result.ok,
      message: result.message,
      details: result.details
    });
    this.postMessage({
      type: "toast",
      level: result.ok ? "info" : "warn",
      message: result.message
    });
  }

  private async handleRunTest(threadId: string, cmd?: string): Promise<void> {
    const workspaceRoot = resolveWorkspaceRoot() ?? process.env.WORKSPACE_ROOT ?? process.cwd();
    const result = await runTestWithConfirmation(workspaceRoot, cmd);
    const attachments: Attachment[] = result.logs
      ? [{ type: "logs", title: "Test Output", text: result.logs }]
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
  }

  private async handleRunCommand(threadId: string, cmd: string, cwd?: string): Promise<void> {
    const workspaceRoot = cwd?.trim()
      || resolveWorkspaceRoot()
      || process.env.WORKSPACE_ROOT
      || process.cwd();
    const taskId = this.commandTaskByKey.get(buildCommandTaskKey(cmd, workspaceRoot));
    const result = await runCommandWithConfirmation(workspaceRoot, cmd, {
      source: "local_ui",
      onApproved: () => {
        if (taskId) {
          this.transitionTaskToExecuting(taskId, t("chat.state.executingApprovedCommand"));
        }
      }
    });
    if (taskId) {
      this.finalizeTaskExecutionFromAction(taskId, result.ok, result.rejected, result.message);
    }
    const attachments: Attachment[] = result.logs
      ? [{ type: "logs", title: "Command Output", text: result.logs }]
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
        message: `retried task ${taskId}`
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
    } else if (current.state === "WAITING_APPROVAL") {
      this.safeTransitionTask(taskId, "REJECTED", t("chat.state.cancelledWhileWaitingApproval"));
      this.safeFinishTask(taskId, "rejected");
    } else if (isTerminalTaskState(current.state)) {
      this.postMessage({
        type: "action_result",
        action: "cancel_task",
        ok: false,
        message: t("chat.error.taskAlreadyFinished", { taskId })
      });
      return;
    }
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

  private buildAttachmentsForTaskResult(result: TaskResult): Attachment[] | undefined {
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
      attachments.push({
        type: "command",
        title: "Command Proposal",
        cmd: result.proposal.cmd,
        cwd: result.proposal.cwd,
        reason: result.proposal.reason,
        requiresApproval: true
      });
      this.commandTaskByKey.set(
        buildCommandTaskKey(result.proposal.cmd, result.proposal.cwd),
        result.taskId
      );
      return attachments;
    }
    if (result.proposal.type === "search_results") {
      attachments.push({
        type: "status",
        title: "Search Results",
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
      return;
    }
    this.safeTransitionTask(taskId, "FAILED", message);
    this.safeFinishTask(taskId, "error");
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

  private resolveNlConfidenceThreshold(): number {
    return vscode.workspace.getConfiguration("codexbridge").get<number>("nl.confidenceThreshold", 0.55);
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
      `cmd: ${result.proposal.cmd}`,
      result.proposal.cwd ? `cwd: ${result.proposal.cwd}` : "",
      result.details ?? ""
    ].filter(Boolean).join("\n");
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
    `taskId=${commandId}`,
    `intent=${result.intent.kind}`,
    `summary=${toSingleLine(result.summary, 220)}`
  ];
  if (result.proposal.type === "diff") {
    const additions = result.proposal.files.reduce((acc, item) => acc + item.additions, 0);
    const deletions = result.proposal.files.reduce((acc, item) => acc + item.deletions, 0);
    lines.push(`diff=${result.proposal.files.length} files (+${additions} -${deletions})`);
  }
  if (result.proposal.type === "command") {
    lines.push(`command=${toSingleLine(result.proposal.cmd, 160)}`);
  }
  if (result.requires.mode === "local_approval") {
    lines.push(`next=waiting for local approval on ${machineId}`);
  }
  const cappedLines = lines.map((line) => toSingleLine(line, 220)).slice(0, 8);
  const joined = cappedLines.join("\n").trim();
  if (joined.length <= 600) {
    return joined;
  }
  return `${joined.slice(0, 597)}...`;
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

function resolveWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function formatRemoteCommand(command: CommandEnvelope): string {
  if (command.kind === "task") {
    const prompt = command.prompt?.trim() || "";
    return `@dev ${prompt}`.trim();
  }
  const payload = command.kind === "apply"
    ? command.refId ?? ""
    : command.prompt ?? "";
  return `@dev ${command.kind}${payload ? ` ${payload}` : ""}`.trim();
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
  return LOCAL_CHAT_MACHINE_ID;
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
