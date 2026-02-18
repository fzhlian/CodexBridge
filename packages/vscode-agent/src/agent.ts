import WebSocket from "ws";
import { handleCommand } from "./handlers.js";
import type {
  CommandEnvelope,
  RelayTraceEvent,
  RelayToAgentEnvelope,
  ResultEnvelope
} from "@codexbridge/shared";
import type { RuntimeContextSnapshot } from "./context.js";

export type AgentOptions = {
  relayUrl: string;
  machineId: string;
  version?: string;
  reconnectMs?: number;
  heartbeatMs?: number;
  pendingTimeoutMs?: number;
  eventLogger?: (event: string) => void;
  contextProvider?: () => Promise<RuntimeContextSnapshot | undefined> | RuntimeContextSnapshot | undefined;
  confirmationProvider?: (
    command: CommandEnvelope,
    question: string
  ) => Promise<boolean> | boolean;
  onCommandReceived?: (command: CommandEnvelope) => void;
  onCommandResult?: (command: CommandEnvelope, result: ResultEnvelope) => void;
};

export class RelayAgent {
  private socket?: WebSocket;
  private heartbeatTimer?: NodeJS.Timeout;
  private pendingSweepTimer?: NodeJS.Timeout;
  private stopping = false;
  private readonly running = new Map<string, AbortController>();
  private readonly pending: Array<{ command: CommandEnvelope; enqueuedAtMs: number }> = [];
  private readonly knownCommands = new Map<string, CommandEnvelope>();
  private readonly maxConcurrency: number;
  private readonly commandTimeoutMs: number;
  private readonly pendingTimeoutMs: number;

  constructor(private readonly options: AgentOptions) {
    const parsedConcurrency = Number(process.env.AGENT_MAX_CONCURRENCY ?? "1");
    const parsedTimeout = Number(process.env.AGENT_COMMAND_TIMEOUT_MS ?? "600000");
    const parsedPendingTimeout = Number(
      options.pendingTimeoutMs
      ?? process.env.AGENT_PENDING_TIMEOUT_MS
      ?? "300000"
    );
    this.maxConcurrency =
      Number.isFinite(parsedConcurrency) && parsedConcurrency > 0
        ? Math.floor(parsedConcurrency)
        : 1;
    this.commandTimeoutMs =
      Number.isFinite(parsedTimeout) && parsedTimeout > 0
        ? Math.floor(parsedTimeout)
        : 600000;
    this.pendingTimeoutMs =
      Number.isFinite(parsedPendingTimeout) && parsedPendingTimeout > 0
        ? Math.floor(parsedPendingTimeout)
        : 300000;
  }

  start(): void {
    this.stopping = false;
    this.logEvent(
      `代理启动 machineId=${this.options.machineId} relayUrl=${this.options.relayUrl} 排队超时=${this.pendingTimeoutMs}ms`
    );
    this.startPendingSweep();
    this.connect();
  }

  stop(): void {
    this.stopping = true;
    if (this.pendingSweepTimer) {
      clearInterval(this.pendingSweepTimer);
      this.pendingSweepTimer = undefined;
    }
    this.pending.splice(0, this.pending.length);
    this.knownCommands.clear();
    for (const controller of this.running.values()) {
      controller.abort();
    }
    this.running.clear();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.socket?.close();
    this.socket = undefined;
    this.logEvent("代理已停止");
  }

  private connect(): void {
    const socket = new WebSocket(this.options.relayUrl);
    this.socket = socket;

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "agent.hello",
          machineId: this.options.machineId,
          version: this.options.version ?? "0.1.0",
          capabilities: ["help", "status", "plan", "patch", "apply", "test"]
        })
      );

      const heartbeatMs = this.options.heartbeatMs ?? 10_000;
      this.heartbeatTimer = setInterval(() => {
        socket.send(
          JSON.stringify({
            type: "agent.heartbeat",
            machineId: this.options.machineId,
            sentAt: new Date().toISOString(),
            runningCount: this.running.size,
            pendingCount: this.pending.length
          })
        );
      }, heartbeatMs);
    });

    socket.on("message", (raw) => {
      void this.onMessage(raw.toString("utf8"));
    });

    socket.on("error", (error) => {
      if (!isRoutineRelayConnectError(error)) {
        this.logEvent(`中继 WebSocket 错误: ${toSingleLine(error)}`);
      }
      console.error("[vscode-agent] websocket error", error);
    });

    socket.on("close", () => {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
      }
      if (this.stopping) {
        return;
      }
      const reconnectMs = this.options.reconnectMs ?? 3000;
      setTimeout(() => this.connect(), reconnectMs);
    });
  }

  private async onMessage(raw: string): Promise<void> {
    try {
      const payload = JSON.parse(raw) as RelayToAgentEnvelope;
      if (payload.type === "relay.trace") {
        if (payload.trace.stage !== "agent_connected") {
          this.logEvent(formatRelayTrace(payload.trace));
        }
        return;
      }

      if (payload.type === "command.cancel") {
        this.logEvent(`收到取消命令 commandId=${payload.commandId}`);
        const pendingIdx = this.pending.findIndex(
          (item) => item.command.commandId === payload.commandId
        );
        if (pendingIdx >= 0) {
          const [cancelled] = this.pending.splice(pendingIdx, 1);
          const result: ResultEnvelope = {
            commandId: cancelled.command.commandId,
            machineId: cancelled.command.machineId,
            status: "cancelled",
            summary: "命令在排队中被取消",
            createdAt: new Date().toISOString()
          };
          this.emitResult(result, cancelled.command);
          this.knownCommands.delete(cancelled.command.commandId);
          return;
        }
        const running = this.running.get(payload.commandId);
        if (running) {
          running.abort();
        }
        return;
      }

      if (payload.type !== "command" || !payload.command) {
        return;
      }
      this.logEvent(
        `收到命令 commandId=${payload.command.commandId} kind=${payload.command.kind} ` +
        `userId=${payload.command.userId} ${summarizeCommandPayload(payload.command)}`
      );
      this.knownCommands.set(payload.command.commandId, payload.command);
      this.pending.push({
        command: payload.command,
        enqueuedAtMs: Date.now()
      });
      this.options.onCommandReceived?.(payload.command);
      this.dropExpiredPending();
      this.processQueue();
    } catch (error) {
      this.logEvent(`中继消息解析失败: ${toSingleLine(error)}`);
      console.error("[vscode-agent] invalid payload", error);
    }
  }

  private processQueue(): void {
    if (this.stopping) {
      return;
    }
    this.dropExpiredPending();
    while (this.running.size < this.maxConcurrency && this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next?.command) {
        return;
      }
      void this.executeCommand(next.command);
    }
  }

  private async executeCommand(command: CommandEnvelope): Promise<void> {
    this.logEvent(
      `开始执行 commandId=${command.commandId} kind=${command.kind} 排队数=${this.pending.length}`
    );
    if (command.kind === "patch") {
      this.logEvent(`agent->codex 请求 commandId=${command.commandId} action=generate_patch`);
    }
    const controller = new AbortController();
    this.running.set(command.commandId, controller);
    const timeout = setTimeout(() => controller.abort(), this.commandTimeoutMs);
    let result: ResultEnvelope;
    try {
      const runtimeContext = await this.readRuntimeContext();
      result = await handleCommand(command, {
        signal: controller.signal,
        runtimeContext,
        confirm: this.options.confirmationProvider
          ? (question: string) => this.confirm(command, question)
          : undefined
      });
    } catch (error) {
      const summary = error instanceof Error ? error.message : "command execution failure";
      result = {
        commandId: command.commandId,
        machineId: command.machineId,
        status: controller.signal.aborted ? "cancelled" : "error",
        summary,
        createdAt: new Date().toISOString()
      };
    } finally {
      clearTimeout(timeout);
      this.running.delete(command.commandId);
      this.processQueue();
    }
    if (command.kind === "patch") {
      this.logEvent(
        `codex->agent 响应 commandId=${command.commandId} status=${result.status}`
      );
    }
    this.logEvent(
      `命令完成 commandId=${command.commandId} status=${result.status} ` +
      `summary=${clipOneLine(result.summary, 140)}`
    );
    this.emitResult(result, command);
    this.knownCommands.delete(command.commandId);
  }

  private async readRuntimeContext(): Promise<RuntimeContextSnapshot | undefined> {
    if (!this.options.contextProvider) {
      return undefined;
    }
    try {
      return await this.options.contextProvider();
    } catch (error) {
      console.error("[vscode-agent] contextProvider failed", error);
      return undefined;
    }
  }

  private async confirm(command: CommandEnvelope, question: string): Promise<boolean> {
    if (!this.options.confirmationProvider) {
      return false;
    }
    try {
      return await this.options.confirmationProvider(command, question);
    } catch (error) {
      console.error("[vscode-agent] confirmationProvider failed", error);
      return false;
    }
  }

  private emitResult(result: ResultEnvelope, command?: CommandEnvelope): void {
    const resolvedCommand = command ?? this.knownCommands.get(result.commandId);
    if (resolvedCommand) {
      this.options.onCommandResult?.(resolvedCommand, result);
    }
    this.logEvent(
      `结果已发送到中继(用于企业微信回推) commandId=${result.commandId} status=${result.status} ` +
      `summary=${clipOneLine(result.summary, 140)}`
    );
    this.socket?.send(JSON.stringify({ type: "agent.result", result }));
  }

  private logEvent(event: string): void {
    this.options.eventLogger?.(event);
  }

  private startPendingSweep(): void {
    if (this.pendingSweepTimer) {
      clearInterval(this.pendingSweepTimer);
    }
    const intervalMs = Math.max(1000, Math.min(this.pendingTimeoutMs, 5000));
    this.pendingSweepTimer = setInterval(() => {
      this.dropExpiredPending();
    }, intervalMs);
  }

  private dropExpiredPending(): void {
    if (this.pending.length === 0) {
      return;
    }
    const now = Date.now();
    const kept: Array<{ command: CommandEnvelope; enqueuedAtMs: number }> = [];
    for (const item of this.pending) {
      const waitedMs = now - item.enqueuedAtMs;
      if (waitedMs <= this.pendingTimeoutMs) {
        kept.push(item);
        continue;
      }
      this.logEvent(
        `排队超时已丢弃 commandId=${item.command.commandId} waitedMs=${waitedMs} thresholdMs=${this.pendingTimeoutMs}`
      );
      const result: ResultEnvelope = {
        commandId: item.command.commandId,
        machineId: item.command.machineId,
        status: "cancelled",
        summary: `命令排队等待超过 ${this.pendingTimeoutMs}ms，已自动丢弃`,
        createdAt: new Date().toISOString()
      };
      this.emitResult(result, item.command);
      this.knownCommands.delete(item.command.commandId);
    }
    if (kept.length !== this.pending.length) {
      this.pending.splice(0, this.pending.length, ...kept);
    }
  }
}

function summarizeCommandPayload(command: CommandEnvelope): string {
  if (command.prompt?.trim()) {
    return `prompt="${clipOneLine(command.prompt, 120)}"`;
  }
  if (command.refId?.trim()) {
    return `refId=${command.refId.trim()}`;
  }
  return "payload=none";
}

function clipOneLine(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, Math.max(0, maxLength - 3))}...`;
}

function toSingleLine(input: unknown): string {
  if (input instanceof Error) {
    return clipOneLine(input.message, 160);
  }
  return clipOneLine(String(input), 160);
}

function isRoutineRelayConnectError(error: unknown): boolean {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    if (typeof code === "string" && code.toUpperCase() === "ECONNREFUSED") {
      return true;
    }
  }
  return toSingleLine(error).toUpperCase().includes("ECONNREFUSED");
}

function formatRelayTrace(trace: RelayTraceEvent): string {
  const direction = formatDirection(trace.direction);
  const stage = formatStage(trace.stage);
  const parts = [
    "链路追踪",
    `at=${trace.at}`,
    `direction=${direction}`,
    `stage=${trace.stage}`,
    `阶段=${stage}`
  ];
  if (trace.commandId) {
    parts.push(`commandId=${trace.commandId}`);
  }
  if (trace.machineId) {
    parts.push(`machineId=${trace.machineId}`);
  }
  if (trace.userId) {
    parts.push(`userId=${trace.userId}`);
  }
  if (trace.kind) {
    parts.push(`kind=${trace.kind}`);
  }
  if (trace.status) {
    parts.push(`status=${trace.status}`);
  }
  if (trace.detail) {
    parts.push(`detail="${clipOneLine(trace.detail, 140)}"`);
  }
  return parts.join(" ");
}

function formatDirection(direction: RelayTraceEvent["direction"]): string {
  if (direction === "wecom->relay") {
    return "企业微信->中继";
  }
  if (direction === "relay->agent") {
    return "中继->代理";
  }
  if (direction === "agent->relay") {
    return "代理->中继";
  }
  return "中继->企业微信";
}

function formatStage(stage: string): string {
  const mapping: Record<string, string> = {
    agent_connected: "代理已连接",
    duplicate_ignored: "重复消息已忽略",
    non_dev_message_ignored: "非命令消息已忽略",
    apply_ref_resolved: "apply 补丁ID已自动纠偏",
    command_received: "收到企业微信命令",
    command_dispatched: "命令已派发到代理",
    command_dispatch_failed: "命令派发失败",
    command_timeout_discarded: "命令等待执行结果超时，已丢弃",
    result_received: "收到代理执行结果",
    passive_ack_sent: "企业微信被动应答已发送",
    result_push_ok: "企业微信主动推送成功",
    result_push_failed: "企业微信主动推送失败",
    result_ready_no_push: "结果已就绪(未配置主动推送)",
    result_webhook_ok: "结果 Webhook 推送成功",
    result_webhook_failed: "结果 Webhook 推送失败"
  };
  return mapping[stage] ?? stage;
}
