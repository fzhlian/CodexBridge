import type { FastifyReply, FastifyServerOptions } from "fastify";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import {
  parseDevCommand,
  type CommandKind,
  type CommandEnvelope,
  type RelayEnvelope,
  type RelayTraceEvent,
  type ResultStatus
} from "@codexbridge/shared";
import { AuditStore } from "./audit-store.js";
import { FixedWindowRateLimiter } from "./rate-limiter.js";
import { MachineRegistry } from "./machine-registry.js";
import { createRelayStoresFromEnv } from "./store-factory.js";
import {
  createWeComSignature,
  decryptWeComMessage,
  encryptWeComMessage,
  verifyWeComSignature
} from "./wecom.js";
import { sendWeComTextMessage } from "./wecom-api.js";
import {
  buildWeComEncryptedReplyXml,
  buildWeComTextReplyXml,
  isLikelyXml,
  parseWeComXml
} from "./wecom-xml.js";

type WeComCallbackBody = {
  msgId?: string;
  userId?: string;
  machineId?: string;
  text?: string;
  fromUserName?: string;
  toUserName?: string;
  encrypt?: string;
  message?: {
    msgId?: string;
    userId?: string;
    machineId?: string;
    text?: string;
    fromUserName?: string;
    toUserName?: string;
  };
};

type NormalizedWeComMessage = {
  msgId?: string;
  userId?: string;
  machineId?: string;
  text?: string;
  replyToUserName?: string;
  replyFromUserName?: string;
};

export type RelayServerDeps = {
  idempotencyTtlMs?: number;
  rateLimitPerMinute?: number;
  allowlist?: Set<string>;
  machineBindings?: Map<string, string>;
};

export async function createRelayServer(
  options: FastifyServerOptions = {},
  deps: RelayServerDeps = {}
) {
  const app = Fastify({ logger: true, ...options });
  const stores = await createRelayStoresFromEnv();
  const dedupe = stores.idempotency;
  const limiter = new FixedWindowRateLimiter(deps.rateLimitPerMinute ?? 60, 60_000);
  const idempotencyTtlMs = deps.idempotencyTtlMs ?? 24 * 60 * 60 * 1000;
  const allowlist = deps.allowlist ?? parseAllowlist(process.env.ALLOWLIST_USERS);
  const machineBindings =
    deps.machineBindings ?? parseMachineBindings(process.env.MACHINE_BINDINGS);
  const machineTtlMs = parsePositiveMs(
    process.env.REDIS_MACHINE_TTL_MS,
    Number(process.env.MACHINE_HEARTBEAT_TIMEOUT_MS ?? "45000") * 2
  );
  const machineRegistry = new MachineRegistry(stores.machineState, machineTtlMs);

  const commandTemplates = new Map<string, { command: CommandEnvelope; createdAtMs: number }>();
  const commandTemplateTtlMs = Number(process.env.COMMAND_TEMPLATE_TTL_MS ?? "86400000");
  const commandTemplateMax = Number(process.env.COMMAND_TEMPLATE_MAX ?? "5000");
  const auditMaxRecords = Number(process.env.AUDIT_MAX_RECORDS ?? "2000");
  const inflightTimeoutMs = Number(process.env.INFLIGHT_COMMAND_TIMEOUT_MS ?? "900000");
  const inflightStoreTtlMs = parsePositiveMs(
    process.env.REDIS_INFLIGHT_TTL_MS,
    Math.max(inflightTimeoutMs * 2, 30 * 60 * 1000)
  );
  const auditStore = new AuditStore(
    stores.auditIndex,
    process.env.AUDIT_LOG_PATH ?? "audit/relay-command-events.jsonl",
    Number.isFinite(auditMaxRecords) && auditMaxRecords > 0 ? auditMaxRecords : 2000
  );
  void auditStore.hydrateFromDisk().catch((error) => {
    app.log.error({ error }, "failed to hydrate audit store");
  });
  const heartbeatTimeoutMs = Number(process.env.MACHINE_HEARTBEAT_TIMEOUT_MS ?? "45000");

  const wss = new WebSocketServer({ noServer: true });
  const wecomToken = process.env.WECOM_TOKEN;
  const wecomEncodingAesKey = process.env.WECOM_ENCODING_AES_KEY;
  const wecomCorpId = process.env.WECOM_CORP_ID;
  const adminToken = process.env.RELAY_ADMIN_TOKEN;

  const cleanupTimer = setInterval(() => {
    void cleanupStaleInflight();
    cleanupCommandTemplates();
  }, 60_000);

  app.addHook("onClose", async () => {
    clearInterval(cleanupTimer);
    await stores.close();
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
    let sessionId: string | undefined;

    socket.on("message", (data) => {
      void (async () => {
        try {
          const parsed = JSON.parse(data.toString()) as RelayEnvelope;
          if (parsed.type === "agent.hello") {
            machineId = parsed.machineId;
            sessionId = await machineRegistry.register(machineId, socket);
            emitRelayTrace(app, machineRegistry, parsed.machineId, {
              direction: "relay->agent",
              stage: "agent_connected",
              machineId: parsed.machineId
            });
            return;
          }

          if (parsed.type === "agent.heartbeat") {
            await machineRegistry.markHeartbeat(parsed.machineId, {
              runningCount: parsed.runningCount,
              pendingCount: parsed.pendingCount
            });
            return;
          }

          if (parsed.type === "agent.result") {
            emitRelayTrace(app, machineRegistry, parsed.result.machineId, {
              direction: "agent->relay",
              stage: "result_received",
              commandId: parsed.result.commandId,
              machineId: parsed.result.machineId,
              status: parsed.result.status,
              detail: clipForTrace(parsed.result.summary, 180)
            });
            const owner = await stores.inflight.get(parsed.result.commandId);
            if (owner) {
              await stores.inflight.remove(parsed.result.commandId);
              void notifyCommandResult(
                app,
                owner.userId,
                parsed.result.summary,
                parsed.result.status,
                {
                  commandId: parsed.result.commandId,
                  machineId: parsed.result.machineId,
                  kind: normalizeCommandKind(owner.kind),
                  trace: (trace) =>
                    emitRelayTrace(app, machineRegistry, parsed.result.machineId, trace)
                }
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
      })();
    });

    socket.on("close", () => {
      if (machineId && sessionId) {
        void machineRegistry.remove(machineId, sessionId);
      }
    });
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/metrics", async (_request, reply) => {
    if (!assertAdminAuthorized(_request, reply, adminToken)) {
      return;
    }
    const now = Date.now();
    const machineSnapshots = await machineRegistry.list();
    const staleMachines = machineSnapshots.filter(
      (item) => now - item.lastHeartbeatAt > heartbeatTimeoutMs
    ).length;
    const inflight = await stores.inflight.list();
    const auditCount = await auditStore.count();
    const auditByStatus = await auditStore.statusCounts();
    return reply.status(200).send({
      machines: {
        totalConnected: machineSnapshots.length,
        stale: staleMachines
      },
      inflight: {
        total: inflight.length
      },
      audit: {
        records: auditCount,
        byStatus: auditByStatus
      },
      store: {
        mode: stores.diagnostics.mode,
        degraded: stores.diagnostics.degraded,
        redisErrorCount: stores.diagnostics.redisErrorCount
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
        commandTemplateTtlMs,
        commandTemplateMax,
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
      },
      store: {
        configuredMode: stores.diagnostics.configuredMode,
        mode: stores.diagnostics.mode,
        degraded: stores.diagnostics.degraded,
        redisErrorCount: stores.diagnostics.redisErrorCount,
        lastRedisError: stores.diagnostics.lastRedisError,
        redisMachineTtlMs: machineTtlMs,
        redisInflightTtlMs: inflightStoreTtlMs
      }
    });
  });

  app.get("/machines", async (_request, reply) => {
    if (!assertAdminAuthorized(_request, reply, adminToken)) {
      return;
    }
    const now = Date.now();
    const items = (await machineRegistry.list()).map((item) => ({
      machineId: item.machineId,
      connectedAt: new Date(item.connectedAt).toISOString(),
      lastHeartbeatAt: new Date(item.lastHeartbeatAt).toISOString(),
      stale: now - item.lastHeartbeatAt > heartbeatTimeoutMs,
      runningCount: item.runningCount ?? 0,
      pendingCount: item.pendingCount ?? 0
    }));
    return reply.status(200).send({ items });
  });

  app.get("/inflight", async (_request, reply) => {
    if (!assertAdminAuthorized(_request, reply, adminToken)) {
      return;
    }
    const now = Date.now();
    const items = (await stores.inflight.list()).map((owner) => ({
      commandId: owner.commandId,
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
    const record = await auditStore.get(params.commandId);
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
      items: await auditStore.listRecent(limit, {
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
    const owner = await stores.inflight.get(params.commandId);
    if (!owner) {
      return reply.status(404).send({ error: "command_not_inflight" });
    }
    if (body.userId && body.userId !== owner.userId) {
      return reply.status(403).send({ error: "cancel_not_authorized" });
    }

    const session = await machineRegistry.getState(owner.machineId);
    const socket = machineRegistry.getSocket(owner.machineId);
    if (!session || !socket || Date.now() - session.lastHeartbeatAt > heartbeatTimeoutMs) {
      await auditStore.record({
        commandId: params.commandId,
        timestamp: new Date().toISOString(),
        status: "cancel_failed_machine_offline",
        userId: owner.userId,
        machineId: owner.machineId
      });
      return reply.status(409).send({ error: "machine_offline" });
    }

    socket.send(
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
    const baseEntry = commandTemplates.get(params.commandId);
    if (!baseEntry) {
      return reply.status(404).send({ error: "command_not_found_for_retry" });
    }
    const base = baseEntry.command;
    if (body.userId && body.userId !== base.userId) {
      return reply.status(403).send({ error: "retry_not_authorized" });
    }

    const session = await machineRegistry.getState(base.machineId);
    const socket = machineRegistry.getSocket(base.machineId);
    if (!session || !socket || Date.now() - session.lastHeartbeatAt > heartbeatTimeoutMs) {
      return reply.status(409).send({ error: "machine_offline" });
    }

    const retry: CommandEnvelope = {
      ...base,
      commandId: randomUUID(),
      createdAt: new Date().toISOString()
    };
    socket.send(JSON.stringify({ type: "command", command: retry }));
    await stores.inflight.set({
      commandId: retry.commandId,
      userId: retry.userId,
      machineId: retry.machineId,
      createdAtMs: Date.now(),
      kind: retry.kind
    }, inflightStoreTtlMs);
    commandTemplates.set(retry.commandId, {
      command: retry,
      createdAtMs: Date.now()
    });

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
      emitRelayTrace(app, machineRegistry, machineId, {
        direction: "wecom->relay",
        stage: "duplicate_ignored",
        machineId,
        userId: payload.userId,
        status: "duplicate_ignored"
      });
      emitRelayTrace(app, machineRegistry, machineId, {
        direction: "relay->wecom",
        stage: "passive_ack_sent",
        machineId,
        userId: payload.userId,
        status: "duplicate_ignored"
      });
      return sendWeComAck(
        reply,
        { isXml, encryptedRequest: Boolean(body.encrypt) },
        { status: "duplicate_ignored" },
        {
          token: wecomToken,
          encodingAesKey: wecomEncodingAesKey,
          receiveId: wecomCorpId
        },
        resolveReplyTarget(payload)
      );
    }
    await dedupe.mark(payload.msgId, idempotencyTtlMs);

    const parsed = parseDevCommand(payload.text);
    if (!parsed) {
      emitRelayTrace(app, machineRegistry, machineId, {
        direction: "wecom->relay",
        stage: "non_dev_message_ignored",
        machineId,
        userId: payload.userId,
        status: "ignored_non_dev_message",
        detail: clipForTrace(payload.text, 120)
      });
      emitRelayTrace(app, machineRegistry, machineId, {
        direction: "relay->wecom",
        stage: "passive_ack_sent",
        machineId,
        userId: payload.userId,
        status: "ignored_non_dev_message"
      });
      return sendWeComAck(
        reply,
        { isXml, encryptedRequest: Boolean(body.encrypt) },
        { status: "ignored_non_dev_message" },
        {
          token: wecomToken,
          encodingAesKey: wecomEncodingAesKey,
          receiveId: wecomCorpId
        },
        resolveReplyTarget(payload)
      );
    }

    const applyRefResolution =
      parsed.kind === "apply" && parsed.refId
        ? await resolveApplyRefId(parsed.refId)
        : undefined;
    const resolvedRefId =
      parsed.kind === "apply"
        ? (applyRefResolution?.resolvedRefId ?? parsed.refId)
        : parsed.refId;
    const command: CommandEnvelope = {
      commandId: randomUUID(),
      machineId,
      userId: payload.userId,
      kind: parsed.kind,
      prompt: parsed.kind === "apply" ? payload.text : parsed.prompt,
      refId: resolvedRefId,
      createdAt: new Date().toISOString()
    };
    if (
      parsed.kind === "apply"
      && parsed.refId
      && command.refId
      && parsed.refId !== command.refId
    ) {
      emitRelayTrace(app, machineRegistry, machineId, {
        direction: "wecom->relay",
        stage: "apply_ref_resolved",
        commandId: command.commandId,
        machineId: command.machineId,
        userId: command.userId,
        kind: command.kind,
        detail: clipForTrace(
          `apply refId resolved from ${parsed.refId} to ${command.refId}`,
          160
        )
      });
    }
    emitRelayTrace(app, machineRegistry, machineId, {
      direction: "wecom->relay",
      stage: "command_received",
      commandId: command.commandId,
      machineId: command.machineId,
      userId: command.userId,
      kind: command.kind,
      detail: clipForTrace(payload.text, 140)
    });
    commandTemplates.set(command.commandId, {
      command,
      createdAtMs: Date.now()
    });
    await auditStore.record({
      commandId: command.commandId,
      timestamp: command.createdAt,
      status: "created",
      userId: command.userId,
      machineId: command.machineId,
      kind: command.kind,
      summary: payload.text
    });

    const session = await machineRegistry.getState(machineId);
    const socket = machineRegistry.getSocket(machineId);
    if (!session || !socket || Date.now() - session.lastHeartbeatAt > heartbeatTimeoutMs) {
      await auditStore.record({
        commandId: command.commandId,
        timestamp: new Date().toISOString(),
        status: "machine_offline",
        userId: command.userId,
        machineId: command.machineId
      });
      emitRelayTrace(app, machineRegistry, machineId, {
        direction: "relay->agent",
        stage: "command_dispatch_failed",
        commandId: command.commandId,
        machineId: command.machineId,
        userId: command.userId,
        kind: command.kind,
        status: "machine_offline"
      });
      emitRelayTrace(app, machineRegistry, machineId, {
        direction: "relay->wecom",
        stage: "passive_ack_sent",
        commandId: command.commandId,
        machineId: command.machineId,
        userId: command.userId,
        kind: command.kind,
        status: "machine_offline"
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
        },
        resolveReplyTarget(payload)
      );
    }

    socket.send(JSON.stringify({ type: "command", command }));
    emitRelayTrace(app, machineRegistry, machineId, {
      direction: "relay->agent",
      stage: "command_dispatched",
      commandId: command.commandId,
      machineId: command.machineId,
      userId: command.userId,
      kind: command.kind,
      status: "sent_to_agent"
    });
    await stores.inflight.set({
      commandId: command.commandId,
      userId: payload.userId,
      machineId,
      createdAtMs: Date.now(),
      kind: command.kind
    }, inflightStoreTtlMs);
    await auditStore.record({
      commandId: command.commandId,
      timestamp: new Date().toISOString(),
      status: "sent_to_agent",
      userId: command.userId,
      machineId: command.machineId,
      kind: command.kind
    });
    emitRelayTrace(app, machineRegistry, machineId, {
      direction: "relay->wecom",
      stage: "passive_ack_sent",
      commandId: command.commandId,
      machineId: command.machineId,
      userId: command.userId,
      kind: command.kind,
      status: "sent_to_agent"
    });

    return sendWeComAck(
      reply,
      { isXml, encryptedRequest: Boolean(body.encrypt) },
      {
        status: "sent_to_agent",
        commandId: command.commandId,
        passiveMessage: buildCommandHandshakeMessage(command)
      },
      {
        token: wecomToken,
        encodingAesKey: wecomEncodingAesKey,
        receiveId: wecomCorpId
      },
      resolveReplyTarget(payload)
    );
  });

  return app;

  async function cleanupStaleInflight(): Promise<void> {
    const now = Date.now();
    const inflight = await stores.inflight.list();
    for (const owner of inflight) {
      const commandId = owner.commandId;
      if (now - owner.createdAtMs <= inflightTimeoutMs) {
        continue;
      }
      await stores.inflight.remove(commandId);
      await auditStore.record({
        commandId,
        timestamp: new Date().toISOString(),
        status: "inflight_timeout",
        userId: owner.userId,
        machineId: owner.machineId,
        kind: owner.kind
      });
      const timeoutSummary = `命令 ${commandId} 等待执行结果超时，已丢弃。`;
      emitRelayTrace(app, machineRegistry, owner.machineId, {
        direction: "relay->agent",
        stage: "command_timeout_discarded",
        commandId,
        machineId: owner.machineId,
        userId: owner.userId,
        kind: normalizeCommandKind(owner.kind),
        status: "inflight_timeout",
        detail: clipForTrace(timeoutSummary, 180)
      });
      void notifyCommandResult(
        app,
        owner.userId,
        timeoutSummary,
        "error",
        {
          commandId,
          machineId: owner.machineId,
          kind: normalizeCommandKind(owner.kind),
          trace: (trace) => emitRelayTrace(app, machineRegistry, owner.machineId, trace)
        }
      );
    }
  }

  async function resolveApplyRefId(
    requestedRefId: string
  ): Promise<{ resolvedRefId: string; sourceCommandId?: string }> {
    let currentRefId = requestedRefId.trim();
    let sourceCommandId: string | undefined;
    const visited = new Set<string>();

    for (let depth = 0; depth < 8; depth += 1) {
      if (!currentRefId || visited.has(currentRefId)) {
        break;
      }
      visited.add(currentRefId);

      const template = commandTemplates.get(currentRefId)?.command;
      if (template) {
        if (template.kind === "apply" && template.refId?.trim()) {
          sourceCommandId ??= currentRefId;
          currentRefId = template.refId.trim();
          continue;
        }
        break;
      }

      const record = await auditStore.get(currentRefId);
      if (!record || record.kind !== "apply") {
        break;
      }
      const createdSummary = record.events.find((event) => event.status === "created")?.summary;
      const nextRefId =
        extractApplyRefIdFromCommandText(createdSummary)
        ?? extractApplyRefIdFromCommandText(record.summary);
      if (!nextRefId || visited.has(nextRefId)) {
        break;
      }
      sourceCommandId ??= currentRefId;
      currentRefId = nextRefId;
    }

    return {
      resolvedRefId: currentRefId || requestedRefId.trim(),
      sourceCommandId
    };
  }

  function cleanupCommandTemplates(): void {
    const now = Date.now();
    const ttl = Number.isFinite(commandTemplateTtlMs) && commandTemplateTtlMs > 0
      ? commandTemplateTtlMs
      : 86400000;
    for (const [commandId, entry] of commandTemplates.entries()) {
      if (now - entry.createdAtMs > ttl) {
        commandTemplates.delete(commandId);
      }
    }

    const max = Number.isFinite(commandTemplateMax) && commandTemplateMax > 0
      ? commandTemplateMax
      : 5000;
    if (commandTemplates.size <= max) {
      return;
    }
    const overflow = commandTemplates.size - max;
    const oldest = [...commandTemplates.entries()]
      .sort((a, b) => a[1].createdAtMs - b[1].createdAtMs)
      .slice(0, overflow);
    for (const [commandId] of oldest) {
      commandTemplates.delete(commandId);
    }
  }
}

function parsePositiveMs(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
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

function extractApplyRefIdFromCommandText(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  const parsed = parseDevCommand(text);
  if (!parsed || parsed.kind !== "apply") {
    return undefined;
  }
  const refId = parsed.refId?.trim();
  return refId || undefined;
}

function normalizeWeComMessage(body?: WeComCallbackBody): NormalizedWeComMessage {
  if (!body) {
    return {};
  }
  const message = body.message ?? {};
  const replyToUserName = message.fromUserName ?? body.fromUserName;
  const replyFromUserName = message.toUserName ?? body.toUserName;
  return {
    msgId: message.msgId ?? body.msgId,
    userId: message.userId ?? body.userId ?? replyToUserName,
    machineId: message.machineId ?? body.machineId,
    text: message.text ?? body.text,
    replyToUserName,
    replyFromUserName
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
    fromUserName: parsed.fromUserName,
    toUserName: parsed.toUserName,
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
  },
  replyTarget?: {
    toUserName?: string;
    fromUserName?: string;
  }
) {
  if (mode.isXml && mode.encryptedRequest) {
    const passiveReplyXml = buildPassiveReplyXml(jsonPayload, replyTarget);
    if (crypto.token && crypto.encodingAesKey && crypto.receiveId) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = randomUUID().replace(/-/g, "").slice(0, 16);
      const plainText = passiveReplyXml ?? "success";
      const encrypted = encryptWeComMessage(plainText, crypto.encodingAesKey, crypto.receiveId);
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
    const passiveReplyXml = buildPassiveReplyXml(jsonPayload, replyTarget);
    if (passiveReplyXml) {
      return reply.status(200).type("application/xml").send(passiveReplyXml);
    }
    return reply.status(200).type("text/plain").send("success");
  }
  return reply.status(200).send(jsonPayload);
}

type NotifyCommandResultOptions = {
  commandId?: string;
  machineId?: string;
  kind?: CommandEnvelope["kind"];
  trace?: (event: Omit<RelayTraceEvent, "at">) => void;
};

async function notifyCommandResult(
  app: ReturnType<typeof Fastify>,
  userId: string,
  summary: string,
  status: ResultStatus,
  options: NotifyCommandResultOptions = {}
): Promise<void> {
  const wecomCorpId = normalizeRuntimeEnvValue(process.env.WECOM_CORP_ID);
  const wecomAgentSecret = normalizeRuntimeEnvValue(process.env.WECOM_AGENT_SECRET);
  const wecomAgentIdRaw = normalizeRuntimeEnvValue(process.env.WECOM_AGENT_ID);
  const wecomAgentId = wecomAgentIdRaw ? Number(wecomAgentIdRaw) : undefined;

  if (wecomCorpId && wecomAgentSecret && wecomAgentId) {
    try {
      await sendWeComTextMessage(
        {
          corpId: wecomCorpId,
          agentSecret: wecomAgentSecret,
          agentId: wecomAgentId
        },
        userId,
        formatWeComResultMessage(status, summary, options)
      );
      options.trace?.({
        direction: "relay->wecom",
        stage: "result_push_ok",
        commandId: options.commandId,
        machineId: options.machineId,
        userId,
        kind: options.kind,
        status,
        detail: clipForTrace(summary, 180)
      });
      return;
    } catch (error) {
      const errorMessage = describeError(error);
      app.log.error(
        {
          userId,
          errorMessage
        },
        "failed to push wecom api message"
      );
      options.trace?.({
        direction: "relay->wecom",
        stage: "result_push_failed",
        commandId: options.commandId,
        machineId: options.machineId,
        userId,
        kind: options.kind,
        status,
        detail: clipForTrace(errorMessage, 180)
      });
    }
  }

  const webhookUrl = process.env.RESULT_WEBHOOK_URL;
  if (!webhookUrl) {
    app.log.info({ userId, status, summary }, "result ready for chat push");
    options.trace?.({
      direction: "relay->wecom",
      stage: "result_ready_no_push",
      commandId: options.commandId,
      machineId: options.machineId,
      userId,
      kind: options.kind,
      status
    });
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
    options.trace?.({
      direction: "relay->wecom",
      stage: "result_webhook_ok",
      commandId: options.commandId,
      machineId: options.machineId,
      userId,
      kind: options.kind,
      status
    });
  } catch (error) {
    const errorMessage = describeError(error);
    app.log.error({ userId, errorMessage }, "failed to push result webhook");
    options.trace?.({
      direction: "relay->wecom",
      stage: "result_webhook_failed",
      commandId: options.commandId,
      machineId: options.machineId,
      userId,
      kind: options.kind,
      status,
      detail: clipForTrace(errorMessage, 180)
    });
  }
}

function resolveReplyTarget(payload: NormalizedWeComMessage): {
  toUserName?: string;
  fromUserName?: string;
} {
  return {
    toUserName: payload.replyToUserName,
    fromUserName: payload.replyFromUserName
  };
}

function shouldSendPassiveReply(): boolean {
  const raw = process.env.WECOM_PASSIVE_REPLY?.trim().toLowerCase();
  if (!raw) {
    return true;
  }
  return !["0", "false", "no", "off"].includes(raw);
}

function buildPassiveReplyXml(
  jsonPayload: Record<string, unknown>,
  replyTarget?: {
    toUserName?: string;
    fromUserName?: string;
  }
): string | undefined {
  if (!shouldSendPassiveReply()) {
    return undefined;
  }
  if (shouldSuppressPassiveReplyContent(jsonPayload)) {
    return undefined;
  }
  const toUserName = replyTarget?.toUserName?.trim();
  const fromUserName = replyTarget?.fromUserName?.trim();
  if (!toUserName || !fromUserName) {
    return undefined;
  }
  const content = buildPassiveReplyContent(jsonPayload);
  return buildWeComTextReplyXml({
    toUserName,
    fromUserName,
    content
  });
}

function buildPassiveReplyContent(jsonPayload: Record<string, unknown>): string {
  const passiveMessage =
    typeof jsonPayload.passiveMessage === "string" ? jsonPayload.passiveMessage.trim() : "";
  if (passiveMessage) {
    return passiveMessage;
  }
  const status = typeof jsonPayload.status === "string" ? jsonPayload.status : "ok";
  if (status === "sent_to_agent") {
    return "已收到命令，正在处理。";
  }
  if (status === "machine_offline") {
    return "命令未执行：目标机器不在线。";
  }
  if (status === "duplicate_ignored") {
    return "重复消息已忽略。";
  }
  if (status === "ignored_non_dev_message") {
    return "已收到消息。";
  }
  return "已收到请求。";
}

function shouldSuppressPassiveReplyContent(jsonPayload: Record<string, unknown>): boolean {
  const passiveMessage =
    typeof jsonPayload.passiveMessage === "string" ? jsonPayload.passiveMessage.trim() : "";
  if (passiveMessage) {
    return false;
  }
  const status = typeof jsonPayload.status === "string" ? jsonPayload.status : "";
  return status === "sent_to_agent";
}

function buildCommandHandshakeMessage(command: CommandEnvelope): string {
  const lines = ["已收到命令并开始处理。"];
  if (command.kind === "apply") {
    if (command.prompt?.trim()) {
      lines.push(`微信命令：${command.prompt.trim()}`);
    }
    return lines.join("\n");
  }
  return lines.join("\n");
}

function emitRelayTrace(
  app: ReturnType<typeof Fastify>,
  machineRegistry: MachineRegistry,
  machineId: string | undefined,
  event: Omit<RelayTraceEvent, "at">
): void {
  const resolvedMachineId = machineId ?? event.machineId;
  if (!resolvedMachineId) {
    return;
  }
  const socket = machineRegistry.getSocket(resolvedMachineId);
  if (!socket || socket.readyState !== 1) {
    return;
  }
  const payload = {
    type: "relay.trace",
    trace: {
      ...event,
      at: new Date().toISOString(),
      machineId: event.machineId ?? resolvedMachineId
    }
  };
  try {
    socket.send(JSON.stringify(payload));
  } catch (error) {
    app.log.debug({ error: describeError(error), machineId: resolvedMachineId }, "relay trace send failed");
  }
}

function clipForTrace(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, Math.max(0, maxLength - 3))}...`;
}

function normalizeCommandKind(value: string | undefined): CommandKind | undefined {
  if (value === "help" || value === "status" || value === "plan" || value === "patch" || value === "apply" || value === "test") {
    return value;
  }
  return undefined;
}

function normalizeRuntimeEnvValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "__SET_IN_USER_ENV__") {
    return undefined;
  }
  return trimmed;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function formatWeComResultMessage(
  status: ResultStatus,
  summary: string,
  options: NotifyCommandResultOptions
): string {
  const lines = [`执行结果：${localizeResultStatus(status)}`];
  lines.push(`摘要：${localizeResultSummary(summary, options)}`);
  const patchId = extractPatchIdForDisplay(summary, options);
  if (patchId) {
    lines.push(`补丁ID：${patchId}`);
  }
  return lines.join("\n");
}

function localizeResultStatus(status: ResultStatus): string {
  if (status === "ok") {
    return "成功";
  }
  if (status === "error") {
    return "失败";
  }
  if (status === "rejected") {
    return "已拒绝";
  }
  return "已取消";
}

function localizeResultSummary(
  summary: string,
  options: NotifyCommandResultOptions
): string {
  const trimmed = summary.trim();
  if (
    trimmed === "patch generated by codex"
    || trimmed === "patch generated by codex exec fallback"
    || trimmed === "patch generated by codex exec direct fallback"
  ) {
    return "补丁已生成。发送“应用补丁 <补丁ID>”即可执行。";
  }
  if (trimmed === "patch generated by local fast append") {
    return "补丁已快速生成。发送“应用补丁 <补丁ID>”即可执行。";
  }
  if (trimmed.startsWith("codex patch generation failed:")) {
    return `生成补丁失败：${trimmed.slice("codex patch generation failed:".length).trim()}`;
  }
  if (trimmed.startsWith("apply completed:")) {
    return `补丁已应用：${trimmed.slice("apply completed:".length).trim()}`;
  }
  if (trimmed.startsWith("context mismatch for ")) {
    const file = trimmed.slice("context mismatch for ".length).trim();
    return `应用补丁失败：文件上下文不匹配（${file}）。请重新生成补丁后再应用。`;
  }
  if (trimmed.startsWith("delete mismatch for ")) {
    const file = trimmed.slice("delete mismatch for ".length).trim();
    return `应用补丁失败：删除片段不匹配（${file}）。请重新生成补丁后再应用。`;
  }
  if (trimmed === "apply rejected by local user") {
    return "本地已拒绝应用补丁。";
  }
  if (trimmed.startsWith("no cached patch found for refId=")) {
    return `未找到可应用补丁：${trimmed.slice("no cached patch found for refId=".length).trim()}。请使用“补丁ID”执行应用补丁。`;
  }
  if (trimmed.endsWith("timed out while waiting for agent result")) {
    const matched = trimmed.match(/^command\s+(\S+)\s+timed out while waiting for agent result$/i);
    if (matched?.[1]) {
      return `命令 ${matched[1]} 等待执行结果超时，已丢弃。`;
    }
    return "命令等待执行结果超时，已丢弃。";
  }
  if (trimmed === "unknown command") {
    return "未知命令。";
  }
  return trimmed;
}

function extractPatchIdForDisplay(
  summary: string,
  options: NotifyCommandResultOptions
): string | undefined {
  const trimmed = summary.trim();
  if (
    trimmed === "patch generated by codex"
    || trimmed === "patch generated by codex exec fallback"
    || trimmed === "patch generated by codex exec direct fallback"
    || trimmed === "patch generated by local fast append"
  ) {
    return options.commandId;
  }
  return undefined;
}
