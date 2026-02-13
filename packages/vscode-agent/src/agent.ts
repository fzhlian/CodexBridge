import WebSocket from "ws";
import { handleCommand } from "./handlers.js";
import type {
  CommandEnvelope,
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
  contextProvider?: () => Promise<RuntimeContextSnapshot | undefined> | RuntimeContextSnapshot | undefined;
  confirmationProvider?: (
    command: CommandEnvelope,
    question: string
  ) => Promise<boolean> | boolean;
};

export class RelayAgent {
  private socket?: WebSocket;
  private heartbeatTimer?: NodeJS.Timeout;
  private stopping = false;
  private readonly running = new Map<string, AbortController>();
  private readonly pending: CommandEnvelope[] = [];
  private readonly maxConcurrency: number;
  private readonly commandTimeoutMs: number;

  constructor(private readonly options: AgentOptions) {
    const parsedConcurrency = Number(process.env.AGENT_MAX_CONCURRENCY ?? "1");
    const parsedTimeout = Number(process.env.AGENT_COMMAND_TIMEOUT_MS ?? "600000");
    this.maxConcurrency =
      Number.isFinite(parsedConcurrency) && parsedConcurrency > 0
        ? Math.floor(parsedConcurrency)
        : 1;
    this.commandTimeoutMs =
      Number.isFinite(parsedTimeout) && parsedTimeout > 0
        ? Math.floor(parsedTimeout)
        : 600000;
  }

  start(): void {
    this.stopping = false;
    this.connect();
  }

  stop(): void {
    this.stopping = true;
    this.pending.splice(0, this.pending.length);
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
            sentAt: new Date().toISOString()
          })
        );
      }, heartbeatMs);
    });

    socket.on("message", (raw) => {
      void this.onMessage(raw.toString("utf8"));
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
      if (payload.type === "command.cancel") {
        const pendingIdx = this.pending.findIndex(
          (item) => item.commandId === payload.commandId
        );
        if (pendingIdx >= 0) {
          const [cancelled] = this.pending.splice(pendingIdx, 1);
          this.emitResult({
            commandId: cancelled.commandId,
            machineId: cancelled.machineId,
            status: "cancelled",
            summary: "command cancelled while pending in queue",
            createdAt: new Date().toISOString()
          });
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
      this.pending.push(payload.command);
      this.processQueue();
    } catch (error) {
      console.error("[vscode-agent] invalid payload", error);
    }
  }

  private processQueue(): void {
    if (this.stopping) {
      return;
    }
    while (this.running.size < this.maxConcurrency && this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) {
        return;
      }
      void this.executeCommand(next);
    }
  }

  private async executeCommand(command: CommandEnvelope): Promise<void> {
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
    this.emitResult(result);
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

  private emitResult(result: ResultEnvelope): void {
    this.socket?.send(JSON.stringify({ type: "agent.result", result }));
  }
}
