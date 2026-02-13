import type WebSocket from "ws";

type Session = {
  machineId: string;
  socket: WebSocket;
  connectedAt: number;
  lastHeartbeatAt: number;
  runningCount?: number;
  pendingCount?: number;
};

export type MachineSessionSnapshot = {
  machineId: string;
  connectedAt: number;
  lastHeartbeatAt: number;
  runningCount?: number;
  pendingCount?: number;
};

export class MachineRegistry {
  private readonly sessions = new Map<string, Session>();

  register(machineId: string, socket: WebSocket): void {
    this.sessions.set(machineId, {
      machineId,
      socket,
      connectedAt: Date.now(),
      lastHeartbeatAt: Date.now(),
      runningCount: 0,
      pendingCount: 0
    });
  }

  markHeartbeat(
    machineId: string,
    metrics?: {
      runningCount?: number;
      pendingCount?: number;
    }
  ): void {
    const session = this.sessions.get(machineId);
    if (!session) {
      return;
    }
    session.lastHeartbeatAt = Date.now();
    if (typeof metrics?.runningCount === "number") {
      session.runningCount = metrics.runningCount;
    }
    if (typeof metrics?.pendingCount === "number") {
      session.pendingCount = metrics.pendingCount;
    }
  }

  remove(machineId: string): void {
    this.sessions.delete(machineId);
  }

  get(machineId: string): Session | undefined {
    return this.sessions.get(machineId);
  }

  isOnline(machineId: string): boolean {
    return this.sessions.has(machineId);
  }

  list(): MachineSessionSnapshot[] {
    return [...this.sessions.values()].map((value) => ({
      machineId: value.machineId,
      connectedAt: value.connectedAt,
      lastHeartbeatAt: value.lastHeartbeatAt,
      runningCount: value.runningCount,
      pendingCount: value.pendingCount
    }));
  }
}
