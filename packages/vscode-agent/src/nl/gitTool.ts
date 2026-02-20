import { spawn } from "node:child_process";

const DEFAULT_MAX_OUTPUT_BYTES = 20_000;

export type GitStatus = {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  porcelain: string;
  diffStat: string;
};

export type GitCommitResult = {
  ok: boolean;
  commitSha?: string;
  message?: string;
  raw?: string;
};

export type GitPushResult = {
  ok: boolean;
  remote?: string;
  branch?: string;
  message?: string;
  raw?: string;
};

export interface GitTool {
  detectRepo(cwd: string): Promise<boolean>;
  getStatus(cwd: string): Promise<GitStatus>;
  addAll(cwd: string): Promise<{ ok: boolean; raw: string }>;
  commit(cwd: string, message: string): Promise<GitCommitResult>;
  push(cwd: string, remote: string, branch: string, setUpstream?: boolean): Promise<GitPushResult>;
}

type GitExecResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  raw: string;
};

export class LocalGitTool implements GitTool {
  constructor(private readonly maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES) {}

  async detectRepo(cwd: string): Promise<boolean> {
    const result = await this.exec(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return result.ok && result.stdout.trim() === "true";
  }

  async getStatus(cwd: string): Promise<GitStatus> {
    const [branchResult, upstreamResult, porcelainResult, diffStatResult, aheadBehind] = await Promise.all([
      this.exec(cwd, ["branch", "--show-current"]),
      this.exec(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
      this.exec(cwd, ["status", "--porcelain=v1"]),
      this.exec(cwd, ["diff", "--stat"]),
      this.exec(cwd, ["rev-list", "--left-right", "--count", "HEAD...@{u}"])
    ]);
    const porcelain = porcelainResult.stdout.trim();
    const parsed = parsePorcelainCounts(porcelain);
    const branch = branchResult.ok ? toNullableLine(branchResult.stdout) : null;
    const upstream = upstreamResult.ok ? toNullableLine(upstreamResult.stdout) : null;
    const { ahead, behind } = parseAheadBehind(aheadBehind.stdout);
    return {
      branch,
      upstream,
      ahead: upstream ? ahead : 0,
      behind: upstream ? behind : 0,
      staged: parsed.staged,
      unstaged: parsed.unstaged,
      untracked: parsed.untracked,
      porcelain,
      diffStat: diffStatResult.stdout.trim()
    };
  }

  async addAll(cwd: string): Promise<{ ok: boolean; raw: string }> {
    const result = await this.exec(cwd, ["add", "-A"]);
    return {
      ok: result.ok,
      raw: result.raw
    };
  }

  async commit(cwd: string, message: string): Promise<GitCommitResult> {
    const normalized = message.trim();
    if (!normalized) {
      return {
        ok: false,
        message: "empty commit message"
      };
    }
    const result = await this.exec(cwd, ["commit", "-m", normalized]);
    if (!result.ok) {
      return {
        ok: false,
        message: toSingleLine(result.stderr || result.stdout || "git commit failed", 220),
        raw: result.raw
      };
    }
    const shaResult = await this.exec(cwd, ["rev-parse", "--short", "HEAD"]);
    const commitSha = shaResult.ok ? toNullableLine(shaResult.stdout) ?? undefined : undefined;
    return {
      ok: true,
      commitSha,
      message: commitSha ? `commit created: ${commitSha}` : "commit created",
      raw: result.raw
    };
  }

  async push(cwd: string, remote: string, branch: string, setUpstream = false): Promise<GitPushResult> {
    const normalizedRemote = remote.trim();
    const normalizedBranch = branch.trim();
    if (!normalizedRemote || !normalizedBranch) {
      return {
        ok: false,
        message: "missing remote or branch"
      };
    }
    const args = ["push"];
    if (setUpstream) {
      args.push("-u");
    }
    args.push(normalizedRemote, normalizedBranch);
    const result = await this.exec(cwd, args);
    return {
      ok: result.ok,
      remote: normalizedRemote,
      branch: normalizedBranch,
      message: result.ok
        ? `push succeeded: ${normalizedRemote}/${normalizedBranch}${setUpstream ? " (upstream set)" : ""}`
        : toSingleLine(result.stderr || result.stdout || "git push failed", 220),
      raw: result.raw
    };
  }

  private async exec(cwd: string, args: string[]): Promise<GitExecResult> {
    return await execGitCommand(cwd, args, this.maxOutputBytes);
  }
}

async function execGitCommand(
  cwd: string,
  args: string[],
  maxOutputBytes: number
): Promise<GitExecResult> {
  return await new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let totalBytes = 0;

    const append = (channel: "stdout" | "stderr", chunk: Buffer): void => {
      if (totalBytes >= maxOutputBytes) {
        return;
      }
      totalBytes += chunk.length;
      const remaining = maxOutputBytes - (totalBytes - chunk.length);
      const safeChunk = remaining >= chunk.length ? chunk : chunk.subarray(0, Math.max(0, remaining));
      const text = safeChunk.toString("utf8");
      if (channel === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }
      if (totalBytes >= maxOutputBytes) {
        child.kill();
      }
    };

    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: stderr || message,
        raw: buildRawText(stdout, stderr || message)
      });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        raw: buildRawText(stdout.trim(), stderr.trim())
      });
    });
  });
}

function parsePorcelainCounts(porcelain: string): { staged: number; unstaged: number; untracked: number } {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const line of porcelain.split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    if (line.startsWith("??")) {
      untracked += 1;
      continue;
    }
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    if (x !== " ") {
      staged += 1;
    }
    if (y !== " ") {
      unstaged += 1;
    }
  }
  return { staged, unstaged, untracked };
}

function parseAheadBehind(raw: string): { ahead: number; behind: number } {
  const match = raw.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) {
    return { ahead: 0, behind: 0 };
  }
  return {
    ahead: Number(match[1]) || 0,
    behind: Number(match[2]) || 0
  };
}

function toNullableLine(raw: string): string | null {
  const normalized = raw.trim();
  return normalized || null;
}

function buildRawText(stdout: string, stderr: string): string {
  const parts = [stdout, stderr].filter(Boolean);
  return parts.join("\n").trim();
}

function toSingleLine(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}
