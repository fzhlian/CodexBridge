import { MemoryIdempotencyStore } from "@codexbridge/shared";
import type {
  AuditIndexStore,
  CommandEvent,
  CommandRecord,
  CommandRecordFilter,
  InflightCommandRecord,
  InflightCommandStore,
  MachineStateRecord,
  MachineStateStore
} from "./store-types.js";

export class MemoryMachineStateStore implements MachineStateStore {
  private readonly records = new Map<string, MachineStateRecord>();

  async register(record: MachineStateRecord, _ttlMs: number): Promise<void> {
    void _ttlMs;
    this.records.set(record.machineId, { ...record });
  }

  async markHeartbeat(
    machineId: string,
    timestampMs: number,
    _ttlMs: number,
    metrics?: { runningCount?: number; pendingCount?: number }
  ): Promise<void> {
    const current = this.records.get(machineId);
    if (!current) {
      return;
    }
    current.lastHeartbeatAt = timestampMs;
    if (typeof metrics?.runningCount === "number") {
      current.runningCount = metrics.runningCount;
    }
    if (typeof metrics?.pendingCount === "number") {
      current.pendingCount = metrics.pendingCount;
    }
  }

  async remove(machineId: string): Promise<void> {
    this.records.delete(machineId);
  }

  async get(machineId: string): Promise<MachineStateRecord | undefined> {
    const found = this.records.get(machineId);
    return found ? { ...found } : undefined;
  }

  async list(): Promise<MachineStateRecord[]> {
    return [...this.records.values()].map((item) => ({ ...item }));
  }
}

export class MemoryInflightCommandStore implements InflightCommandStore {
  private readonly records = new Map<string, InflightCommandRecord>();

  async set(record: InflightCommandRecord, _ttlMs: number): Promise<void> {
    void _ttlMs;
    this.records.set(record.commandId, { ...record });
  }

  async get(commandId: string): Promise<InflightCommandRecord | undefined> {
    const found = this.records.get(commandId);
    return found ? { ...found } : undefined;
  }

  async remove(commandId: string): Promise<void> {
    this.records.delete(commandId);
  }

  async list(): Promise<InflightCommandRecord[]> {
    return [...this.records.values()].map((item) => ({ ...item }));
  }
}

export class MemoryAuditIndexStore implements AuditIndexStore {
  private readonly records = new Map<string, CommandRecord>();

  async applyEvent(event: CommandEvent, maxRecords: number): Promise<void> {
    const current = this.records.get(event.commandId);
    if (!current) {
      this.records.set(event.commandId, {
        commandId: event.commandId,
        userId: event.userId,
        machineId: event.machineId,
        kind: event.kind,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        status: event.status,
        summary: event.summary,
        events: [event]
      });
    } else {
      current.updatedAt = event.timestamp;
      current.status = event.status;
      if (event.summary) {
        current.summary = event.summary;
      }
      if (event.userId) {
        current.userId = event.userId;
      }
      if (event.machineId) {
        current.machineId = event.machineId;
      }
      if (event.kind) {
        current.kind = event.kind;
      }
      current.events.push(event);
    }

    if (this.records.size > maxRecords) {
      const overflow = this.records.size - maxRecords;
      const oldest = [...this.records.values()]
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .slice(0, overflow);
      for (const record of oldest) {
        this.records.delete(record.commandId);
      }
    }
  }

  async get(commandId: string): Promise<CommandRecord | undefined> {
    const record = this.records.get(commandId);
    if (!record) {
      return undefined;
    }
    return {
      ...record,
      events: [...record.events]
    };
  }

  async listRecent(limit: number, filter?: CommandRecordFilter): Promise<CommandRecord[]> {
    let values = [...this.records.values()];
    if (filter?.userId) {
      values = values.filter((item) => item.userId === filter.userId);
    }
    if (filter?.machineId) {
      values = values.filter((item) => item.machineId === filter.machineId);
    }
    if (filter?.status) {
      values = values.filter((item) => item.status === filter.status);
    }
    return values
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, limit))
      .map((record) => ({
        ...record,
        events: [...record.events]
      }));
  }

  async count(): Promise<number> {
    return this.records.size;
  }

  async statusCounts(): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const record of this.records.values()) {
      result[record.status] = (result[record.status] ?? 0) + 1;
    }
    return result;
  }
}

export function createMemoryIdempotencyStore() {
  return new MemoryIdempotencyStore();
}
