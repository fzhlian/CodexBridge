import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { JsonlDecoder } from "./jsonl.js";
import { CODEX_METHODS, type CodexMethod } from "./methods.js";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  dispose?: () => void;
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
  private initialized = false;
  private initPromise?: Promise<void>;

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
    this.initialized = false;
    this.initPromise = undefined;

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
      this.initialized = false;
      this.initPromise = undefined;
      for (const [id, req] of this.pending.entries()) {
        clearTimeout(req.timer);
        req.dispose?.();
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
    params: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<unknown> {
    if (!this.process) {
      await this.start();
    }
    if (!this.process) {
      throw new Error("codex process is not available");
    }
    if (!this.initialized && method !== CODEX_METHODS.INITIALIZE) {
      await this.ensureInitialized();
    }
    return this.requestRaw(method, params, options);
  }

  private async requestRaw(
    method: CodexMethod | string,
    params: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<unknown> {
    const process = this.process;
    if (!process) {
      throw new Error("codex process is not available");
    }
    const id = randomUUID();
    const request: RpcRequest = { id, method, params };
    const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs ?? 20_000;

    const responsePromise = new Promise<unknown>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new Error(`codex request aborted: ${id}`));
        return;
      }
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        this.pending.delete(id);
        pending?.dispose?.();
        reject(new Error(`codex request timeout: ${id}`));
      }, timeoutMs);
      const onAbort = () => {
        const pending = this.pending.get(id);
        this.pending.delete(id);
        clearTimeout(timer);
        pending?.dispose?.();
        reject(new Error(`codex request aborted: ${id}`));
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        dispose: () => options.signal?.removeEventListener("abort", onAbort)
      });
    });

    process.stdin.write(`${JSON.stringify(request)}\n`);
    return responsePromise;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (!this.process) {
      await this.start();
    }
    if (!this.process) {
      throw new Error("codex process is not available");
    }
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await this.requestRaw(CODEX_METHODS.INITIALIZE, {
          clientInfo: {
            name: "codexbridge",
            version: "0.1.0"
          }
        });
        this.initialized = true;
      })().finally(() => {
        this.initPromise = undefined;
      });
    }
    await this.initPromise;
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
    pending.dispose?.();

    if (parsed.error) {
      pending.reject(new Error(parsed.error.message ?? "codex rpc error"));
      return;
    }
    pending.resolve(parsed.result);
  }
}
