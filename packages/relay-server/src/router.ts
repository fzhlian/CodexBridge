import type { FastifyReply, FastifyServerOptions } from "fastify";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import {
  MemoryIdempotencyStore,
  parseDevCommand,
  type CommandEnvelope,
  type RelayEnvelope,
  type ResultStatus
} from "@codexbridge/shared";
import { AuditStore } from "./audit-store.js";
import { FixedWindowRateLimiter } from "./rate-limiter.js";
import { MachineRegistry } from "./machine-registry.js";
import {
  createWeComSignature,
  decryptWeComMessage,
  encryptWeComMessage,
  verifyWeComSignature
} from "./wecom.js";
import { sendWeComTextMessage } from "./wecom-api.js";
import {
  buildWeComEncryptedReplyXml,
  isLikelyXml,
  parseWeComXml
} from "./wecom-xml.js";

type WeComCallbackBody = {
  msgId?: string;
  userId?: string;
  machineId?: string;
  text?: string;
  encrypt?: string;
  message?: {
    msgId?: string;
    userId?: string;
    machineId?: string;
    text?: string;
  };
};

export type RelayServerDeps = {
  idempotencyTtlMs?: number;
  rateLimitPerMinute?: number;
  allowlist?: Set<string>;
  machineBindings?: Map<string, string>;
};

export function createRelayServer(
  options: FastifyServerOptions = {},
  deps: RelayServerDeps = {}
) {
  const app = Fastify({ logger: true, ...options });
  const dedupe = new MemoryIdempotencyStore();
  const machineRegistry = new MachineRegistry();
  const limiter = new FixedWindowRateLimiter(deps.rateLimitPerMinute ?? 60, 60_000);
  const idempotencyTtlMs = deps.idempotencyTtlMs ?? 24 * 60 * 60 * 1000;
  const allowlist = deps.allowlist ?? parseAllowlist(process.env.ALLOWLIST_USERS);
  const machineBindings =
    deps.machineBindings ?? parseMachineBindings(process.env.MACHINE_BINDINGS);
  const commandOwners = new Map<
    string,
    { userId: string; machineId: string; createdAtMs: number; kind: string }
  >();
  const commandTemplates = new Map<string, CommandEnvelope>();
  const auditMaxRecords = Number(process.env.AUDIT_MAX_RECORDS ?? "2000");
  const auditStore = new AuditStore(
    process.env.AUDIT_LOG_PATH ?? "audit/relay-command-events.jsonl",
    Number.isFinite(auditMaxRecords) && auditMaxRecords > 0 ? auditMaxRecords : 2000
  );
  void auditStore.hydrateFromDisk().catch((error) => {
    app.log.error({ error }, "failed to hydrate audit store");
  });
  const heartbeatTimeoutMs = Number(process.env.MACHINE_HEARTBEAT_TIMEOUT_MS ?? "45000");
  const inflightTimeoutMs = Number(process.env.INFLIGHT_COMMAND_TIMEOUT_MS ?? "900000");

  const wss = new WebSocketServer({ noServer: true });
  const wecomToken = process.env.WECOM_TOKEN;
  const wecomEncodingAesKey = process.env.WECOM_ENCODING_AES_KEY;
  const wecomCorpId = process.env.WECOM_CORP_ID;
  const adminToken = process.env.RELAY_ADMIN_TOKEN;

  const cleanupTimer = setInterval(() => {
    void cleanupStaleInflight();
  }, 60_000);

  app.addHook("onClose", async () => {
    clearInterval(cleanupTimer);
  });

  app.addContentTypeParser(
    ["application/xml", "text/xml"],
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, body);
    }
  );

  app.server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/agent") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (socket) => {
    let machineId: string | undefined;

    socket.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as RelayEnvelope;
        if (parsed.type === "agent.hello") {
          machineId = parsed.machineId;
          machineRegistry.register(machineId, socket);
          return;
        }

        if (parsed.type === "agent.heartbeat") {
          machineRegistry.markHeartbeat(parsed.machineId);
          return;
        }

        if (parsed.type === "agent.result") {
          const owner = commandOwners.get(parsed.result.commandId);
          if (owner) {
            commandOwners.delete(parsed.result.commandId);
            void notifyCommandResult(
              app,
              owner.userId,
              parsed.result.summary,
              parsed.result.status
            );
          }
          void auditStore.record({
            commandId: parsed.result.commandId,
            timestamp: new Date().toISOString(),
            status: `agent_${parsed.result.status}`,
            machineId: parsed.result.machineId,
            summary: parsed.result.summary
          });
          app.log.info(
            {
              commandId: parsed.result.commandId,
              machineId: parsed.result.machineId,
              status: parsed.result.status
            },
            "agent result received"
          );
        }
      } catch (error) {
        app.log.warn({ error }, "invalid ws payload");
      }
    });

    socket.on("close", () => {
      if (machineId) {
        machineRegistry.remove(machineId);
      }
    });
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/metrics", async (_request, reply) => {
    if (!assertAdminAuthorized(_request, reply, adminToken)) {
      return;
    }
    const now = Date.now();
    const machineSnapshots = machineRegistry.list();
    const staleMachines = machineSnapshots.filter(
      (item) => now - item.lastHeartbeatAt > heartbeatTimeoutMs
    ).length;
    return reply.status(200).send({
      machines: {
        totalConnected: machineSnapshots.length,
        stale: staleMachines
      },
      inflight: {
        total: commandOwners.size
      },
      audit: {
        records: auditStore.count(),
        byStatus: auditStore.statusCounts()
      }
    });
  });

  app.get("/ops/config", async (request, reply) => {
    if (!assertAdminAuthorized(request, reply, adminToken)) {
      return;
    }
    return reply.status(200).send({
      relay: {
        heartbeatTimeoutMs,
        inflightTimeoutMs,
        adminTokenEnabled: Boolean(adminToken),
        allowlistSize: allowlist.size,
        machineBindingsSize: machineBindings.size
      },
      wecom: {
        tokenConfigured: Boolean(wecomToken),
        aesKeyConfigured: Boolean(wecomEncodingAesKey),
        corpIdConfigured: Boolean(wecomCorpId),
        agentSecretConfigured: Boolean(process.env.WECOM_AGENT_SECRET),
        agentIdConfigured: Boolean(process.env.WECOM_AGENT_ID)
      },
      audit: {
        logPath: process.env.AUDIT_LOG_PATH ?? "audit/relay-command-events.jsonl",
        maxRecords: Number.isFinite(auditMaxRecords) ? auditMaxRecords : 2000
      }
    });
  });

  app.get("/machines", async (_request, reply) => {
    if (!assertAdminAuthorized(_request, reply, adminToken)) {
      return;
    }
    const now = Date.now();
    const items = machineRegistry.list().map((item) => ({
      machineId: item.machineId,
      connectedAt: new Date(item.connectedAt).toISOString(),
      lastHeartbeatAt: new Date(item.lastHeartbeatAt).toISOString(),
      stale: now - item.lastHeartbeatAt > heartbeatTimeoutMs
    }));
    return reply.status(200).send({ items });
  });

  app.get("/inflight", async (_request, reply) => {
    if (!assertAdminAuthorized(_request, reply, adminToken)) {
      return;
    }
    const now = Date.now();
    const items = [...commandOwners.entries()].map(([commandId, owner]) => ({
      commandId,
      userId: owner.userId,
      machineId: owner.machineId,
      kind: owner.kind,
      ageMs: now - owner.createdAtMs
    }));
    return reply.status(200).send({ items });
  });

  app.get("/commands/:commandId", async (request, reply) => {
    if (!assertAdminAuthorized(request, reply, adminToken)) {
      return;
    }
    const params = request.params as { commandId: string };
    const record = auditStore.get(params.commandId);
    if (!record) {
      return reply.status(404).send({ error: "command_not_found" });
    }
    return reply.status(200).send(record);
  });

  app.get("/audit/recent", async (request, reply) => {
    if (!assertAdminAuthorized(request, reply, adminToken)) {
      return;
    }
    const query = request.query as {
      limit?: string;
      userId?: string;
      machineId?: string;
      status?: string;
    };
    const parsedLimit = Number(query.limit ?? "50");
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;
    return reply.status(200).send({
      items: auditStore.listRecent(limit, {
        userId: query.userId,
        machineId: query.machineId,
        status: query.status
      })
    });
  });

  app.post("/commands/:commandId/cancel", async (request, reply) => {
    if (!assertAdminAuthorized(request, reply, adminToken)) {
      return;
    }
    const params = request.params as { commandId: string };
    const body = (request.body ?? {}) as { userId?: string };
    const owner = commandOwners.get(params.commandId);
    if (!owner) {
      return reply.status(404).send({ error: "command_not_inflight" });
    }
    if (body.userId && body.userId !== owner.userId) {
      return reply.status(403).send({ error: "cancel_not_authorized" });
    }

    const session = machineRegistry.get(owner.machineId);
    if (!session || Date.now() - session.lastHeartbeatAt > heartbeatTimeoutMs) {
      await auditStore.record({
        commandId: params.commandId,
        timestamp: new Date().toISOString(),
        status: "cancel_failed_machine_offline",
        userId: owner.userId,
        machineId: owner.machineId
      });
      return reply.status(409).send({ error: "machine_offline" });
    }

    session.socket.send(
      JSON.stringify({
        type: "command.cancel",
        commandId: params.commandId,
        requestedAt: new Date().toISOString()
      })
    );
    await auditStore.record({
      commandId: params.commandId,
      timestamp: new Date().toISOString(),
      status: "cancel_sent",
      userId: owner.userId,
      machineId: owner.machineId
    });

    return reply.status(200).send({ status: "cancel_sent", commandId: params.commandId });
  });

  app.post("/commands/:commandId/retry", async (request, reply) => {
    if (!assertAdminAuthorized(request, reply, adminToken)) {
      return;
    }
    const params = request.params as { commandId: string };
    const body = (request.body ?? {}) as { userId?: string };
    const base = commandTemplates.get(params.commandId);
    if (!base) {
      return reply.status(404).send({ error: "command_not_found_for_retry" });
    }
    if (body.userId && body.userId !== base.userId) {
      return reply.status(403).send({ error: "retry_not_authorized" });
    }

    const session = machineRegistry.get(base.machineId);
    if (!session || Date.now() - session.lastHeartbeatAt > heartbeatTimeoutMs) {
      return reply.status(409).send({ error: "machine_offline" });
    }

    const retry: CommandEnvelope = {
      ...base,
      commandId: randomUUID(),
      createdAt: new Date().toISOString()
    };
    session.socket.send(JSON.stringify({ type: "command", command: retry }));
    commandOwners.set(retry.commandId, {
      userId: retry.userId,
      machineId: retry.machineId,
      createdAtMs: Date.now(),
      kind: retry.kind
    });
    commandTemplates.set(retry.commandId, retry);

    await auditStore.record({
      commandId: retry.commandId,
      timestamp: retry.createdAt,
      status: "retried_created",
      userId: retry.userId,
      machineId: retry.machineId,
      kind: retry.kind,
      metadata: {
        retriedFrom: params.commandId
      }
    });
    await auditStore.record({
      commandId: retry.commandId,
      timestamp: new Date().toISOString(),
      status: "sent_to_agent",
      userId: retry.userId,
      machineId: retry.machineId,
      kind: retry.kind
    });

    return reply.status(200).send({
      status: "retried_sent",
      commandId: retry.commandId,
      retriedFrom: params.commandId
    });
  });

  app.get("/wecom/callback", async (request, reply) => {
    const query = request.query as {
      msg_signature?: string;
      timestamp?: string;
      nonce?: string;
      echostr?: string;
    };

    if (!query.echostr) {
      return reply.status(400).send({ error: "missing_echostr" });
    }

    if (wecomToken && query.msg_signature && query.timestamp && query.nonce) {
      const ok = verifyWeComSignature({
        token: wecomToken,
        timestamp: query.timestamp,
        nonce: query.nonce,
        encrypted: query.echostr,
        signature: query.msg_signature
      });
      if (!ok) {
        return reply.status(401).send({ error: "invalid_signature" });
      }
    }

    if (wecomEncodingAesKey) {
      const plain = decryptWeComMessage(query.echostr, wecomEncodingAesKey);
      return reply.type("text/plain").send(plain);
    }

    return reply.type("text/plain").send(query.echostr);
  });

  app.post("/wecom/callback", async (request, reply) => {
    const query = request.query as {
      msg_signature?: string;
      timestamp?: string;
      nonce?: string;
    };
    const isXml = typeof request.body === "string";
    const body = parseIncomingBody(request.body);

    const normalized = normalizeWeComMessage(body);
    let payload = normalized;

    if (body.encrypt) {
      if (!wecomToken || !wecomEncodingAesKey) {
        return reply.status(400).send({ error: "missing_wecom_crypto_config" });
      }
      if (!query.msg_signature || !query.timestamp || !query.nonce) {
        return reply.status(400).send({ error: "missing_signature_fields" });
      }

      const valid = verifyWeComSignature({
        token: wecomToken,
        timestamp: query.timestamp,
        nonce: query.nonce,
        encrypted: body.encrypt,
        signature: query.msg_signature
      });
      if (!valid) {
        return reply.status(401).send({ error: "invalid_signature" });
      }

      const plain = decryptWeComMessage(body.encrypt, wecomEncodingAesKey);
      let parsed: WeComCallbackBody;
      try {
        parsed = parseFlexiblePayload(plain);
      } catch {
        return reply.status(400).send({ error: "invalid_decrypted_payload" });
      }
      payload = normalizeWeComMessage(parsed);
    }

    if (!payload.msgId || !payload.userId || !payload.text) {
      return reply.status(400).send({ error: "invalid_payload" });
    }

    if (!limiter.allow(payload.userId)) {
      return reply.status(429).send({ error: "rate_limited" });
    }

    if (!allowlist.has(payload.userId)) {
      return reply.status(403).send({ error: "user_not_allowed" });
    }

    const boundMachine = machineBindings.get(payload.userId);
    const machineId = payload.machineId || boundMachine;
    if (!machineId) {
      return reply.status(400).send({ error: "missing_machine_id" });
    }
    if (boundMachine && boundMachine !== machineId) {
      return reply.status(403).send({ error: "machine_binding_mismatch" });
    }

    if (await dedupe.seen(payload.msgId)) {
      return sendWeComAck(
        reply,
        { isXml, encryptedRequest: Boolean(body.encrypt) },
        { status: "duplicate_ignored" },
        {
          token: wecomToken,
          encodingAesKey: wecomEncodingAesKey,
          receiveId: wecomCorpId
        }
      );
    }
    await dedupe.mark(payload.msgId, idempotencyTtlMs);

    const parsed = parseDevCommand(payload.text);
    if (!parsed) {
      return sendWeComAck(
        reply,
        { isXml, encryptedRequest: Boolean(body.encrypt) },
        { status: "ignored_non_dev_message" },
        {
          token: wecomToken,
          encodingAesKey: wecomEncodingAesKey,
          receiveId: wecomCorpId
        }
      );
    }

    const command: CommandEnvelope = {
      commandId: randomUUID(),
      machineId,
      userId: payload.userId,
      kind: parsed.kind,
      prompt: parsed.prompt,
      refId: parsed.refId,
      createdAt: new Date().toISOString()
    };
    commandTemplates.set(command.commandId, command);
    await auditStore.record({
      commandId: command.commandId,
      timestamp: command.createdAt,
      status: "created",
      userId: command.userId,
      machineId: command.machineId,
      kind: command.kind,
      summary: payload.text
    });

    const session = machineRegistry.get(machineId);
    if (!session || Date.now() - session.lastHeartbeatAt > heartbeatTimeoutMs) {
      await auditStore.record({
        commandId: command.commandId,
        timestamp: new Date().toISOString(),
        status: "machine_offline",
        userId: command.userId,
        machineId: command.machineId
      });
      return sendWeComAck(
        reply,
        { isXml, encryptedRequest: Boolean(body.encrypt) },
        {
          status: "machine_offline",
          machineId,
          commandId: command.commandId
        },
        {
          token: wecomToken,
          encodingAesKey: wecomEncodingAesKey,
          receiveId: wecomCorpId
        }
      );
    }

    session?.socket.send(JSON.stringify({ type: "command", command }));
    commandOwners.set(command.commandId, {
      userId: payload.userId,
      machineId,
      createdAtMs: Date.now(),
      kind: command.kind
    });
    await auditStore.record({
      commandId: command.commandId,
      timestamp: new Date().toISOString(),
      status: "sent_to_agent",
      userId: command.userId,
      machineId: command.machineId,
      kind: command.kind
    });

    return sendWeComAck(
      reply,
      { isXml, encryptedRequest: Boolean(body.encrypt) },
      {
        status: "sent_to_agent",
        commandId: command.commandId
      },
      {
        token: wecomToken,
        encodingAesKey: wecomEncodingAesKey,
        receiveId: wecomCorpId
      }
    );
  });

  return app;

  async function cleanupStaleInflight(): Promise<void> {
    const now = Date.now();
    for (const [commandId, owner] of commandOwners.entries()) {
      if (now - owner.createdAtMs <= inflightTimeoutMs) {
        continue;
      }
      commandOwners.delete(commandId);
      await auditStore.record({
        commandId,
        timestamp: new Date().toISOString(),
        status: "inflight_timeout",
        userId: owner.userId,
        machineId: owner.machineId,
        kind: owner.kind
      });
      void notifyCommandResult(
        app,
        owner.userId,
        `command ${commandId} timed out while waiting for agent result`,
        "error"
      );
    }
  }
}

function assertAdminAuthorized(
  request: { headers: Record<string, unknown> },
  reply: FastifyReply,
  adminToken?: string
): boolean {
  if (!adminToken) {
    return true;
  }
  const headerValue = request.headers["x-admin-token"];
  const incoming = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof incoming !== "string" || incoming !== adminToken) {
    void reply.status(401).send({ error: "unauthorized_admin_request" });
    return false;
  }
  return true;
}

function parseAllowlist(raw?: string): Set<string> {
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function parseMachineBindings(raw?: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!raw) {
    return result;
  }

  for (const segment of raw.split(",")) {
    const [userId, machineId] = segment.split(":").map((value) => value.trim());
    if (!userId || !machineId) {
      continue;
    }
    result.set(userId, machineId);
  }
  return result;
}

function normalizeWeComMessage(body?: WeComCallbackBody): {
  msgId?: string;
  userId?: string;
  machineId?: string;
  text?: string;
} {
  if (!body) {
    return {};
  }
  const message = body.message ?? {};
  return {
    msgId: message.msgId ?? body.msgId,
    userId: message.userId ?? body.userId,
    machineId: message.machineId ?? body.machineId,
    text: message.text ?? body.text
  };
}

function parseIncomingBody(payload: unknown): WeComCallbackBody {
  if (typeof payload === "string") {
    return fromXmlPayload(payload);
  }
  if (!payload || typeof payload !== "object") {
    return {};
  }
  return payload as WeComCallbackBody;
}

function parseFlexiblePayload(raw: string): WeComCallbackBody {
  if (isLikelyXml(raw)) {
    return fromXmlPayload(raw);
  }
  try {
    return JSON.parse(raw) as WeComCallbackBody;
  } catch {
    throw new Error("invalid decrypted payload");
  }
}

function fromXmlPayload(xml: string): WeComCallbackBody {
  const parsed = parseWeComXml(xml);
  return {
    encrypt: parsed.encrypt,
    msgId: parsed.msgId ?? fallbackMsgId(parsed),
    userId: parsed.fromUserName,
    text: parsed.content
  };
}

function fallbackMsgId(parsed: {
  msgId?: string;
  fromUserName?: string;
  createTime?: string;
}): string | undefined {
  if (parsed.msgId) {
    return parsed.msgId;
  }
  if (!parsed.fromUserName || !parsed.createTime) {
    return undefined;
  }
  return `${parsed.fromUserName}-${parsed.createTime}`;
}

function sendWeComAck(
  reply: FastifyReply,
  mode: { isXml: boolean; encryptedRequest: boolean },
  jsonPayload: Record<string, unknown>,
  crypto: {
    token?: string;
    encodingAesKey?: string;
    receiveId?: string;
  }
) {
  if (mode.isXml && mode.encryptedRequest) {
    if (crypto.token && crypto.encodingAesKey && crypto.receiveId) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = randomUUID().replace(/-/g, "").slice(0, 16);
      const encrypted = encryptWeComMessage("success", crypto.encodingAesKey, crypto.receiveId);
      const signature = createWeComSignature(crypto.token, timestamp, nonce, encrypted);
      const xml = buildWeComEncryptedReplyXml({
        encrypt: encrypted,
        signature,
        timestamp,
        nonce
      });
      return reply.status(200).type("application/xml").send(xml);
    }
    return reply.status(500).send({ error: "missing_wecom_encrypted_reply_config" });
  }

  if (mode.isXml) {
    return reply.status(200).type("text/plain").send("success");
  }
  return reply.status(200).send(jsonPayload);
}

async function notifyCommandResult(
  app: ReturnType<typeof Fastify>,
  userId: string,
  summary: string,
  status: ResultStatus
): Promise<void> {
  const wecomCorpId = process.env.WECOM_CORP_ID;
  const wecomAgentSecret = process.env.WECOM_AGENT_SECRET;
  const wecomAgentId = process.env.WECOM_AGENT_ID
    ? Number(process.env.WECOM_AGENT_ID)
    : undefined;

  if (wecomCorpId && wecomAgentSecret && wecomAgentId) {
    try {
      await sendWeComTextMessage(
        {
          corpId: wecomCorpId,
          agentSecret: wecomAgentSecret,
          agentId: wecomAgentId
        },
        userId,
        `[CodexBridge][${status}] ${summary}`
      );
      return;
    } catch (error) {
      app.log.error({ error, userId }, "failed to push wecom api message");
    }
  }

  const webhookUrl = process.env.RESULT_WEBHOOK_URL;
  if (!webhookUrl) {
    app.log.info({ userId, status, summary }, "result ready for chat push");
    return;
  }
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId,
        status,
        summary
      })
    });
  } catch (error) {
    app.log.error({ error, userId }, "failed to push result webhook");
  }
}
