import {
  CODEX_METHODS,
  CodexAppServerClient,
  type CodexClientOptions
} from "@codexbridge/codex-client";

export type StreamCallbacks = {
  onStart?: () => void;
  onChunk?: (chunk: string) => void;
  onEnd?: () => void;
};

export class CodexClientFacade {
  private client?: CodexAppServerClient;

  async completeWithStreaming(
    prompt: string,
    renderedContext: string,
    callbacks: StreamCallbacks = {},
    signal?: AbortSignal
  ): Promise<string> {
    callbacks.onStart?.();
    const response = await this.getClient().request(
      CODEX_METHODS.COMPLETE,
      {
        prompt,
        context: renderedContext
      },
      {
        signal,
        timeoutMs: Number(process.env.CODEX_REQUEST_TIMEOUT_MS ?? "240000")
      }
    );
    const text = extractAssistantText(response);
    await emitChunked(text, callbacks, signal);
    callbacks.onEnd?.();
    return text;
  }

  private getClient(): CodexAppServerClient {
    if (!this.client) {
      this.client = new CodexAppServerClient(getClientOptions());
    }
    return this.client;
  }
}

function getClientOptions(): CodexClientOptions {
  return {
    command: process.env.CODEX_COMMAND?.trim() || "codex",
    args: process.env.CODEX_ARGS
      ? process.env.CODEX_ARGS.split(",").map((item) => item.trim()).filter(Boolean)
      : ["app-server"],
    requestTimeoutMs: Number(process.env.CODEX_REQUEST_TIMEOUT_MS ?? "240000"),
    restartOnExit: true
  };
}

function extractAssistantText(response: unknown): string {
  if (typeof response === "string") {
    return response.trim();
  }
  if (response && typeof response === "object") {
    const value = response as Record<string, unknown>;
    const direct = pickString(value, ["text", "output_text", "content", "summary", "message"]);
    if (direct) {
      return direct;
    }
  }
  return JSON.stringify(response ?? "");
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

async function emitChunked(
  text: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const chunkSize = 80;
  for (let i = 0; i < text.length; i += chunkSize) {
    if (signal?.aborted) {
      break;
    }
    callbacks.onChunk?.(text.slice(i, i + chunkSize));
    await wait(8);
  }
  if (text.length === 0) {
    callbacks.onChunk?.("");
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
