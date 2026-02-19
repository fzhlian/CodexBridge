import { randomUUID } from "node:crypto";
import {
  canTransitionTaskState,
  type TaskEndStatus,
  type TaskIntent,
  type TaskResult,
  type TaskState,
  type UserRequest
} from "./taskTypes.js";

type TaskRecord = {
  taskId: string;
  request: UserRequest;
  intent: TaskIntent;
  state: TaskState;
};

export type TaskEngineEmitter = {
  onTaskStart?: (event: { threadId: string; taskId: string; intent: TaskIntent }) => void;
  onTaskState?: (event: {
    threadId: string;
    taskId: string;
    state: TaskState;
    message?: string;
  }) => void;
  onTaskStreamChunk?: (event: {
    threadId: string;
    taskId: string;
    messageId: string;
    chunk: string;
  }) => void;
  onTaskProposal?: (event: { threadId: string; taskId: string; result: TaskResult }) => void;
  onTaskEnd?: (event: { threadId: string; taskId: string; status: TaskEndStatus }) => void;
};

export class TaskEngine {
  private readonly tasks = new Map<string, TaskRecord>();

  constructor(private readonly emitter: TaskEngineEmitter = {}) {}

  createTask(request: UserRequest, intent: TaskIntent): TaskRecord {
    const taskId = randomUUID();
    const task: TaskRecord = {
      taskId,
      request,
      intent,
      state: "RECEIVED"
    };
    this.tasks.set(taskId, task);
    this.emitter.onTaskStart?.({
      threadId: request.threadId,
      taskId,
      intent
    });
    this.emitter.onTaskState?.({
      threadId: request.threadId,
      taskId,
      state: "RECEIVED"
    });
    return task;
  }

  updateState(taskId: string, state: TaskState, message?: string): void {
    const task = this.requireTask(taskId);
    if (!canTransitionTaskState(task.state, state)) {
      throw new Error(`invalid task transition: ${task.state} -> ${state}`);
    }
    task.state = state;
    this.emitter.onTaskState?.({
      threadId: task.request.threadId,
      taskId,
      state,
      message
    });
  }

  emitStreamChunk(taskId: string, messageId: string, chunk: string): void {
    const task = this.requireTask(taskId);
    this.emitter.onTaskStreamChunk?.({
      threadId: task.request.threadId,
      taskId,
      messageId,
      chunk
    });
  }

  emitProposal(taskId: string, result: TaskResult): void {
    const task = this.requireTask(taskId);
    this.emitter.onTaskProposal?.({
      threadId: task.request.threadId,
      taskId,
      result
    });
  }

  finish(taskId: string, status: TaskEndStatus): void {
    const task = this.requireTask(taskId);
    this.emitter.onTaskEnd?.({
      threadId: task.request.threadId,
      taskId,
      status
    });
  }

  getTask(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  private requireTask(taskId: string): TaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`unknown taskId: ${taskId}`);
    }
    return task;
  }
}

