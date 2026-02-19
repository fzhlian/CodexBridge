import type { DiffFileSummary } from "../diff/unifiedDiff.js";

export type UserRequest = {
  source: "wecom" | "local_ui";
  threadId: string;
  fromUser?: string;
  text: string;
  meta?: Record<string, unknown>;
};

export type TaskKind =
  | "help"
  | "status"
  | "explain"
  | "change"
  | "run"
  | "diagnose"
  | "search"
  | "review";

export type TaskIntent = {
  kind: TaskKind;
  confidence: number;
  summary: string;
  params?: {
    files?: string[];
    cmd?: string;
    question?: string;
    changeRequest?: string;
    query?: string;
  };
};

export type Proposal =
  | { type: "plan"; text: string }
  | { type: "diff"; diffId?: string; unifiedDiff: string; files: DiffFileSummary[] }
  | { type: "command"; cmd: string; cwd?: string; reason?: string }
  | { type: "answer"; text: string }
  | { type: "search_results"; items: { path: string; preview?: string }[] };

export type ExecutionRequirement =
  | { mode: "none" }
  | { mode: "local_approval"; action: "apply_diff" | "run_command" };

export type TaskResult = {
  taskId: string;
  intent: TaskIntent;
  proposal: Proposal;
  requires: ExecutionRequirement;
  summary: string;
  details?: string;
};

export type TaskState =
  | "RECEIVED"
  | "ROUTED"
  | "CONTEXT_COLLECTED"
  | "PROPOSING"
  | "PROPOSAL_READY"
  | "WAITING_APPROVAL"
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED"
  | "REJECTED";

export type TaskEndStatus = "ok" | "error" | "rejected";

const TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  RECEIVED: ["ROUTED", "FAILED"],
  ROUTED: ["CONTEXT_COLLECTED", "FAILED"],
  CONTEXT_COLLECTED: ["PROPOSING", "FAILED"],
  PROPOSING: ["PROPOSAL_READY", "FAILED"],
  PROPOSAL_READY: ["WAITING_APPROVAL", "EXECUTING", "COMPLETED", "FAILED"],
  WAITING_APPROVAL: ["EXECUTING", "REJECTED", "FAILED", "COMPLETED"],
  EXECUTING: ["COMPLETED", "FAILED", "REJECTED"],
  COMPLETED: [],
  FAILED: [],
  REJECTED: []
};

export function canTransitionTaskState(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to);
}

