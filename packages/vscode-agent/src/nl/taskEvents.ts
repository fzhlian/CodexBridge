import type { TaskEndStatus, TaskIntent, TaskResult, TaskState } from "./taskTypes.js";

export type TaskStartEvent = {
  type: "task_start";
  threadId: string;
  taskId: string;
  intent: TaskIntent;
};

export type TaskStateEvent = {
  type: "task_state";
  threadId: string;
  taskId: string;
  state: TaskState;
  message?: string;
};

export type TaskStreamChunkEvent = {
  type: "task_stream_chunk";
  threadId: string;
  taskId: string;
  messageId: string;
  chunk: string;
};

export type TaskProposalEvent = {
  type: "task_proposal";
  threadId: string;
  taskId: string;
  result: TaskResult;
};

export type TaskEndEvent = {
  type: "task_end";
  threadId: string;
  taskId: string;
  status: TaskEndStatus;
};

export type TaskEvent =
  | TaskStartEvent
  | TaskStateEvent
  | TaskStreamChunkEvent
  | TaskProposalEvent
  | TaskEndEvent;

export function isTaskEvent(value: unknown): value is TaskEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return type === "task_start"
    || type === "task_state"
    || type === "task_stream_chunk"
    || type === "task_proposal"
    || type === "task_end";
}
