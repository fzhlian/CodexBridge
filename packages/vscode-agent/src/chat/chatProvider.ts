import { promises as fs } from "node:fs";
import * as vscode from "vscode";
import type { CommandEnvelope, ResultEnvelope } from "@codexbridge/shared";
import { generatePatchFromCodex } from "../codex-patch.js";
import { CodexClientFacade } from "../codex/codexClientFacade.js";
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

type PendingRemoteAssistant = {
  threadId: string;
  messageId: string;
};

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "codexbridge.chatView";

  private webviewView?: vscode.WebviewView;
  private readonly stateStore: ChatStateStore;
  private readonly codex = new CodexClientFacade();
  private readonly diffStore = new DiffStore(20);
  private readonly virtualDocs = new VirtualDiffDocumentProvider();
  private readonly pendingRemoteAssistants = new Map<string, PendingRemoteAssistant>();

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
        }
      );
      this.postMessage({ type: "stream_end", threadId, messageId });
      this.updateAssistantMessage(threadId, messageId, {
        text: finalText
      });
    } catch (error) {
      this.log(`codex complete failed: ${error instanceof Error ? error.message : String(error)}`);
      this.postMessage({ type: "stream_end", threadId, messageId });
      this.updateAssistantMessage(threadId, messageId, {
        text: "Failed to get response from Codex.",
        attachments: [toErrorAttachment("codex_complete_failed", error)]
      });
      this.postMessage({
        type: "toast",
        level: "error",
        message: `Codex request failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
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

function parseSlashCommand(text: string): { name: "plan" | "patch" | "test"; arg: string } | undefined {
  if (!text.startsWith("/")) {
    return undefined;
  }
  const [command, ...rest] = text.split(/\s+/);
  const name = command.slice(1).trim().toLowerCase();
  const arg = rest.join(" ").trim();
  if (name === "plan" || name === "patch" || name === "test") {
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
  return {
    type: "error",
    code,
    message: error instanceof Error ? error.message : String(error)
  };
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}
