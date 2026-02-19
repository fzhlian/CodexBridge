import { createClient, type RedisClientType } from "redis";
import type { IdempotencyStore } from "@codexbridge/shared";
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

type FieldMap = Record<string, string>;

export class RedisIdempotencyStore implements IdempotencyStore {
  private readonly client: RedisClientType;
  private connectPromise?: Promise<RedisClientType>;

  constructor(
    redisUrl: string,
    private readonly keyPrefix = "codexbridge:dedupe:",
    connectTimeoutMs?: number
  ) {
    this.client = createClient({
      url: redisUrl,
      socket: parseConnectTimeout(connectTimeoutMs)
        ? { connectTimeout: parseConnectTimeout(connectTimeoutMs) }
        : undefined
    });
  }

  async seen(key: string): Promise<boolean> {
    await this.ensureConnected();
    const value = await this.client.get(this.fullKey(key));
    return value === "1";
  }

  async mark(key: string, ttlMs: number): Promise<void> {
    await this.ensureConnected();
    await this.client.set(this.fullKey(key), "1", { PX: Math.max(1, ttlMs) });
  }

  async markIfUnseen(key: string, ttlMs: number): Promise<boolean> {
    await this.ensureConnected();
    const result = await this.client.set(this.fullKey(key), "1", {
      PX: Math.max(1, ttlMs),
      NX: true
    });
    return result === "OK";
  }

  async close(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  async ping(): Promise<void> {
    await this.ensureConnected();
    await this.client.ping();
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isOpen) {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect();
    }
    await this.connectPromise;
  }

  private fullKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
}

export class RedisMachineStateStore implements MachineStateStore {
  private readonly client: RedisClientType;
  private connectPromise?: Promise<RedisClientType>;
  private readonly machineIndexKey: string;

  constructor(
    redisUrl: string,
    private readonly prefix = "codexbridge:",
    connectTimeoutMs?: number
  ) {
    this.client = createClient({
      url: redisUrl,
      socket: parseConnectTimeout(connectTimeoutMs)
        ? { connectTimeout: parseConnectTimeout(connectTimeoutMs) }
        : undefined
    });
    this.machineIndexKey = `${this.prefix}machine:index`;
  }

  async register(record: MachineStateRecord, ttlMs: number): Promise<void> {
    await this.ensureConnected();
    const key = this.machineKey(record.machineId);
    await this.client.multi()
      .hSet(key, toFieldMap(record))
      .sAdd(this.machineIndexKey, record.machineId)
      .pExpire(key, Math.max(1, ttlMs))
      .exec();
  }

  async markHeartbeat(
    machineId: string,
    timestampMs: number,
    ttlMs: number,
    metrics?: { runningCount?: number; pendingCount?: number }
  ): Promise<void> {
    await this.ensureConnected();
    const key = this.machineKey(machineId);
    const patch: FieldMap = {
      lastHeartbeatAt: String(timestampMs)
    };
    if (typeof metrics?.runningCount === "number") {
      patch.runningCount = String(metrics.runningCount);
    }
    if (typeof metrics?.pendingCount === "number") {
      patch.pendingCount = String(metrics.pendingCount);
    }
    await this.client.multi()
      .hSet(key, patch)
      .sAdd(this.machineIndexKey, machineId)
      .pExpire(key, Math.max(1, ttlMs))
      .exec();
  }

  async remove(machineId: string): Promise<void> {
    await this.ensureConnected();
    await this.client.multi()
      .del(this.machineKey(machineId))
      .sRem(this.machineIndexKey, machineId)
      .exec();
  }

  async get(machineId: string): Promise<MachineStateRecord | undefined> {
    await this.ensureConnected();
    const fields = await this.client.hGetAll(this.machineKey(machineId));
    return fromMachineFields(machineId, fields);
  }

  async list(): Promise<MachineStateRecord[]> {
    await this.ensureConnected();
    const ids = await this.client.sMembers(this.machineIndexKey);
    const values: MachineStateRecord[] = [];
    for (const machineId of ids) {
      const fields = await this.client.hGetAll(this.machineKey(machineId));
      const parsed = fromMachineFields(machineId, fields);
      if (!parsed) {
        await this.client.sRem(this.machineIndexKey, machineId);
        continue;
      }
      values.push(parsed);
    }
    return values;
  }

  async ping(): Promise<void> {
    await this.ensureConnected();
    await this.client.ping();
  }

  async close(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isOpen) {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect();
    }
    await this.connectPromise;
  }

  private machineKey(machineId: string): string {
    return `${this.prefix}machine:${machineId}`;
  }
}

export class RedisInflightCommandStore implements InflightCommandStore {
  private readonly client: RedisClientType;
  private connectPromise?: Promise<RedisClientType>;
  private readonly indexKey: string;

  constructor(
    redisUrl: string,
    private readonly prefix = "codexbridge:",
    connectTimeoutMs?: number
  ) {
    this.client = createClient({
      url: redisUrl,
      socket: parseConnectTimeout(connectTimeoutMs)
        ? { connectTimeout: parseConnectTimeout(connectTimeoutMs) }
        : undefined
    });
    this.indexKey = `${this.prefix}inflight:index`;
  }

  async set(record: InflightCommandRecord, ttlMs: number): Promise<void> {
    await this.ensureConnected();
    const key = this.inflightKey(record.commandId);
    await this.client.multi()
      .hSet(key, toFieldMap(record))
      .zAdd(this.indexKey, {
        score: record.createdAtMs,
        value: record.commandId
      })
      .pExpire(key, Math.max(1, ttlMs))
      .exec();
  }

  async get(commandId: string): Promise<InflightCommandRecord | undefined> {
    await this.ensureConnected();
    const fields = await this.client.hGetAll(this.inflightKey(commandId));
    return fromInflightFields(commandId, fields);
  }

  async remove(commandId: string): Promise<void> {
    await this.ensureConnected();
    await this.client.multi()
      .del(this.inflightKey(commandId))
      .zRem(this.indexKey, commandId)
      .exec();
  }

  async list(): Promise<InflightCommandRecord[]> {
    await this.ensureConnected();
    const ids = await this.client.zRange(this.indexKey, 0, -1);
    const values: InflightCommandRecord[] = [];
    for (const commandId of ids) {
      const fields = await this.client.hGetAll(this.inflightKey(commandId));
      const parsed = fromInflightFields(commandId, fields);
      if (!parsed) {
        await this.client.zRem(this.indexKey, commandId);
        continue;
      }
      values.push(parsed);
    }
    return values;
  }

  async ping(): Promise<void> {
    await this.ensureConnected();
    await this.client.ping();
  }

  async close(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isOpen) {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect();
    }
    await this.connectPromise;
  }

  private inflightKey(commandId: string): string {
    return `${this.prefix}inflight:${commandId}`;
  }
}

export class RedisAuditIndexStore implements AuditIndexStore {
  private readonly client: RedisClientType;
  private connectPromise?: Promise<RedisClientType>;
  private readonly updatedIndexKey: string;
  private readonly statusCountsKey: string;

  constructor(
    redisUrl: string,
    private readonly prefix = "codexbridge:",
    connectTimeoutMs?: number
  ) {
    this.client = createClient({
      url: redisUrl,
      socket: parseConnectTimeout(connectTimeoutMs)
        ? { connectTimeout: parseConnectTimeout(connectTimeoutMs) }
        : undefined
    });
    this.updatedIndexKey = `${this.prefix}audit:index:updated`;
    this.statusCountsKey = `${this.prefix}audit:status:counts`;
  }

  async applyEvent(event: CommandEvent, maxRecords: number): Promise<void> {
    await this.ensureConnected();
    const key = this.recordKey(event.commandId);
    const eventsKey = this.eventsKey(event.commandId);
    const prevStatus = await this.client.hGet(key, "status");
    const fields = await this.client.hGetAll(key);
    const createdAt = fields.createdAt ?? event.timestamp;

    const patch: FieldMap = {
      commandId: event.commandId,
      createdAt,
      updatedAt: event.timestamp,
      status: event.status
    };
    if (event.userId) {
      patch.userId = event.userId;
    } else if (fields.userId) {
      patch.userId = fields.userId;
    }
    if (event.machineId) {
      patch.machineId = event.machineId;
    } else if (fields.machineId) {
      patch.machineId = fields.machineId;
    }
    if (event.kind) {
      patch.kind = event.kind;
    } else if (fields.kind) {
      patch.kind = fields.kind;
    }
    if (event.summary) {
      patch.summary = event.summary;
    } else if (fields.summary) {
      patch.summary = fields.summary;
    }

    const timestampMs = Date.parse(event.timestamp);
    const score = Number.isFinite(timestampMs) ? timestampMs : Date.now();
    await this.client.multi()
      .hSet(key, patch)
      .rPush(eventsKey, JSON.stringify(event))
      .zAdd(this.updatedIndexKey, {
        score,
        value: event.commandId
      })
      .exec();

    if (prevStatus !== event.status) {
      if (prevStatus) {
        await this.client.hIncrBy(this.statusCountsKey, prevStatus, -1);
      }
      await this.client.hIncrBy(this.statusCountsKey, event.status, 1);
    }

    await this.pruneOverflow(maxRecords);
  }

  async get(commandId: string): Promise<CommandRecord | undefined> {
    await this.ensureConnected();
    const fields = await this.client.hGetAll(this.recordKey(commandId));
    if (!fields.commandId || !fields.createdAt || !fields.updatedAt || !fields.status) {
      return undefined;
    }
    const eventsRaw = await this.client.lRange(this.eventsKey(commandId), 0, -1);
    return fromAuditFields(fields, eventsRaw);
  }

  async listRecent(limit: number, filter?: CommandRecordFilter): Promise<CommandRecord[]> {
    await this.ensureConnected();
    const safeLimit = Math.max(1, limit);
    const ids = await this.client.zRange(
      this.updatedIndexKey,
      0,
      Math.max(100, safeLimit * 5),
      { REV: true }
    );
    const values: CommandRecord[] = [];
    for (const commandId of ids) {
      const record = await this.get(commandId);
      if (!record) {
        await this.client.zRem(this.updatedIndexKey, commandId);
        continue;
      }
      if (filter?.userId && record.userId !== filter.userId) {
        continue;
      }
      if (filter?.machineId && record.machineId !== filter.machineId) {
        continue;
      }
      if (filter?.status && record.status !== filter.status) {
        continue;
      }
      values.push(record);
      if (values.length >= safeLimit) {
        break;
      }
    }
    return values;
  }

  async count(): Promise<number> {
    await this.ensureConnected();
    return this.client.zCard(this.updatedIndexKey);
  }

  async statusCounts(): Promise<Record<string, number>> {
    await this.ensureConnected();
    const fields = await this.client.hGetAll(this.statusCountsKey);
    const output: Record<string, number> = {};
    for (const [key, value] of Object.entries(fields)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        output[key] = parsed;
      }
    }
    return output;
  }

  async ping(): Promise<void> {
    await this.ensureConnected();
    await this.client.ping();
  }

  async close(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  private async pruneOverflow(maxRecords: number): Promise<void> {
    const safeMax = Math.max(1, maxRecords);
    const total = await this.client.zCard(this.updatedIndexKey);
    if (total <= safeMax) {
      return;
    }
    const overflow = total - safeMax;
    const oldest = await this.client.zRange(this.updatedIndexKey, 0, overflow - 1);
    for (const commandId of oldest) {
      const key = this.recordKey(commandId);
      const status = await this.client.hGet(key, "status");
      await this.client.multi()
        .del(key)
        .del(this.eventsKey(commandId))
        .zRem(this.updatedIndexKey, commandId)
        .exec();
      if (status) {
        await this.client.hIncrBy(this.statusCountsKey, status, -1);
      }
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isOpen) {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.client.connect();
    }
    await this.connectPromise;
  }

  private recordKey(commandId: string): string {
    return `${this.prefix}audit:record:${commandId}`;
  }

  private eventsKey(commandId: string): string {
    return `${this.prefix}audit:events:${commandId}`;
  }
}

function toFieldMap(input: Record<string, string | number>): FieldMap {
  const result: FieldMap = {};
  for (const [key, value] of Object.entries(input)) {
    result[key] = String(value);
  }
  return result;
}

function fromMachineFields(
  machineId: string,
  fields: Record<string, string>
): MachineStateRecord | undefined {
  if (!fields.machineId && Object.keys(fields).length === 0) {
    return undefined;
  }
  const connectedAt = Number(fields.connectedAt);
  const lastHeartbeatAt = Number(fields.lastHeartbeatAt);
  if (!Number.isFinite(connectedAt) || !Number.isFinite(lastHeartbeatAt) || !fields.sessionId) {
    return undefined;
  }
  return {
    machineId: fields.machineId || machineId,
    connectedAt,
    lastHeartbeatAt,
    runningCount: parseNumber(fields.runningCount, 0),
    pendingCount: parseNumber(fields.pendingCount, 0),
    sessionId: fields.sessionId
  };
}

function fromInflightFields(
  commandId: string,
  fields: Record<string, string>
): InflightCommandRecord | undefined {
  if (!fields.commandId && Object.keys(fields).length === 0) {
    return undefined;
  }
  const createdAtMs = Number(fields.createdAtMs);
  if (!Number.isFinite(createdAtMs) || !fields.userId || !fields.machineId || !fields.kind) {
    return undefined;
  }
  return {
    commandId: fields.commandId || commandId,
    createdAtMs,
    userId: fields.userId,
    machineId: fields.machineId,
    kind: fields.kind
  };
}

function fromAuditFields(
  fields: Record<string, string>,
  rawEvents: string[]
): CommandRecord | undefined {
  if (!fields.commandId || !fields.createdAt || !fields.updatedAt || !fields.status) {
    return undefined;
  }
  const events: CommandEvent[] = [];
  for (const raw of rawEvents) {
    try {
      const parsed = JSON.parse(raw) as CommandEvent;
      if (parsed.commandId && parsed.timestamp && parsed.status) {
        events.push(parsed);
      }
    } catch {
      continue;
    }
  }
  return {
    commandId: fields.commandId,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
    status: fields.status,
    userId: fields.userId,
    machineId: fields.machineId,
    kind: fields.kind,
    summary: fields.summary,
    events
  };
}

function parseNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseConnectTimeout(raw: number | undefined): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return undefined;
  }
  return Math.floor(raw);
}
