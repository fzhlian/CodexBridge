import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { summarizeUnifiedDiff } from "../diff/unifiedDiff.js";
import { generatePatchFromCodex } from "../codex-patch.js";
import type { CodexClientFacade } from "../codex/codexClientFacade.js";
import type { RuntimeContextSnapshot } from "../context.js";
import { t } from "../i18n/messages.js";
import { resolveOutboundIp } from "../network.js";
import { buildIntentPrompt, resolvePromptMode } from "./promptBuilder.js";
import { resolveRunCommand } from "./commandExecution.js";
import type { TaskIntent, TaskResult, UserRequest } from "./taskTypes.js";
import { LocalGitTool, type GitStatus, type GitTool } from "./gitTool.js";

const MAX_SEARCH_RESULTS = 20;
const MAX_SEARCH_SCAN_FILES = 250;
const MAX_SEARCH_FILE_BYTES = 120_000;
const DEFAULT_GIT_REMOTE = "origin";

export type GitTaskConfig = {
  enable: boolean;
  autoRunReadOnly: boolean;
  defaultRemote: string;
  requireApprovalForCommit: boolean;
  requireApprovalForPush: boolean;
};

export type RunTaskInput = {
  taskId: string;
  request: UserRequest;
  intent: TaskIntent;
  renderedContext: string;
  runtime?: RuntimeContextSnapshot;
  git?: Partial<GitTaskConfig>;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
};

export type TaskRunnerDeps = {
  codex: Pick<CodexClientFacade, "completeWithStreaming">;
  gitTool?: GitTool;
};

export async function runTask(
  input: RunTaskInput,
  deps: TaskRunnerDeps
): Promise<TaskResult> {
  const workspaceRoot = resolveWorkspaceRoot(input.runtime);
  const gitConfig = resolveGitTaskConfig(input.git);
  const gitTool = deps.gitTool ?? new LocalGitTool();

  switch (input.intent.kind) {
    case "help":
      return {
        taskId: input.taskId,
        intent: input.intent,
        proposal: {
          type: "answer",
          text: [
            t("taskRunner.help.lineIntro"),
            t("taskRunner.help.lineExplain"),
            t("taskRunner.help.lineChange"),
            t("taskRunner.help.lineDiagnose"),
            t("taskRunner.help.lineRun"),
            t("taskRunner.help.lineGitSync"),
            t("taskRunner.help.lineSearch"),
            t("taskRunner.help.lineReview")
          ].join("\n")
        },
        requires: { mode: "none" },
        summary: t("taskRunner.help.summary"),
        details: t("taskRunner.help.details")
      };
    case "status": {
      const statusText = await buildStatusSummary(workspaceRoot, input.signal);
      return {
        taskId: input.taskId,
        intent: input.intent,
        proposal: { type: "answer", text: statusText },
        requires: { mode: "none" },
        summary: t("taskRunner.status.summary"),
        details: statusText
      };
    }
    case "search": {
      const query = input.intent.params?.query?.trim() || input.request.text.trim();
      const items = await searchWorkspace(workspaceRoot, query, input.intent.params?.files ?? []);
      const details = items.length > 0
        ? items.map((item) => `${item.path}${item.preview ? ` - ${item.preview}` : ""}`).join("\n")
        : t("taskRunner.search.noMatches");
      return {
        taskId: input.taskId,
        intent: input.intent,
        proposal: {
          type: "search_results",
          items
        },
        requires: { mode: "none" },
        summary: t("taskRunner.search.summary", { count: items.length }),
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
        summary: t("taskRunner.review.summaryReady"),
        details: reviewText
      };
    }
    case "run": {
      const cmd = await resolveRunCommand({
        intentCommand: input.intent.params?.cmd,
        requestText: input.request.text,
        workspaceRoot,
        defaultTestCommand: process.env.TEST_DEFAULT_COMMAND?.trim(),
        defaultBuildCommand: process.env.BUILD_DEFAULT_COMMAND?.trim()
      });
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
        summary: t("taskRunner.run.summaryReady", { command: cmd }),
        details: t("taskRunner.run.waitingApproval")
      };
    }
    case "git_sync": {
      return await runGitSyncTask(input, workspaceRoot, gitTool, gitConfig);
    }
    case "change":
    case "diagnose": {
      if (!workspaceRoot) {
        return fallbackPlan(
          input,
          t("taskRunner.change.workspaceRequired")
        );
      }
      const patchPrompt = buildIntentPrompt({
        mode: resolvePromptMode(input.intent),
        intent: input.intent,
        requestText: input.request.text,
        renderedContext: input.renderedContext
      }).prompt;
      try {
        return await generateDiffTaskResult(input, workspaceRoot, patchPrompt);
      } catch (error) {
        const reasons: string[] = [];
        const firstReason = error instanceof Error ? error.message : String(error);
        reasons.push(firstReason);
        const strictRetryPrompt = buildStrictDiffRetryPrompt(input, patchPrompt);
        if (shouldRetryStrictDiff(firstReason)) {
          try {
            return await generateDiffTaskResult(input, workspaceRoot, strictRetryPrompt);
          } catch (retryError) {
            const retryReason = retryError instanceof Error ? retryError.message : String(retryError);
            reasons.push(t("taskRunner.change.strictRetryFailed", { reason: retryReason }));
          }
        }
        try {
          return await generateDiffTaskResultViaModelCompletion(
            input,
            workspaceRoot,
            deps.codex,
            strictRetryPrompt
          );
        } catch (completionError) {
          const completionReason = completionError instanceof Error
            ? completionError.message
            : String(completionError);
          reasons.push(t("taskRunner.change.completionFallbackFailed", { reason: completionReason }));
        }
        return fallbackPlan(
          input,
          t("taskRunner.change.diffGenerationFailed", { reasons: reasons.join("; ") })
        );
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

async function runGitSyncTask(
  input: RunTaskInput,
  workspaceRoot: string | undefined,
  gitTool: GitTool,
  config: GitTaskConfig
): Promise<TaskResult> {
  if (!config.enable) {
    return {
      taskId: input.taskId,
      intent: input.intent,
      proposal: {
        type: "answer",
        text: t("taskRunner.gitSync.disabledText")
      },
      requires: { mode: "none" },
      summary: t("taskRunner.gitSync.disabledSummary"),
      details: t("taskRunner.gitSync.disabledDetails")
    };
  }
  if (!workspaceRoot) {
    return fallbackPlan(
      input,
      t("taskRunner.gitSync.workspaceRequired")
    );
  }
  const inRepo = await gitTool.detectRepo(workspaceRoot);
  if (!inRepo) {
    return fallbackPlan(input, t("taskRunner.gitSync.notRepository"));
  }
  if (!config.autoRunReadOnly) {
    return {
      taskId: input.taskId,
      intent: input.intent,
      proposal: {
        type: "plan",
        text: [
          t("taskRunner.gitSync.readOnlyDisabledLine1"),
          t("taskRunner.gitSync.readOnlyDisabledLine2")
        ].join("\n")
      },
      requires: { mode: "none" },
      summary: t("taskRunner.gitSync.readOnlyDisabledSummary"),
      details: t("taskRunner.gitSync.readOnlyDisabledDetails")
    };
  }

  const status = await gitTool.getStatus(workspaceRoot);
  const mode = resolveGitSyncMode(input.intent, input.request.text);
  const hasChanges = status.staged + status.unstaged + status.untracked > 0;
  const wantsCommit = mode !== "push_only";
  const wantsPush = mode !== "commit_only";
  const willCreateCommit = hasChanges && wantsCommit;
  const notes: string[] = [];
  const actions: Array<{
    id: "add" | "commit" | "push";
    title: string;
    cmd: string;
    cwd: string;
    risk: "R1" | "R2";
    requiresApproval: true;
    remote?: string;
    branch?: string;
    setUpstream?: boolean;
  }> = [];
  let commitMessage: string | undefined;

  if (!hasChanges && wantsCommit) {
    notes.push(t("taskRunner.gitSync.noteNoLocalChangesForCommit"));
  }
  if (hasChanges && wantsCommit) {
    actions.push({
      id: "add",
      title: t("taskRunner.gitSync.actionTitleApproveAddR1"),
      cmd: "git add -A",
      cwd: workspaceRoot,
      risk: "R1",
      requiresApproval: true
    });
    commitMessage = sanitizeCommitMessage(
      input.intent.params?.commitMessage
      ?? suggestCommitMessage(input.request.text, status)
    );
    actions.push({
      id: "commit",
      title: t("taskRunner.gitSync.actionTitleApproveCommitR1"),
      cmd: `git commit -m ${quoteGitArg(commitMessage)}`,
      cwd: workspaceRoot,
      risk: "R1",
      requiresApproval: true
    });
  }

  if (wantsPush) {
    const pushAction = buildPushAction(status, config.defaultRemote);
    const canPushNow = status.ahead > 0 || willCreateCommit;
    if (!canPushNow) {
      if (hasChanges && !wantsCommit) {
        notes.push(t("taskRunner.gitSync.notePushOnlyUncommittedChanges"));
      } else {
        notes.push(t("taskRunner.gitSync.noteNoLocalCommitsAhead"));
      }
    } else {
      if (!status.upstream) {
        notes.push(t("taskRunner.gitSync.noteNoUpstreamConfigured"));
      }
      actions.push({
        id: "push",
        title: t("taskRunner.gitSync.actionTitleApprovePushR2"),
        cmd: pushAction.cmd,
        cwd: workspaceRoot,
        risk: "R2",
        requiresApproval: true,
        remote: pushAction.remote,
        branch: pushAction.branch,
        setUpstream: pushAction.setUpstream
      });
    }
  }

  if (actions.length === 0) {
    const branchText = status.branch ?? t("chat.gitSync.placeholderDetached");
    const upstreamText = status.upstream ?? t("chat.gitSync.placeholderNone");
    const noActionText = [
      t("taskRunner.gitSync.noActionsRequiredTitle"),
      t("taskRunner.gitSync.detailBranch", { branch: branchText }),
      t("taskRunner.gitSync.detailUpstream", { upstream: upstreamText }),
      t("taskRunner.gitSync.detailAheadBehind", { ahead: status.ahead, behind: status.behind }),
      notes.length > 0 ? t("taskRunner.gitSync.detailNote", { note: notes.join(" ") }) : ""
    ].filter(Boolean).join("\n");
    return {
      taskId: input.taskId,
      intent: input.intent,
      proposal: {
        type: "answer",
        text: noActionText
      },
      requires: { mode: "none" },
      summary: t("taskRunner.gitSync.noActionsRequiredSummary"),
      details: noActionText
    };
  }

  const diffStatPreview = toSingleLine(status.diffStat || t("chat.gitSync.placeholderNoDiffStat"), 400);
  const branchText = status.branch ?? t("chat.gitSync.placeholderDetached");
  const upstreamText = status.upstream ?? t("chat.gitSync.placeholderNone");
  const detailLines = [
    t("taskRunner.gitSync.detailBranch", { branch: branchText }),
    t("taskRunner.gitSync.detailUpstream", { upstream: upstreamText }),
    t("taskRunner.gitSync.detailAheadBehind", { ahead: status.ahead, behind: status.behind }),
    t("taskRunner.gitSync.detailChangeCounts", {
      staged: status.staged,
      unstaged: status.unstaged,
      untracked: status.untracked
    }),
    t("taskRunner.gitSync.detailDiffStat", { diffStat: diffStatPreview }),
    t("taskRunner.gitSync.detailMode", { mode }),
    ...notes.map((note) => t("taskRunner.gitSync.detailNote", { note })),
    ...actions.map((action) => t("taskRunner.gitSync.detailAction", { cmd: action.cmd }))
  ];

  return {
    taskId: input.taskId,
    intent: input.intent,
    proposal: {
      type: "git_sync_plan",
      branch: status.branch,
      upstream: status.upstream,
      ahead: status.ahead,
      behind: status.behind,
      staged: status.staged,
      unstaged: status.unstaged,
      untracked: status.untracked,
      diffStat: status.diffStat,
      commitMessage,
      actions,
      notes
    },
    requires: { mode: "local_approval", action: "run_command" },
    summary: t("taskRunner.gitSync.summaryProposalReady", { count: actions.length }),
    details: detailLines.join("\n")
  };
}

function fallbackPlan(input: RunTaskInput, reason: string): TaskResult {
  const text = [
    t("taskRunner.fallback.planTitle"),
    t("taskRunner.fallback.reason", { reason }),
    t("taskRunner.fallback.suggest")
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

function resolveGitTaskConfig(input?: Partial<GitTaskConfig>): GitTaskConfig {
  return {
    enable: input?.enable ?? true,
    autoRunReadOnly: input?.autoRunReadOnly ?? true,
    defaultRemote: (input?.defaultRemote?.trim() || DEFAULT_GIT_REMOTE),
    requireApprovalForCommit: input?.requireApprovalForCommit ?? true,
    requireApprovalForPush: input?.requireApprovalForPush ?? true
  };
}

function resolveGitSyncMode(intent: TaskIntent, requestText: string): "sync" | "commit_only" | "push_only" {
  const fromIntent = intent.params?.mode;
  if (fromIntent === "sync" || fromIntent === "commit_only" || fromIntent === "push_only") {
    return fromIntent;
  }
  const normalized = requestText.trim();
  if (/(?:\bonly\s+push\b|\bpush\s+only\b|\u53ea\u63a8\u9001|\u4ec5\u63a8\u9001|\u53ea\u4e0a\u4f20|\u4ec5\u4e0a\u4f20|\u4e0d\u8981\u63d0\u4ea4)/i.test(normalized)) {
    return "push_only";
  }
  if (/(?:\bonly\s+commit\b|\bcommit\s+only\b|\u53ea\u63d0\u4ea4|\u4ec5\u63d0\u4ea4|\u4e0d\u8981\u63a8\u9001)/i.test(normalized)) {
    return "commit_only";
  }
  const lower = normalized.toLowerCase();
  const wantsPush = /\b(?:push|sync|synchronize|publish|upload)\b/i.test(lower)
    || /(?:\u63a8\u9001|\u540c\u6b65|\u4e0a\u4f20|\u53d1\u5e03)/.test(normalized);
  const wantsCommit = /\bcommit\b/i.test(lower) || /(?:\u63d0\u4ea4)/.test(normalized);
  if (wantsCommit && !wantsPush) {
    return "commit_only";
  }
  if (wantsPush && !wantsCommit && !/\b(?:sync|synchronize)\b/i.test(lower) && !/\u540c\u6b65/.test(normalized)) {
    return "push_only";
  }
  return "sync";
}

function suggestCommitMessage(requestText: string, status: GitStatus): string {
  const normalized = requestText.toLowerCase();
  if (/\bfix\b|(?:\u4fee\u590d)/.test(normalized)) {
    return "fix: update workspace changes";
  }
  if (/\bfeat\b|\bfeature\b|(?:\u65b0\u589e|\u529f\u80fd)/.test(normalized)) {
    return "feat: update workspace changes";
  }
  if (/\brefactor\b|(?:\u91cd\u6784)/.test(normalized)) {
    return "refactor: update workspace changes";
  }
  if (/\bdocs?\b|(?:\u6587\u6863|\u8bf4\u660e)/.test(normalized)) {
    return "docs: update workspace documentation";
  }
  const total = status.staged + status.unstaged + status.untracked;
  if (total <= 0) {
    return "chore: update workspace";
  }
  return `chore: update workspace (${total} file${total > 1 ? "s" : ""})`;
}

function sanitizeCommitMessage(value: string): string {
  const normalized = value
    .replace(/\r?\n/g, " ")
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "chore: update workspace";
  }
  if (normalized.length <= 80) {
    return normalized;
  }
  return normalized.slice(0, 80).trim();
}

function quoteGitArg(value: string): string {
  const normalized = sanitizeCommitMessage(value);
  return `"${normalized}"`;
}

function buildPushAction(
  status: GitStatus,
  defaultRemote: string
): { cmd: string; remote: string; branch: string; setUpstream: boolean } {
  const branch = status.branch?.trim() || "HEAD";
  const upstream = parseUpstream(status.upstream);
  if (upstream) {
    return {
      cmd: `git push ${upstream.remote} ${upstream.branch}`,
      remote: upstream.remote,
      branch: upstream.branch,
      setUpstream: false
    };
  }
  const remote = defaultRemote.trim() || DEFAULT_GIT_REMOTE;
  return {
    cmd: `git push -u ${remote} ${branch}`,
    remote,
    branch,
    setUpstream: true
  };
}

function parseUpstream(
  upstream: string | null
): { remote: string; branch: string } | undefined {
  const normalized = upstream?.trim();
  if (!normalized) {
    return undefined;
  }
  const slashIndex = normalized.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= normalized.length - 1) {
    return undefined;
  }
  return {
    remote: normalized.slice(0, slashIndex),
    branch: normalized.slice(slashIndex + 1)
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
      t("taskRunner.explain.timeoutReturnedReview"),
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
      summary: t("taskRunner.explain.timeoutReviewSummary"),
      details: text
    };
  }

  const text = [
    t("taskRunner.explain.timeout"),
    t("taskRunner.explain.reason", { reason }),
    t("taskRunner.explain.suggest")
  ].join("\n");
  return {
    taskId: input.taskId,
    intent: input.intent,
    proposal: {
      type: "answer",
      text
    },
    requires: { mode: "none" },
    summary: t("taskRunner.explain.timeoutSummary"),
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

async function buildStatusSummary(
  workspaceRoot?: string,
  signal?: AbortSignal
): Promise<string> {
  const lines: string[] = [];
  const outboundIp = await resolveOutboundIp({ signal, timeoutMs: 2500 });
  lines.push(`${t("taskRunner.status.fieldWorkspace")}=${workspaceRoot ?? t("taskRunner.status.valueNotOpen")}`);
  lines.push(`${t("taskRunner.status.fieldPlatform")}=${process.platform}`);
  lines.push(`${t("taskRunner.status.fieldNode")}=${process.version}`);
  lines.push(`${t("taskRunner.status.fieldOutboundIp")}=${outboundIp?.trim() || "unknown"}`);

  if (!workspaceRoot) {
    return lines.join("\n");
  }

  const branch = await runProcess("git", ["-C", workspaceRoot, "rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch.ok && branch.stdout) {
    lines.push(`${t("taskRunner.status.fieldGitBranch")}=${branch.stdout}`);
  }
  const status = await runProcess("git", ["-C", workspaceRoot, "status", "--short"]);
  if (status.ok) {
    const changed = status.stdout ? status.stdout.split(/\r?\n/).filter(Boolean).length : 0;
    lines.push(`${t("taskRunner.status.fieldGitChanged")}=${changed}`);
  }
  return lines.join("\n");
}

async function buildReviewSummary(workspaceRoot?: string): Promise<string> {
  if (!workspaceRoot) {
    return t("taskRunner.review.workspaceRequired");
  }
  const stat = await runProcess("git", ["-C", workspaceRoot, "diff", "--stat", "--"]);
  if (!stat.ok) {
    return t("taskRunner.review.unableReadDiffStat");
  }
  const text = stat.stdout.trim();
  if (!text) {
    return t("taskRunner.review.noLocalDiff");
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
        result.push({ path: relPath, preview: t("taskRunner.search.pathMatchPreview") });
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

async function generateDiffTaskResult(
  input: RunTaskInput,
  workspaceRoot: string,
  patchPrompt: string
): Promise<TaskResult> {
  const generated = await generatePatchFromCodex(
    patchPrompt,
    workspaceRoot,
    input.runtime,
    input.signal
  );
  return buildDiffTaskResult(input, generated.diff, generated.summary);
}

async function generateDiffTaskResultViaModelCompletion(
  input: RunTaskInput,
  workspaceRoot: string,
  codex: Pick<CodexClientFacade, "completeWithStreaming">,
  prompt: string
): Promise<TaskResult> {
  const completion = await codex.completeWithStreaming(
    prompt,
    input.renderedContext,
    {
      onChunk: (chunk) => input.onChunk?.(chunk)
    },
    input.signal,
    workspaceRoot
  );
  const extracted = extractDiffFromCompletionText(completion);
  if (!extracted) {
    throw new Error(t("taskRunner.diff.error.noValidDiffInCompletion"));
  }
  return buildDiffTaskResult(
    input,
    extracted,
    t("taskRunner.diff.generatedByCompletionFallback")
  );
}

function buildDiffTaskResult(
  input: RunTaskInput,
  diff: string,
  generationSummary: string
): TaskResult {
  if (!looksLikeUnifiedDiff(diff)) {
    throw new Error(t("taskRunner.diff.error.invalidUnifiedDiff"));
  }
  const files = summarizeUnifiedDiff(diff);
  const totalAdds = files.reduce((acc, item) => acc + item.additions, 0);
  const totalDels = files.reduce((acc, item) => acc + item.deletions, 0);
  const detailLines = files.map((item) => `- ${item.path} (+${item.additions} -${item.deletions})`);
  const details = [
    generationSummary,
    t("taskRunner.diff.filesSummary", { count: files.length, additions: totalAdds, deletions: totalDels }),
    ...detailLines
  ].join("\n");
  return {
    taskId: input.taskId,
    intent: input.intent,
    proposal: {
      type: "diff",
      unifiedDiff: diff,
      files
    },
    requires: { mode: "local_approval", action: "apply_diff" },
    summary: t("taskRunner.diff.summaryReady", {
      count: files.length,
      additions: totalAdds,
      deletions: totalDels
    }),
    details
  };
}

function shouldRetryStrictDiff(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return normalized.includes("no diff content")
    || normalized.includes("not in valid unified diff format")
    || normalized.includes("missing diff");
}

function buildStrictDiffRetryPrompt(input: RunTaskInput, previousPrompt: string): string {
  return [
    previousPrompt,
    "",
    "STRICT RETRY INSTRUCTIONS:",
    "- Previous attempt did not return a valid unified diff.",
    "- Return ONLY unified diff text.",
    "- Start at either `diff --git ...` or `--- ...` + `+++ ...` headers.",
    "- Include valid hunk headers (`@@ -old,+new @@`).",
    "- Do not include markdown fences, explanations, or comments.",
    "",
    `Original request: ${input.request.text}`
  ].join("\n");
}

function extractDiffFromCompletionText(text: string): string | undefined {
  const normalized = text.trim();
  if (!normalized) {
    return undefined;
  }
  const fenceMatches = [...normalized.matchAll(/```(?:diff|patch|udiff|gitdiff)?\s*([\s\S]*?)```/gi)];
  for (const match of fenceMatches) {
    const candidate = (match[1] || "").trim();
    if (looksLikeUnifiedDiff(candidate)) {
      return candidate;
    }
  }
  const diffMarker = normalized.search(/^diff --git /m);
  if (diffMarker >= 0) {
    const candidate = normalized.slice(diffMarker).trim();
    if (looksLikeUnifiedDiff(candidate)) {
      return candidate;
    }
  }
  if (looksLikeUnifiedDiff(normalized)) {
    return normalized;
  }
  return undefined;
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
