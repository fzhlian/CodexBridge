import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as vscode from "vscode";
import { parseDevCommand, type CommandEnvelope, type ParsedDevCommand, type ResultEnvelope, type ResultStatus } from "@codexbridge/shared";
import { generatePatchFromCodex } from "../codex-patch.js";
import { CodexClientFacade } from "../codex/codexClientFacade.js";
import type { RuntimeContextSnapshot } from "../context.js";
import { handleCommand } from "../handlers.js";
import { VirtualDiffDocumentProvider } from "../diff/virtualDocs.js";
import {
  applyDiffWithConfirmation,
  DiffStore,
  runTestWithConfirmation,
  viewDiff
} from "./chatActions.js";
import { collectChatContext } from "./contextCollector.js";
import type { ChatMessageDTO, ExtToUI, UIContextRequest } from "./chatProtocol.js";
import { parseUIToExtMessage, toMessageDTO, type Attachment, type UIToExt } from "./chatProtocol.js";
import { ChatStateStore } from "./chatState.js";

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

  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {
    this.stateStore = new ChatStateStore(extensionContext);
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
    return this.isChatViewEnabled() && Boolean(this.webviewView);
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
    webview.html = rawHtml
      .replaceAll("{{STYLE_URI}}", String(stylesUri))
      .replaceAll("{{SCRIPT_URI}}", String(scriptUri))
      .replaceAll("{{NONCE}}", nonce)
      .replaceAll("{{CSP_SOURCE}}", webview.cspSource);
  }

  private async handleRawMessage(raw: unknown): Promise<void> {
    const message = parseUIToExtMessage(raw);
    if (!message) {
      this.postMessage({
        type: "toast",
        level: "warn",
        message: "Ignored invalid chat message from webview."
      });
      return;
    }
    if (!this.isChatViewEnabled()) {
      this.postMessage({
        type: "toast",
        level: "warn",
        message: "Chat view is disabled by settings."
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
            message: `UI protocol version mismatch: ${message.version}`
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
      case "run_test":
        await this.handleRunTest(message.threadId, message.cmd);
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
        message: "Cannot send an empty message."
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

    await this.resolveAssistantStream(
      threadId,
      assistant.id,
      slash?.name === "plan" ? `Create a concise plan for:\n${slash.arg}` : prompt,
      contextRequest
    );
  }

  private async resolveAssistantStream(
    threadId: string,
    messageId: string,
    prompt: string,
    contextRequest: UIContextRequest
  ): Promise<void> {
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
        text: "Failed to get response from Codex.",
        attachments: [toErrorAttachment("codex_complete_failed", error)]
      });
      this.postMessage({
        type: "toast",
        level: "error",
        message: `Codex request failed: ${errorMessage}`
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
        text: "Agent command failed.",
        attachments: [toErrorAttachment("agent_native_command_failed", error)]
      });
      this.postMessage({
        type: "toast",
        level: "error",
        message: `Agent command failed: ${errorMessage}`
      });
    }
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
      const result = this.createRemoteResult(command, "error", `agent native command failed: ${message}`);
      this.updateAssistantMessage(threadId, messageId, {
        text: "Agent command failed.",
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
        text: "Failed to get response from Codex.",
        attachments: [toErrorAttachment("codex_complete_failed", error)]
      });
      return this.createRemoteResult(command, "error", summary);
    }
  }

  private async executeRemotePatchCommand(
    command: CommandEnvelope,
    threadId: string,
    messageId: string,
    context: RemoteUiExecutionContext
  ): Promise<ResultEnvelope> {
    if (!command.prompt?.trim()) {
      const summary = "patch missing prompt";
      this.updateAssistantMessage(threadId, messageId, {
        text: "Missing patch prompt.",
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
        const summary = "codex returned invalid patch format";
        this.postMessage({ type: "stream_end", threadId, messageId });
        this.updateAssistantMessage(threadId, messageId, {
          text: "Patch generation failed.",
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
        const summary = `patch too large; max ${maxDiffBytes} bytes`;
        this.postMessage({ type: "stream_end", threadId, messageId });
        this.updateAssistantMessage(threadId, messageId, {
          text: "Patch rejected due to size limit.",
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
        const summary = "patch generation cancelled";
        this.updateAssistantMessage(threadId, messageId, {
          text: summary
        });
        return this.createRemoteResult(command, "cancelled", summary);
      }
      const detail = error instanceof Error ? error.message : "unknown codex error";
      const summary = `codex patch generation failed: ${detail}`;
      this.updateAssistantMessage(threadId, messageId, {
        text: "Patch generation failed.",
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
      const summary = "apply missing refId";
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
      const summary = `no cached patch found for refId=${command.refId}`;
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
    const result = await applyDiffWithConfirmation(this.diffStore, diffId, workspaceRoot);
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
    const result = await runTestWithConfirmation(workspaceRoot, command.prompt?.trim() || undefined);
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
        text: "Missing patch prompt. Use /patch <prompt>.",
        attachments: [{
          type: "error",
          code: "patch_missing_prompt",
          message: "Slash command /patch requires a prompt."
        }]
      });
      return;
    }
    const context = await collectChatContext(contextRequest);
    const workspaceRoot = context.runtime?.workspaceRoot ?? resolveWorkspaceRoot();
    if (!workspaceRoot) {
      this.updateAssistantMessage(threadId, messageId, {
        text: "No workspace is open.",
        attachments: [{
          type: "error",
          code: "workspace_missing",
          message: "Patch generation requires an open workspace folder."
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
        text: "Patch generation failed.",
        attachments: [toErrorAttachment("patch_generation_failed", error)]
      });
      this.postMessage({
        type: "toast",
        level: "error",
        message: `Patch generation failed: ${error instanceof Error ? error.message : String(error)}`
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
    const result = await applyDiffWithConfirmation(this.diffStore, diffId, workspaceRoot);
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

  private sendThreadState(threadId: string): void {
    const state = this.stateStore.getStateDTO(threadId || DEFAULT_THREAD_ID);
    this.postMessage({
      type: "state",
      threadId: state.threadId,
      state
    });
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

  private postMessage(message: ExtToUI): void {
    this.webviewView?.webview.postMessage(message);
  }

  private log(message: string): void {
    this.output.appendLine(`[chat] ${message}`);
  }

  private isChatViewEnabled(): boolean {
    return vscode.workspace.getConfiguration("codexbridge").get<boolean>("ui.enableChatView", true);
  }

  private resolveMaxMessages(): number {
    return vscode.workspace.getConfiguration("codexbridge").get<number>("ui.maxMessages", 200);
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

function resolveWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function formatRemoteCommand(command: CommandEnvelope): string {
  const payload = command.kind === "apply"
    ? command.refId ?? ""
    : command.prompt ?? "";
  return `@dev ${command.kind}${payload ? ` ${payload}` : ""}`.trim();
}

function formatInjectedRemoteCommand(command: CommandEnvelope): string {
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
  return `${base} Hint: ${normalizedHint}`;
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
