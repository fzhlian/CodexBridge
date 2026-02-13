import { promises as fs } from "node:fs";
import path from "node:path";

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

export class AuditStore {
  private readonly records = new Map<string, CommandRecord>();
  private readonly auditPath?: string;

  constructor(auditPath?: string) {
    this.auditPath = auditPath;
  }

  async record(event: CommandEvent): Promise<void> {
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

    await this.appendEvent(event);
  }

  get(commandId: string): CommandRecord | undefined {
    const record = this.records.get(commandId);
    if (!record) {
      return undefined;
    }
    return {
      ...record,
      events: [...record.events]
    };
  }

  listRecent(limit = 50): CommandRecord[] {
    return [...this.records.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, limit))
      .map((record) => ({
        ...record,
        events: [...record.events]
      }));
  }

  private async appendEvent(event: CommandEvent): Promise<void> {
    if (!this.auditPath) {
      return;
    }
    const fullPath = path.resolve(this.auditPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.appendFile(fullPath, `${JSON.stringify(event)}\n`, "utf8");
  }
}

