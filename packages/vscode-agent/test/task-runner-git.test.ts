import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runTask } from "../src/nl/taskRunner.js";
import type { GitStatus, GitTool } from "../src/nl/gitTool.js";
import type { TaskIntent } from "../src/nl/taskTypes.js";

function createGitSyncIntent(mode: "sync" | "commit_only" | "push_only" = "sync"): TaskIntent {
  return {
    kind: "git_sync",
    confidence: 0.95,
    summary: "git sync task",
    params: { mode }
  };
}

function createGitTool(status: GitStatus, inRepo = true): GitTool {
  return {
    detectRepo: async () => inRepo,
    getStatus: async () => status,
    addAll: async () => ({ ok: true, raw: "" }),
    commit: async () => ({ ok: true, commitSha: "abc123", message: "ok", raw: "" }),
    push: async () => ({ ok: true, remote: "origin", branch: "main", message: "ok", raw: "" })
  };
}

describe("runTask git_sync", () => {
  const previousLocale = process.env.CODEXBRIDGE_UI_LOCALE;

  beforeAll(() => {
    process.env.CODEXBRIDGE_UI_LOCALE = "en";
  });

  afterAll(() => {
    if (typeof previousLocale === "string") {
      process.env.CODEXBRIDGE_UI_LOCALE = previousLocale;
      return;
    }
    delete process.env.CODEXBRIDGE_UI_LOCALE;
  });

  it("builds add/commit/push proposal when local changes exist", async () => {
    const status: GitStatus = {
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 2,
      untracked: 1,
      porcelain: " M src/a.ts\n?? src/b.ts",
      diffStat: " src/a.ts | 2 +-"
    };
    const result = await runTask(
      {
        taskId: "task-1",
        request: {
          source: "local_ui",
          threadId: "default",
          text: "同步项目到github"
        },
        intent: createGitSyncIntent("sync"),
        renderedContext: "",
        runtime: { workspaceRoot: "D:/repo" } as never
      },
      {
        codex: { completeWithStreaming: async () => "" },
        gitTool: createGitTool(status)
      }
    );
    expect(result.proposal.type).toBe("git_sync_plan");
    if (result.proposal.type !== "git_sync_plan") {
      return;
    }
    expect(result.proposal.actions.map((item) => item.id)).toEqual(["add", "commit", "push"]);
    expect(result.proposal.actions[2]?.cmd).toBe("git push origin main");
  });

  it("builds push-only proposal when no changes but branch is ahead", async () => {
    const status: GitStatus = {
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      porcelain: "",
      diffStat: ""
    };
    const result = await runTask(
      {
        taskId: "task-2",
        request: {
          source: "local_ui",
          threadId: "default",
          text: "只推送到github"
        },
        intent: createGitSyncIntent("push_only"),
        renderedContext: "",
        runtime: { workspaceRoot: "D:/repo" } as never
      },
      {
        codex: { completeWithStreaming: async () => "" },
        gitTool: createGitTool(status)
      }
    );
    expect(result.proposal.type).toBe("git_sync_plan");
    if (result.proposal.type !== "git_sync_plan") {
      return;
    }
    expect(result.proposal.actions.map((item) => item.id)).toEqual(["push"]);
  });

  it("does not propose push when push-only mode has only uncommitted workspace changes", async () => {
    const status: GitStatus = {
      branch: "main",
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 2,
      untracked: 1,
      porcelain: " M src/a.ts\n?? src/b.ts",
      diffStat: " src/a.ts | 2 +-"
    };
    const result = await runTask(
      {
        taskId: "task-2b",
        request: {
          source: "local_ui",
          threadId: "default",
          text: "只推送到github"
        },
        intent: createGitSyncIntent("push_only"),
        renderedContext: "",
        runtime: { workspaceRoot: "D:/repo" } as never
      },
      {
        codex: { completeWithStreaming: async () => "" },
        gitTool: createGitTool(status)
      }
    );
    expect(result.proposal.type).toBe("answer");
    expect(result.summary).toContain("No Git sync actions required");
    expect(result.details?.toLowerCase()).toContain("push-only mode");
  });

  it("returns a plan when current workspace is not a git repo", async () => {
    const status: GitStatus = {
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      porcelain: "",
      diffStat: ""
    };
    const result = await runTask(
      {
        taskId: "task-3",
        request: {
          source: "local_ui",
          threadId: "default",
          text: "同步项目到github"
        },
        intent: createGitSyncIntent("sync"),
        renderedContext: "",
        runtime: { workspaceRoot: "D:/repo" } as never
      },
      {
        codex: { completeWithStreaming: async () => "" },
        gitTool: createGitTool(status, false)
      }
    );
    expect(result.proposal.type).toBe("plan");
    expect(result.summary.toLowerCase()).toContain("not a git repository");
  });
});
