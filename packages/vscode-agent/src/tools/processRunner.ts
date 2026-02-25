import { spawn } from "node:child_process";

type SpawnRunOptions = {
  cwd: string;
  timeoutMs: number;
  maxTailLines: number;
  signal?: AbortSignal;
  shell?: boolean;
};

export type SpawnRunResult = {
  code: number | null;
  cancelled: boolean;
  timedOut: boolean;
  outputTail: string;
};

export async function runSpawnProcess(
  command: string,
  args: string[],
  options: SpawnRunOptions
): Promise<SpawnRunResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell ?? false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let timedOut = false;
    let cancelled = false;
    let tail = "";
    const append = (chunk: Buffer): void => {
      tail += chunk.toString("utf8");
      const lines = tail.split(/\r?\n/);
      if (lines.length > options.maxTailLines + 1) {
        tail = lines.slice(-options.maxTailLines).join("\n");
      }
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    const onAbort = (): void => {
      cancelled = true;
      child.kill();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      options.signal?.removeEventListener("abort", onAbort);
      const text = error instanceof Error ? error.message : String(error);
      resolve({
        code: null,
        cancelled,
        timedOut,
        outputTail: mergeTail(tail, text)
      });
    });
    child.on("close", (code) => {
      clearTimeout(timeoutHandle);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        code,
        cancelled,
        timedOut,
        outputTail: tail.trim()
      });
    });
  });
}

export async function resolveExecutablePath(binary: string): Promise<string | undefined> {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = await runSpawnProcess(probe, [binary], {
    cwd: process.cwd(),
    timeoutMs: 4_000,
    maxTailLines: 20,
    shell: false
  });
  if (result.code !== 0) {
    return undefined;
  }
  const first = result.outputTail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first || undefined;
}

function mergeTail(existing: string, appended: string): string {
  const merged = [existing.trim(), appended.trim()].filter(Boolean).join("\n");
  return merged.trim();
}
