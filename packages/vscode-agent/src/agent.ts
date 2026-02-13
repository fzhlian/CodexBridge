import WebSocket from "ws";
import { handleCommand } from "./handlers.js";
import type { CommandEnvelope } from "@codexbridge/shared";

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

  constructor(private readonly options: AgentOptions) {}

  start(): void {
    this.stopping = false;
    this.connect();
  }

  stop(): void {
    this.stopping = true;
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
      const payload = JSON.parse(raw) as { type: string; command?: CommandEnvelope };
      if (payload.type !== "command" || !payload.command) {
        return;
      }
      const result = await handleCommand(payload.command);
      this.socket?.send(JSON.stringify({ type: "agent.result", result }));
    } catch (error) {
      console.error("[vscode-agent] invalid payload", error);
    }
  }
}
