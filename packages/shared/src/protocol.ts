export type CommandKind = "help" | "status" | "plan" | "patch" | "apply" | "test";

export type CommandEnvelope = {
  commandId: string;
  machineId: string;
  userId: string;
  kind: CommandKind;
  prompt?: string;
  refId?: string;
  createdAt: string;
};

export type ResultStatus = "ok" | "error" | "rejected" | "cancelled";

export type ResultEnvelope = {
  commandId: string;
  machineId: string;
  status: ResultStatus;
  summary: string;
  diff?: string;
  createdAt: string;
};

export type AgentHello = {
  type: "agent.hello";
  machineId: string;
  version: string;
  capabilities: string[];
};

export type AgentHeartbeat = {
  type: "agent.heartbeat";
  machineId: string;
  sentAt: string;
  runningCount?: number;
  pendingCount?: number;
};

export type AgentResult = {
  type: "agent.result";
  result: ResultEnvelope;
};

export type RelayEnvelope = AgentHello | AgentHeartbeat | AgentResult;

export type RelayTraceDirection =
  | "wecom->relay"
  | "relay->agent"
  | "agent->relay"
  | "relay->wecom";

export type RelayTraceEvent = {
  at: string;
  stage: string;
  direction: RelayTraceDirection;
  commandId?: string;
  machineId?: string;
  userId?: string;
  kind?: CommandKind;
  status?: string;
  detail?: string;
};

export type RelayToAgentCommand = {
  type: "command";
  command: CommandEnvelope;
};

export type RelayToAgentCancel = {
  type: "command.cancel";
  commandId: string;
  requestedAt: string;
};

export type RelayToAgentTrace = {
  type: "relay.trace";
  trace: RelayTraceEvent;
};

export type RelayToAgentEnvelope = RelayToAgentCommand | RelayToAgentCancel | RelayToAgentTrace;
