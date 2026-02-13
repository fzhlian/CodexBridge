import { spawn } from "node:child_process";

export type TestRunResult = {
  code: number | null;
  outputTail: string;
  timedOut: boolean;
};

export async function runTestCommand(command: string): Promise<TestRunResult> {
  const timeoutMs = Number(process.env.TEST_TIMEOUT_MS ?? "120000");
  const maxTailLines = Number(process.env.TEST_OUTPUT_TAIL_LINES ?? "80");

  return new Promise<TestRunResult>((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let timedOut = false;
    let full = "";
    const append = (chunk: Buffer) => {
      full += chunk.toString("utf8");
      const lines = full.split(/\r?\n/);
      if (lines.length > maxTailLines + 1) {
        full = lines.slice(-maxTailLines).join("\n");
      }
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        outputTail: full.trim(),
        timedOut
      });
    });
  });
}

export function getDefaultTestCommand(): string {
  return process.env.TEST_DEFAULT_COMMAND ?? "pnpm test";
}

export function isAllowedTestCommand(command: string): boolean {
  const allowlist = (process.env.TEST_ALLOWLIST ?? "pnpm test,npm test,yarn test")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return allowlist.some((allowed) => command === allowed || command.startsWith(`${allowed} `));
}

