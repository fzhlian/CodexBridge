import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AuditIndexStore,
  CommandEvent,
  CommandRecord,
  CommandRecordFilter
} from "./store-types.js";

export class AuditStore {
  private readonly auditPath?: string;
  private readonly maxRecords: number;
  private readonly indexStore: AuditIndexStore;

  constructor(indexStore: AuditIndexStore, auditPath?: string, maxRecords = 2000) {
    this.indexStore = indexStore;
    this.auditPath = auditPath;
    this.maxRecords = maxRecords;
  }

  async record(event: CommandEvent): Promise<void> {
    await this.indexStore.applyEvent(event, this.maxRecords);
    await this.appendEvent(event);
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
        await this.indexStore.applyEvent(event, this.maxRecords);
      } catch {
        continue;
      }
    }
  }

  async get(commandId: string): Promise<CommandRecord | undefined> {
    return this.indexStore.get(commandId);
  }

  async listRecent(
    limit = 50,
    filter?: CommandRecordFilter
  ): Promise<CommandRecord[]> {
    return this.indexStore.listRecent(limit, filter);
  }

  async count(): Promise<number> {
    return this.indexStore.count();
  }

  async statusCounts(): Promise<Record<string, number>> {
    return this.indexStore.statusCounts();
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
