import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { summarizeUnifiedDiff } from "../diff/unifiedDiff.js";
import { generatePatchFromCodex } from "../codex-patch.js";
import type { CodexClientFacade } from "../codex/codexClientFacade.js";
import type { RuntimeContextSnapshot } from "../context.js";
import { buildIntentPrompt, resolvePromptMode } from "./promptBuilder.js";
import type { TaskIntent, TaskResult, UserRequest } from "./taskTypes.js";

const MAX_SEARCH_RESULTS = 20;
const MAX_SEARCH_SCAN_FILES = 250;
const MAX_SEARCH_FILE_BYTES = 120_000;

export type RunTaskInput = {
  taskId: string;
  request: UserRequest;
  intent: TaskIntent;
  renderedContext: string;
  runtime?: RuntimeContextSnapshot;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
};

export type TaskRunnerDeps = {
  codex: Pick<CodexClientFacade, "completeWithStreaming">;
};

export async function runTask(
  input: RunTaskInput,
  deps: TaskRunnerDeps
): Promise<TaskResult> {
  const workspaceRoot = resolveWorkspaceRoot(input.runtime);

  switch (input.intent.kind) {
    case "help":
      return {
        taskId: input.taskId,
        intent: input.intent,
        proposal: {
          type: "answer",
          text: [
            "Natural language task kinds:",
            "- explain",
            "- change",
            "- diagnose",
            "- run (proposal only, local approval required)",
            "- search",
            "- review"
          ].join("\n")
        },
        requires: { mode: "none" },
        summary: "Help is ready.",
        details: "Use @dev <natural language> or type directly in chat."
      };
    case "status": {
      const statusText = await buildStatusSummary(workspaceRoot);
      return {
        taskId: input.taskId,
        intent: input.intent,
        proposal: { type: "answer", text: statusText },
        requires: { mode: "none" },
        summary: "Workspace status collected.",
        details: statusText
      };
    }
    case "search": {
      const query = input.intent.params?.query?.trim() || input.request.text.trim();
      const items = await searchWorkspace(workspaceRoot, query, input.intent.params?.files ?? []);
      const details = items.length > 0
        ? items.map((item) => `${item.path}${item.preview ? ` - ${item.preview}` : ""}`).join("\n")
        : "No matches found.";
      return {
        taskId: input.taskId,
        intent: input.intent,
        proposal: {
          type: "search_results",
          items
        },
        requires: { mode: "none" },
        summary: `Search completed: ${items.length} result(s).`,
        details
      };
    }
    case "review": {
      const reviewText = await buildReviewSummary(workspaceRoot);
      return {
        taskId: input.taskId,
        intent: input.intent,
        proposal: {
          type: "answer",
          text: reviewText
        },
        requires: { mode: "none" },
        summary: "Review summary is ready.",
        details: reviewText
      };
    }
    case "run": {
      const cmd = resolveRunCommand(input.intent.params?.cmd, input.request.text);
      return {
        taskId: input.taskId,
        intent: input.intent,
        proposal: {
          type: "command",
          cmd,
          cwd: workspaceRoot,
          reason: input.intent.summary
        },
        requires: { mode: "local_approval", action: "run_command" },
        summary: `Command proposal ready: ${cmd}`,
        details: "Waiting for local approval to run this command."
      };
    }
    case "change":
    case "diagnose": {
      if (!workspaceRoot) {
        return fallbackPlan(
          input,
          "No workspace is open. Open a workspace before generating a diff proposal."
        );
      }
      try {
        const patchPrompt = buildIntentPrompt({
          mode: resolvePromptMode(input.intent),
          intent: input.intent,
          requestText: input.request.text,
          renderedContext: input.renderedContext
        }).prompt;
        const generated = await generatePatchFromCodex(
          patchPrompt,
          workspaceRoot,
          input.runtime,
          input.signal
        );
        if (!looksLikeUnifiedDiff(generated.diff)) {
          return fallbackPlan(input, "Diff proposal was not in valid unified diff format.");
        }
        const files = summarizeUnifiedDiff(generated.diff);
        const totalAdds = files.reduce((acc, item) => acc + item.additions, 0);
        const totalDels = files.reduce((acc, item) => acc + item.deletions, 0);
        const detailLines = files.map((item) => `- ${item.path} (+${item.additions} -${item.deletions})`);
        const details = [
          generated.summary,
          `Files: ${files.length}, +${totalAdds}, -${totalDels}`,
          ...detailLines
        ].join("\n");
        return {
          taskId: input.taskId,
          intent: input.intent,
          proposal: {
            type: "diff",
            unifiedDiff: generated.diff,
            files
          },
          requires: { mode: "local_approval", action: "apply_diff" },
          summary: `Diff proposal ready: ${files.length} file(s), +${totalAdds}, -${totalDels}.`,
          details
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return fallbackPlan(input, `Diff generation failed: ${reason}`);
      }
    }
    case "explain":
    default: {
      const prompt = buildIntentPrompt({
        mode: resolvePromptMode(input.intent),
        intent: input.intent,
        requestText: input.request.text,
        renderedContext: input.renderedContext
      }).prompt;
      try {
        const answer = await deps.codex.completeWithStreaming(
          prompt,
          input.renderedContext,
          {
            onChunk: (chunk) => input.onChunk?.(chunk)
          },
          input.signal,
          workspaceRoot
        );
        return {
          taskId: input.taskId,
          intent: input.intent,
          proposal: {
            type: "answer",
            text: answer
          },
          requires: { mode: "none" },
          summary: toSingleLine(answer, 160),
          details: answer
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return await fallbackExplainAnswer(input, workspaceRoot, reason);
      }
    }
  }
}

function fallbackPlan(input: RunTaskInput, reason: string): TaskResult {
  const text = [
    "Could not produce a safe executable proposal.",
    `Reason: ${reason}`,
    "Suggested next step: refine the request with explicit files and expected output."
  ].join("\n");
  return {
    taskId: input.taskId,
    intent: input.intent,
    proposal: {
      type: "plan",
      text
    },
    requires: { mode: "none" },
    summary: reason,
    details: text
  };
}

async function fallbackExplainAnswer(
  input: RunTaskInput,
  workspaceRoot: string | undefined,
  reason: string
): Promise<TaskResult> {
  if (isLikelyReviewRequest(input.request.text)) {
    const reviewText = await buildReviewSummary(workspaceRoot);
    const text = [
      "Codex timed out for this request. Returned local review summary instead.",
      "",
      reviewText
    ].join("\n");
    return {
      taskId: input.taskId,
      intent: input.intent,
      proposal: {
        type: "answer",
        text
      },
      requires: { mode: "none" },
      summary: "Codex timed out; local review summary returned.",
      details: text
    };
  }

  const text = [
    "Codex timed out for this request.",
    `Reason: ${reason}`,
    "Try narrowing the request or selecting specific files."
  ].join("\n");
  return {
    taskId: input.taskId,
    intent: input.intent,
    proposal: {
      type: "answer",
      text
    },
    requires: { mode: "none" },
    summary: "Codex timed out.",
    details: text
  };
}

function isLikelyReviewRequest(text: string): boolean {
  return /\b(?:code\s*review|review|inspect|audit|check)\b/i.test(text)
    || /(?:\u5ba1\u6838|\u5ba1\u6821|\u5ba1\u67e5|\u8bc4\u5ba1|\u4ee3\u7801\u68c0\u67e5)/.test(text);
}

function resolveWorkspaceRoot(runtime?: RuntimeContextSnapshot): string | undefined {
  const fromRuntime = runtime?.workspaceRoot?.trim();
  if (fromRuntime) {
    return fromRuntime;
  }
  const fromEnv = process.env.WORKSPACE_ROOT?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return undefined;
}

function resolveRunCommand(cmd: string | undefined, requestText: string): string {
  const fromIntent = cmd?.trim();
  if (fromIntent) {
    return fromIntent;
  }
  const fromGitSync = inferGitSyncCommandFromText(requestText);
  if (fromGitSync) {
    return fromGitSync;
  }
  const fromBackticks = requestText.match(/`([^`]+)`/)?.[1]?.trim();
  if (fromBackticks) {
    return fromBackticks;
  }
  const fromNatural = requestText.match(
    /(?:run|execute|test|build|lint|\u8fd0\u884c|\u6267\u884c|\u6d4b\u8bd5|\u7f16\u8bd1)\s+(.+)$/i
  )?.[1]?.trim();
  if (fromNatural) {
    return fromNatural;
  }
  return process.env.TEST_DEFAULT_COMMAND?.trim() || "pnpm test";
}

function inferGitSyncCommandFromText(text: string): string | undefined {
  if (!isLikelyGitSyncIntent(text)) {
    return undefined;
  }
  if (
    /\bgit\s+fetch\b/i.test(text)
    || /\bfetch\b/i.test(text)
    || /(?:\u62c9\u53d6\u8fdc\u7a0b|\u83b7\u53d6\u8fdc\u7a0b)/.test(text)
  ) {
    return "git fetch --all --prune";
  }
  if (/\brebase\b/i.test(text) || /\u53d8\u57fa/.test(text)) {
    return "git pull --rebase";
  }
  if (
    /\bfrom\s+github\b/i.test(text)
    || /(?:\u4ecegithub|\u4ece github|\u62c9\u53d6|\u540c\u6b65\u5230?\u672c\u5730|\u5230\u672c\u5730)/.test(text)
  ) {
    return "git pull --ff-only";
  }
  if (
    /\bto\s+github\b/i.test(text)
    || /\bpush\b/i.test(text)
    || /(?:\u63a8\u9001|\u63d0\u4ea4\u5e76\u63a8\u9001|\u540c\u6b65\u5230github|\u540c\u6b65\u5230 github|\u4e0a\u4f20\u5230github)/.test(text)
  ) {
    return "git push";
  }
  return "git push";
}

function isLikelyGitSyncIntent(text: string): boolean {
  const hasTarget = /\b(?:git|github|repo|repository)\b/i.test(text)
    || /(?:github|\u4ed3\u5e93|\u4ee3\u7801\u4ed3|\u4ee3\u7801\u5e93|\u8fdc\u7a0b\u4ed3)/.test(text);
  if (!hasTarget) {
    return false;
  }
  return /\b(?:sync|synchronize|push|pull|fetch|rebase|commit)\b/i.test(text)
    || /(?:\u540c\u6b65|\u63a8\u9001|\u62c9\u53d6|\u53d8\u57fa|\u63d0\u4ea4)/.test(text);
}

async function buildStatusSummary(workspaceRoot?: string): Promise<string> {
  const lines: string[] = [];
  lines.push(`workspace=${workspaceRoot ?? "not_open"}`);
  lines.push(`platform=${process.platform}`);
  lines.push(`node=${process.version}`);

  if (!workspaceRoot) {
    return lines.join("\n");
  }

  const branch = await runProcess("git", ["-C", workspaceRoot, "rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch.ok && branch.stdout) {
    lines.push(`git_branch=${branch.stdout}`);
  }
  const status = await runProcess("git", ["-C", workspaceRoot, "status", "--short"]);
  if (status.ok) {
    const changed = status.stdout ? status.stdout.split(/\r?\n/).filter(Boolean).length : 0;
    lines.push(`git_changed=${changed}`);
  }
  return lines.join("\n");
}

async function buildReviewSummary(workspaceRoot?: string): Promise<string> {
  if (!workspaceRoot) {
    return "No workspace is open. Open a workspace to review local diff.";
  }
  const stat = await runProcess("git", ["-C", workspaceRoot, "diff", "--stat", "--"]);
  if (!stat.ok) {
    return "Unable to read git diff --stat.";
  }
  const text = stat.stdout.trim();
  if (!text) {
    return "No local diff found.";
  }
  return text;
}

async function searchWorkspace(
  workspaceRoot: string | undefined,
  query: string,
  hintFiles: string[]
): Promise<Array<{ path: string; preview?: string }>> {
  if (!workspaceRoot) {
    return [];
  }
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return hintFiles.slice(0, MAX_SEARCH_RESULTS).map((file) => ({ path: normalizeRelPath(file) }));
  }

  const vscodeItems = await searchWorkspaceWithVscode(workspaceRoot, normalizedQuery, MAX_SEARCH_RESULTS);
  if (vscodeItems.length >= MAX_SEARCH_RESULTS) {
    return vscodeItems.slice(0, MAX_SEARCH_RESULTS);
  }

  const result: Array<{ path: string; preview?: string }> = [];
  const seen = new Set<string>();
  for (const item of vscodeItems) {
    result.push(item);
    seen.add(item.path);
  }
  const queue: string[] = [workspaceRoot];
  const lowered = normalizedQuery.toLowerCase();
  let scannedFiles = 0;

  while (queue.length > 0 && scannedFiles < MAX_SEARCH_SCAN_FILES && result.length < MAX_SEARCH_RESULTS) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (result.length >= MAX_SEARCH_RESULTS || scannedFiles >= MAX_SEARCH_SCAN_FILES) {
        break;
      }
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolute);
        continue;
      }
      scannedFiles += 1;
      const relPath = normalizeRelPath(path.relative(workspaceRoot, absolute));
      if (seen.has(relPath)) {
        continue;
      }
      if (relPath.toLowerCase().includes(lowered)) {
        result.push({ path: relPath, preview: "path match" });
        seen.add(relPath);
        continue;
      }
      const found = await readTextMatch(absolute, normalizedQuery);
      if (!found) {
        continue;
      }
      result.push({
        path: relPath,
        preview: found
      });
      seen.add(relPath);
    }
  }
  return result;
}

async function searchWorkspaceWithVscode(
  workspaceRoot: string,
  query: string,
  maxResults: number
): Promise<Array<{ path: string; preview?: string }>> {
  let vscodeModule: unknown;
  try {
    vscodeModule = await import("vscode");
  } catch {
    return [];
  }
  if (!vscodeModule || typeof vscodeModule !== "object") {
    return [];
  }
  const value = vscodeModule as {
    workspace?: {
      findTextInFiles?: (
        query: { pattern: string; isCaseSensitive?: boolean; isRegExp?: boolean },
        options: { include?: unknown; maxResults?: number },
        callback: (result: {
          uri: { fsPath: string };
          preview?: { text?: string };
        }) => void
      ) => Promise<void>;
    };
    RelativePattern?: new (base: string, pattern: string) => unknown;
  };
  if (!value.workspace?.findTextInFiles || !value.RelativePattern) {
    return [];
  }

  const items: Array<{ path: string; preview?: string }> = [];
  const seen = new Set<string>();
  await value.workspace.findTextInFiles(
    {
      pattern: query,
      isCaseSensitive: false,
      isRegExp: false
    },
    {
      include: new value.RelativePattern(workspaceRoot, "**/*"),
      maxResults
    },
    (match) => {
      const relPath = normalizeRelPath(path.relative(workspaceRoot, match.uri.fsPath));
      if (!relPath || seen.has(relPath)) {
        return;
      }
      seen.add(relPath);
      const preview = toSingleLine(String(match.preview?.text ?? "").trim(), 160);
      items.push({
        path: relPath,
        preview: preview || query
      });
    }
  );
  return items;
}

async function readTextMatch(filePath: string, query: string): Promise<string | undefined> {
  let raw: Buffer;
  try {
    raw = await fs.readFile(filePath);
  } catch {
    return undefined;
  }
  if (raw.length > MAX_SEARCH_FILE_BYTES || isLikelyBinary(raw)) {
    return undefined;
  }
  const text = raw.toString("utf8");
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx < 0) {
    return undefined;
  }
  const lineStart = text.lastIndexOf("\n", idx);
  const lineEnd = text.indexOf("\n", idx);
  const line = text.slice(lineStart + 1, lineEnd === -1 ? undefined : lineEnd).trim();
  if (!line) {
    return query;
  }
  return toSingleLine(line, 160);
}

function isLikelyBinary(buffer: Buffer): boolean {
  const probe = buffer.subarray(0, Math.min(buffer.length, 1024));
  for (const byte of probe) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

function looksLikeUnifiedDiff(diff: string): boolean {
  return diff.includes("diff --git")
    || (diff.includes("\n--- ") && diff.includes("\n+++ "))
    || (diff.startsWith("--- ") && diff.includes("\n+++ "));
}

function toSingleLine(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function normalizeRelPath(input: string): string {
  return input.replaceAll("\\", "/");
}

async function runProcess(
  command: string,
  args: string[]
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", () => {
      resolve({ ok: false, stdout: "", stderr: "" });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim()
      });
    });
  });
}
