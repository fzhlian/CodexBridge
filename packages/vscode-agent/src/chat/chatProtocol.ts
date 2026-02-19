import type { DiffFileSummary } from "../diff/unifiedDiff.js";
import type {
  TaskIntent,
  TaskResult,
  TaskState
} from "../nl/taskTypes.js";

export type Role = "user" | "assistant" | "system" | "remote" | "tool";

export type Attachment =
  | { type: "diff"; diffId: string; title?: string; unifiedDiff: string; files: DiffFileSummary[] }
  | { type: "command"; title?: string; cmd: string; cwd?: string; reason?: string; requiresApproval?: boolean }
  | { type: "logs"; title?: string; text: string }
  | { type: "status"; title?: string; json: unknown }
  | { type: "error"; title?: string; code: string; message: string; details?: unknown };

export type ChatMessage = {
  id: string;
  threadId: string;
  role: Role;
  createdAt: string;
  author?: string;
  text?: string;
  attachments?: Attachment[];
  meta?: Record<string, unknown>;
};

export type UIContextRequest = {
  includeActiveFile?: boolean;
  includeSelection?: boolean;
  includeWorkspaceSummary?: boolean;
  files?: string[];
};

export type UIToExt =
  | { type: "ui_ready"; version: 1 }
  | { type: "send_message"; threadId: string; text: string; context: UIContextRequest }
  | { type: "set_context"; threadId: string; context: UIContextRequest }
  | { type: "view_diff"; threadId: string; diffId: string }
  | { type: "apply_diff"; threadId: string; diffId: string }
  | { type: "run_command"; threadId: string; cmd: string; cwd?: string }
  | { type: "run_test"; threadId: string; cmd?: string }
  | { type: "retry_task"; threadId: string; taskId: string }
  | { type: "cancel_task"; threadId: string; taskId: string }
  | { type: "copy_to_clipboard"; text: string }
  | { type: "clear_thread"; threadId: string }
  | { type: "request_state"; threadId: string };

export type ChatMessageDTO = {
  id: string;
  role: Role;
  author?: string;
  createdAt: string;
  text?: string;
  attachments?: Attachment[];
};

export type ThreadStateDTO = {
  threadId: string;
  messages: ChatMessageDTO[];
  context: UIContextRequest;
};

export type ExtToUI =
  | { type: "state"; threadId: string; state: ThreadStateDTO }
  | { type: "append_message"; threadId: string; message: ChatMessageDTO }
  | { type: "update_message"; threadId: string; messageId: string; patch: Partial<ChatMessageDTO> }
  | { type: "stream_start"; threadId: string; messageId: string }
  | { type: "stream_chunk"; threadId: string; messageId: string; chunk: string }
  | { type: "stream_end"; threadId: string; messageId: string }
  | { type: "task_start"; threadId: string; taskId: string; intent: TaskIntent }
  | { type: "task_state"; threadId: string; taskId: string; state: TaskState; message?: string }
  | { type: "task_stream_chunk"; threadId: string; taskId: string; messageId: string; chunk: string }
  | { type: "task_proposal"; threadId: string; taskId: string; result: TaskResult }
  | { type: "task_end"; threadId: string; taskId: string; status: "ok" | "error" | "rejected" }
  | { type: "toast"; level: "info" | "warn" | "error"; message: string }
  | { type: "action_result"; action: string; ok: boolean; message?: string; details?: unknown };

export type TaskEventMessage = Extract<
  ExtToUI,
  { type: "task_start" | "task_state" | "task_stream_chunk" | "task_proposal" | "task_end" }
>;

export function parseUIToExtMessage(raw: unknown): UIToExt | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  const type = typeof value.type === "string" ? value.type : "";
  switch (type) {
    case "ui_ready":
      return value.version === 1 ? { type: "ui_ready", version: 1 } : undefined;
    case "send_message":
      return hasThreadId(value) && typeof value.text === "string"
        ? {
          type: "send_message",
          threadId: value.threadId,
          text: value.text,
          context: parseContext(value.context)
        }
        : undefined;
    case "set_context":
      return hasThreadId(value)
        ? {
          type: "set_context",
          threadId: value.threadId,
          context: parseContext(value.context)
        }
        : undefined;
    case "view_diff":
      return hasThreadId(value) && typeof value.diffId === "string"
        ? { type: "view_diff", threadId: value.threadId, diffId: value.diffId }
        : undefined;
    case "apply_diff":
      return hasThreadId(value) && typeof value.diffId === "string"
        ? { type: "apply_diff", threadId: value.threadId, diffId: value.diffId }
        : undefined;
    case "run_command":
      return hasThreadId(value) && typeof value.cmd === "string"
        ? {
          type: "run_command",
          threadId: value.threadId,
          cmd: value.cmd,
          cwd: typeof value.cwd === "string" ? value.cwd : undefined
        }
        : undefined;
    case "run_test":
      return hasThreadId(value) && (typeof value.cmd === "string" || value.cmd === undefined)
        ? { type: "run_test", threadId: value.threadId, cmd: value.cmd as string | undefined }
        : undefined;
    case "retry_task":
      return hasThreadId(value) && typeof value.taskId === "string"
        ? { type: "retry_task", threadId: value.threadId, taskId: value.taskId }
        : undefined;
    case "cancel_task":
      return hasThreadId(value) && typeof value.taskId === "string"
        ? { type: "cancel_task", threadId: value.threadId, taskId: value.taskId }
        : undefined;
    case "copy_to_clipboard":
      return typeof value.text === "string" ? { type: "copy_to_clipboard", text: value.text } : undefined;
    case "clear_thread":
      return hasThreadId(value) ? { type: "clear_thread", threadId: value.threadId } : undefined;
    case "request_state":
      return hasThreadId(value) ? { type: "request_state", threadId: value.threadId } : undefined;
    default:
      return undefined;
  }
}

export function toMessageDTO(message: ChatMessage): ChatMessageDTO {
  return {
    id: message.id,
    role: message.role,
    author: message.author,
    createdAt: message.createdAt,
    text: message.text,
    attachments: message.attachments
  };
}

function hasThreadId(value: Record<string, unknown>): value is Record<string, unknown> & { threadId: string } {
  return typeof value.threadId === "string" && value.threadId.trim().length > 0;
}

function parseContext(raw: unknown): UIContextRequest {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const value = raw as Record<string, unknown>;
  const files = Array.isArray(value.files)
    ? value.files.filter((item): item is string => typeof item === "string").slice(0, 10)
    : undefined;
  return {
    includeActiveFile: typeof value.includeActiveFile === "boolean" ? value.includeActiveFile : undefined,
    includeSelection: typeof value.includeSelection === "boolean" ? value.includeSelection : undefined,
    includeWorkspaceSummary:
      typeof value.includeWorkspaceSummary === "boolean" ? value.includeWorkspaceSummary : undefined,
    files
  };
}
