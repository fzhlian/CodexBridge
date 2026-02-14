import type { IdempotencyStore } from "@codexbridge/shared";

export type StoreMode = "memory" | "redis";

export type MachineStateRecord = {
  machineId: string;
  connectedAt: number;
  lastHeartbeatAt: number;
  runningCount: number;
  pendingCount: number;
  sessionId: string;
};

export type InflightCommandRecord = {
  commandId: string;
  userId: string;
  machineId: string;
  kind: string;
  createdAtMs: number;
};

export type CommandEvent = {
  commandId: string;
  timestamp: string;
  status: string;
  userId?: string;
  machineId?: string;
  kind?: string;
  summary?: string;
  metadata?: Record<string, string>;
};

export type CommandRecord = {
  commandId: string;
  userId?: string;
  machineId?: string;
  kind?: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  summary?: string;
  events: CommandEvent[];
};

export type CommandRecordFilter = {
  userId?: string;
  machineId?: string;
  status?: string;
};

export interface MachineStateStore {
  register(record: MachineStateRecord, ttlMs: number): Promise<void>;
  markHeartbeat(
    machineId: string,
    timestampMs: number,
    ttlMs: number,
    metrics?: {
      runningCount?: number;
      pendingCount?: number;
    }
  ): Promise<void>;
  remove(machineId: string): Promise<void>;
  get(machineId: string): Promise<MachineStateRecord | undefined>;
  list(): Promise<MachineStateRecord[]>;
}

export interface InflightCommandStore {
  set(record: InflightCommandRecord, ttlMs: number): Promise<void>;
  get(commandId: string): Promise<InflightCommandRecord | undefined>;
  remove(commandId: string): Promise<void>;
  list(): Promise<InflightCommandRecord[]>;
}

export interface AuditIndexStore {
  applyEvent(event: CommandEvent, maxRecords: number): Promise<void>;
  get(commandId: string): Promise<CommandRecord | undefined>;
  listRecent(limit: number, filter?: CommandRecordFilter): Promise<CommandRecord[]>;
  count(): Promise<number>;
  statusCounts(): Promise<Record<string, number>>;
}

export type RelayStoreDiagnostics = {
  configuredMode: StoreMode;
  mode: StoreMode;
  degraded: boolean;
  redisErrorCount: number;
  lastRedisError?: string;
};

export type RelayStores = {
  idempotency: IdempotencyStore & { close?: () => Promise<void> };
  machineState: MachineStateStore;
  inflight: InflightCommandStore;
  auditIndex: AuditIndexStore;
  diagnostics: RelayStoreDiagnostics;
  close: () => Promise<void>;
};
