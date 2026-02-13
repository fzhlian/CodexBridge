import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { JsonlDecoder } from "./jsonl.js";
import type { CodexMethod } from "./methods.js";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type CodexClientOptions = {
  command?: string;
  args?: string[];
  requestTimeoutMs?: number;
  restartOnExit?: boolean;
};

type RpcRequest = {
  id: string;
  method: CodexMethod | string;
  params: Record<string, unknown>;
};

type RpcResponse = {
  id: string;
  result?: unknown;
  error?: { message?: string };
};

export class CodexAppServerClient {
  private process?: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly decoder = new JsonlDecoder();
  private starting = false;

  constructor(private readonly options: CodexClientOptions = {}) {}

  async start(): Promise<void> {
    if (this.process || this.starting) {
      return;
    }
    this.starting = true;

    const command = this.options.command ?? "codex";
    const args = this.options.args ?? ["app-server"];
    const child = spawn(command, args, { stdio: "pipe" });
    this.process = child;

    child.stdout.on("data", (chunk: Buffer) => {
      this.decoder.push(chunk.toString("utf8"), (line) => {
        this.handleLine(line);
      });
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message) {
        console.error("[codex-client]", message);
      }
    });

    child.on("exit", () => {
      this.process = undefined;
      for (const [id, req] of this.pending.entries()) {
        clearTimeout(req.timer);
        req.reject(new Error(`codex process exited before response: ${id}`));
      }
      this.pending.clear();

      if (this.options.restartOnExit !== false) {
        void this.start();
      }
    });

    this.starting = false;
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }
    this.process.kill();
    this.process = undefined;
  }

  async request(
    method: CodexMethod | string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.process) {
      await this.start();
    }
    if (!this.process) {
      throw new Error("codex process is not available");
    }

    const id = randomUUID();
    const request: RpcRequest = { id, method, params };
    const timeoutMs = this.options.requestTimeoutMs ?? 20_000;

    const responsePromise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`codex request timeout: ${id}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });

    this.process.stdin.write(`${JSON.stringify(request)}\n`);
    return responsePromise;
  }

  private handleLine(line: string): void {
    let parsed: RpcResponse;
    try {
      parsed = JSON.parse(line) as RpcResponse;
    } catch {
      return;
    }

    const pending = this.pending.get(parsed.id);
    if (!pending) {
      return;
    }
    this.pending.delete(parsed.id);
    clearTimeout(pending.timer);

    if (parsed.error) {
      pending.reject(new Error(parsed.error.message ?? "codex rpc error"));
      return;
    }
    pending.resolve(parsed.result);
  }
}

