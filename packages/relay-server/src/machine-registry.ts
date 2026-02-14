import type WebSocket from "ws";
import { randomUUID } from "node:crypto";
import type { MachineStateRecord, MachineStateStore } from "./store-types.js";

type ActiveSession = {
  machineId: string;
  socket: WebSocket;
  sessionId: string;
};

export type MachineSessionSnapshot = {
  machineId: string;
  connectedAt: number;
  lastHeartbeatAt: number;
  runningCount: number;
  pendingCount: number;
  sessionId: string;
};

export class MachineRegistry {
  private readonly sessions = new Map<string, ActiveSession>();

  constructor(
    private readonly store: MachineStateStore,
    private readonly ttlMs: number
  ) {}

  async register(machineId: string, socket: WebSocket): Promise<string> {
    const sessionId = randomUUID();
    const now = Date.now();
    const record: MachineStateRecord = {
      machineId,
      connectedAt: now,
      lastHeartbeatAt: now,
      runningCount: 0,
      pendingCount: 0,
      sessionId
    };
    this.sessions.set(machineId, {
      machineId,
      socket,
      sessionId
    });
    await this.store.register(record, this.ttlMs);
    return sessionId;
  }

  async markHeartbeat(
    machineId: string,
    metrics?: {
      runningCount?: number;
      pendingCount?: number;
    }
  ): Promise<void> {
    await this.store.markHeartbeat(machineId, Date.now(), this.ttlMs, metrics);
  }

  async remove(machineId: string, sessionId?: string): Promise<void> {
    const active = this.sessions.get(machineId);
    if (active && (!sessionId || active.sessionId === sessionId)) {
      this.sessions.delete(machineId);
    }
    const current = await this.store.get(machineId);
    if (!current) {
      return;
    }
    if (!sessionId || current.sessionId === sessionId) {
      await this.store.remove(machineId);
    }
  }

  async getState(machineId: string): Promise<MachineSessionSnapshot | undefined> {
    const found = await this.store.get(machineId);
    return found ? toSnapshot(found) : undefined;
  }

  getSocket(machineId: string): WebSocket | undefined {
    return this.sessions.get(machineId)?.socket;
  }

  async list(): Promise<MachineSessionSnapshot[]> {
    const records = await this.store.list();
    return records.map((item) => toSnapshot(item));
  }
}

function toSnapshot(input: MachineStateRecord): MachineSessionSnapshot {
  return {
    machineId: input.machineId,
    connectedAt: input.connectedAt,
    lastHeartbeatAt: input.lastHeartbeatAt,
    runningCount: input.runningCount,
    pendingCount: input.pendingCount,
    sessionId: input.sessionId
  };
}
