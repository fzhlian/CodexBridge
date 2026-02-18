import { randomUUID } from "node:crypto";
import type * as vscode from "vscode";
import type { ChatMessage, ChatMessageDTO, ThreadStateDTO, UIContextRequest } from "./chatProtocol.js";
import { toMessageDTO } from "./chatProtocol.js";

type ThreadState = {
  threadId: string;
  messages: ChatMessage[];
  context: UIContextRequest;
  lastUpdatedAt: string;
};

type PersistedState = {
  threads: ThreadState[];
};

const STATE_KEY = "codexbridge.chat.state.v1";
const DEFAULT_THREAD_ID = "default";

export class ChatStateStore {
  private readonly threads = new Map<string, ThreadState>();
  private maxMessages = 200;

  constructor(private readonly extensionContext: vscode.ExtensionContext) {}

  async load(maxMessages: number): Promise<void> {
    this.maxMessages = sanitizeMaxMessages(maxMessages);
    const saved = this.extensionContext.workspaceState.get<PersistedState>(STATE_KEY);
    if (!saved?.threads?.length) {
      this.ensureThread(DEFAULT_THREAD_ID);
      return;
    }
    for (const thread of saved.threads) {
      const threadId = thread.threadId || DEFAULT_THREAD_ID;
      this.threads.set(threadId, {
        threadId,
        messages: (thread.messages ?? []).slice(-this.maxMessages),
        context: thread.context ?? {},
        lastUpdatedAt: thread.lastUpdatedAt ?? new Date().toISOString()
      });
    }
    this.ensureThread(DEFAULT_THREAD_ID);
  }

  getStateDTO(threadId = DEFAULT_THREAD_ID): ThreadStateDTO {
    const thread = this.ensureThread(threadId);
    return {
      threadId: thread.threadId,
      messages: thread.messages.map((item) => toMessageDTO(item)),
      context: thread.context
    };
  }

  appendMessage(
    threadId: string,
    payload: Omit<ChatMessage, "id" | "threadId" | "createdAt"> & { id?: string; createdAt?: string }
  ): ChatMessage {
    const thread = this.ensureThread(threadId);
    const message: ChatMessage = {
      id: payload.id ?? randomUUID(),
      threadId: thread.threadId,
      role: payload.role,
      createdAt: payload.createdAt ?? new Date().toISOString(),
      author: payload.author,
      text: payload.text,
      attachments: payload.attachments,
      meta: payload.meta
    };
    thread.messages.push(message);
    this.trimThread(thread);
    thread.lastUpdatedAt = new Date().toISOString();
    void this.persist();
    return message;
  }

  updateMessage(
    threadId: string,
    messageId: string,
    patch: Partial<ChatMessageDTO>
  ): ChatMessage | undefined {
    const thread = this.ensureThread(threadId);
    const target = thread.messages.find((item) => item.id === messageId);
    if (!target) {
      return undefined;
    }
    if (patch.text !== undefined) {
      target.text = patch.text;
    }
    if (patch.attachments !== undefined) {
      target.attachments = patch.attachments;
    }
    if (patch.author !== undefined) {
      target.author = patch.author;
    }
    thread.lastUpdatedAt = new Date().toISOString();
    void this.persist();
    return target;
  }

  clearThread(threadId: string): void {
    const thread = this.ensureThread(threadId);
    thread.messages = [];
    thread.lastUpdatedAt = new Date().toISOString();
    void this.persist();
  }

  setContext(threadId: string, context: UIContextRequest): void {
    const thread = this.ensureThread(threadId);
    thread.context = context;
    thread.lastUpdatedAt = new Date().toISOString();
    void this.persist();
  }

  setMaxMessages(value: number): void {
    this.maxMessages = sanitizeMaxMessages(value);
    for (const thread of this.threads.values()) {
      this.trimThread(thread);
    }
    void this.persist();
  }

  private ensureThread(threadId: string): ThreadState {
    const normalized = threadId.trim() || DEFAULT_THREAD_ID;
    let thread = this.threads.get(normalized);
    if (!thread) {
      thread = {
        threadId: normalized,
        messages: [],
        context: {},
        lastUpdatedAt: new Date().toISOString()
      };
      this.threads.set(normalized, thread);
    }
    return thread;
  }

  private trimThread(thread: ThreadState): void {
    if (thread.messages.length > this.maxMessages) {
      thread.messages.splice(0, thread.messages.length - this.maxMessages);
    }
  }

  private async persist(): Promise<void> {
    await this.extensionContext.workspaceState.update(STATE_KEY, {
      threads: [...this.threads.values()]
    } satisfies PersistedState);
  }
}

function sanitizeMaxMessages(value: number): number {
  if (!Number.isFinite(value)) {
    return 200;
  }
  const floored = Math.floor(value);
  if (floored < 20) {
    return 20;
  }
  if (floored > 1000) {
    return 1000;
  }
  return floored;
}
