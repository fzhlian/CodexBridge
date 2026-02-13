import type { FastifyReply, FastifyServerOptions } from "fastify";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import {
  MemoryIdempotencyStore,
  parseDevCommand,
  type CommandEnvelope,
  type RelayEnvelope
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
  const commandOwners = new Map<string, { userId: string; machineId: string }>();
  const auditStore = new AuditStore(
    process.env.AUDIT_LOG_PATH ?? "audit/relay-command-events.jsonl"
  );

  const wss = new WebSocketServer({ noServer: true });
  const wecomToken = process.env.WECOM_TOKEN;
  const wecomEncodingAesKey = process.env.WECOM_ENCODING_AES_KEY;
  const wecomCorpId = process.env.WECOM_CORP_ID;

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

  app.get("/commands/:commandId", async (request, reply) => {
    const params = request.params as { commandId: string };
    const record = auditStore.get(params.commandId);
    if (!record) {
      return reply.status(404).send({ error: "command_not_found" });
    }
    return reply.status(200).send(record);
  });

  app.get("/audit/recent", async (request, reply) => {
    const query = request.query as { limit?: string };
    const parsedLimit = Number(query.limit ?? "50");
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;
    return reply.status(200).send({
      items: auditStore.listRecent(limit)
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
    await auditStore.record({
      commandId: command.commandId,
      timestamp: command.createdAt,
      status: "created",
      userId: command.userId,
      machineId: command.machineId,
      kind: command.kind,
      summary: payload.text
    });

    if (!machineRegistry.isOnline(machineId)) {
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

    const session = machineRegistry.get(machineId);
    session?.socket.send(JSON.stringify({ type: "command", command }));
    commandOwners.set(command.commandId, { userId: payload.userId, machineId });
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
  status: "ok" | "error" | "rejected"
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
