import WebSocket from "ws";
import { handleCommand } from "./handlers.js";
import type {
  CommandEnvelope,
  RelayToAgentEnvelope,
  ResultEnvelope
} from "@codexbridge/shared";

export type AgentOptions = {
  relayUrl: string;
  machineId: string;
  version?: string;
  reconnectMs?: number;
  heartbeatMs?: number;
};

export class RelayAgent {
  private socket?: WebSocket;
  private heartbeatTimer?: NodeJS.Timeout;
  private stopping = false;
  private readonly running = new Map<string, AbortController>();

  constructor(private readonly options: AgentOptions) {}

  start(): void {
    this.stopping = false;
    this.connect();
  }

  stop(): void {
    this.stopping = true;
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
        const running = this.running.get(payload.commandId);
        if (running) {
          running.abort();
          this.running.delete(payload.commandId);
        }
        return;
      }

      if (payload.type !== "command" || !payload.command) {
        return;
      }
      await this.executeCommand(payload.command);
    } catch (error) {
      console.error("[vscode-agent] invalid payload", error);
    }
  }

  private async executeCommand(command: CommandEnvelope): Promise<void> {
    const controller = new AbortController();
    this.running.set(command.commandId, controller);
    let result: ResultEnvelope;
    try {
      result = await handleCommand(command, { signal: controller.signal });
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
      this.running.delete(command.commandId);
    }
    this.socket?.send(JSON.stringify({ type: "agent.result", result }));
  }
}
