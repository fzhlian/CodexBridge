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
  private readonly maxRecords: number;

  constructor(auditPath?: string, maxRecords = 2000) {
    this.auditPath = auditPath;
    this.maxRecords = maxRecords;
  }

  async record(event: CommandEvent): Promise<void> {
    this.applyEvent(event);
    await this.appendEvent(event);
    this.pruneIfNeeded();
  }

  async hydrateFromDisk(): Promise<void> {
    if (!this.auditPath) {
      return;
    }
    const fullPath = path.resolve(this.auditPath);
    let content: string;
    try {
      content = await fs.readFile(fullPath, "utf8");
    } catch (error: unknown) {
      const maybe = error as { code?: string };
      if (maybe.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      try {
        const event = JSON.parse(line) as CommandEvent;
        if (!event.commandId || !event.timestamp || !event.status) {
          continue;
        }
        this.applyEvent(event);
      } catch {
        continue;
      }
    }
    this.pruneIfNeeded();
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

  listRecent(
    limit = 50,
    filter?: {
      userId?: string;
      machineId?: string;
      status?: string;
    }
  ): CommandRecord[] {
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

  count(): number {
    return this.records.size;
  }

  statusCounts(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const record of this.records.values()) {
      result[record.status] = (result[record.status] ?? 0) + 1;
    }
    return result;
  }

  private async appendEvent(event: CommandEvent): Promise<void> {
    if (!this.auditPath) {
      return;
    }
    const fullPath = path.resolve(this.auditPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.appendFile(fullPath, `${JSON.stringify(event)}\n`, "utf8");
  }

  private pruneIfNeeded(): void {
    if (this.records.size <= this.maxRecords) {
      return;
    }
    const overflow = this.records.size - this.maxRecords;
    const oldest = [...this.records.values()]
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, overflow);
    for (const record of oldest) {
      this.records.delete(record.commandId);
    }
  }

  private applyEvent(event: CommandEvent): void {
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
      return;
    }

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
}
