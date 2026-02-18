import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { applyPatchToText, parseUnifiedDiff, summarizeUnifiedDiff } from "../diff/unifiedDiff.js";
import type { VirtualDiffDocumentProvider } from "../diff/virtualDocs.js";
import { applyUnifiedDiff } from "../patch-apply.js";
import { getDefaultTestCommand, isAllowedTestCommand, runTestCommand } from "../test-runner.js";
import type { Attachment } from "./chatProtocol.js";

type StoredDiff = {
  diffId: string;
  title?: string;
  unifiedDiff: string;
  files: ReturnType<typeof summarizeUnifiedDiff>;
};

export type ApplyDiffResult = {
  ok: boolean;
  rejected: boolean;
  message: string;
  details?: unknown;
};

export type RunTestResult = {
  ok: boolean;
  rejected: boolean;
  message: string;
  logs: string;
};

export class DiffStore {
  private readonly data = new Map<string, StoredDiff>();

  constructor(private readonly limit = 20) {}

  put(unifiedDiff: string, title?: string): StoredDiff {
    const diffId = randomUUID();
    const record: StoredDiff = {
      diffId,
      title,
      unifiedDiff,
      files: summarizeUnifiedDiff(unifiedDiff)
    };
    this.data.set(diffId, record);
    this.trim();
    return record;
  }

  get(diffId: string): StoredDiff | undefined {
    return this.data.get(diffId);
  }

  toAttachment(diffId: string): Attachment | undefined {
    const found = this.get(diffId);
    if (!found) {
      return undefined;
    }
    return {
      type: "diff",
      diffId: found.diffId,
      title: found.title,
      unifiedDiff: found.unifiedDiff,
      files: found.files
    };
  }

  private trim(): void {
    const overflow = this.data.size - this.limit;
    if (overflow <= 0) {
      return;
    }
    const ids = [...this.data.keys()].slice(0, overflow);
    for (const id of ids) {
      this.data.delete(id);
    }
  }
}

export async function viewDiff(
  diffStore: DiffStore,
  virtualDocs: VirtualDiffDocumentProvider,
  diffId: string,
  workspaceRoot: string
): Promise<{ ok: boolean; message: string }> {
  const record = diffStore.get(diffId);
  if (!record) {
    return { ok: false, message: `diff not found: ${diffId}` };
  }

  const candidates = await buildPreviewCandidates(record.unifiedDiff, workspaceRoot);
  if (candidates.length === 0) {
    return { ok: false, message: "diff has no previewable files" };
  }

  let selected = candidates[0];
  if (candidates.length > 1) {
    const choice = await vscode.window.showQuickPick(
      candidates.map((item) => ({
        label: item.path,
        description: `+${item.additions} -${item.deletions}`
      })),
      { placeHolder: "Select file to preview diff" }
    );
    if (!choice) {
      return { ok: false, message: "diff preview cancelled" };
    }
    const matched = candidates.find((item) => item.path === choice.label);
    if (!matched) {
      return { ok: false, message: "selected diff file not found" };
    }
    selected = matched;
  }

  const beforeUri = virtualDocs.createUri(diffId, "before", selected.path);
  const afterUri = virtualDocs.createUri(diffId, "after", selected.path);
  virtualDocs.setContent(beforeUri, selected.beforeText);
  virtualDocs.setContent(afterUri, selected.afterText);
  await vscode.commands.executeCommand(
    "vscode.diff",
    beforeUri,
    afterUri,
    `CodexBridge Diff: ${selected.path}`
  );
  return { ok: true, message: `opened diff for ${selected.path}` };
}

export async function applyDiffWithConfirmation(
  diffStore: DiffStore,
  diffId: string,
  workspaceRoot: string
): Promise<ApplyDiffResult> {
  const record = diffStore.get(diffId);
  if (!record) {
    return { ok: false, rejected: false, message: `diff not found: ${diffId}` };
  }
  const allowApply = vscode.workspace
    .getConfiguration("codexbridge")
    .get<boolean>("allowApplyPatch", true);
  if (!allowApply) {
    return {
      ok: false,
      rejected: true,
      message: "apply is disabled by codexbridge.allowApplyPatch"
    };
  }

  const summaryLines = record.files.map((file) => `${file.path} (+${file.additions} -${file.deletions})`);
  const yes = "Apply";
  const no = "Reject";
  const choice = await vscode.window.showWarningMessage(
    [
      "Apply diff to workspace?",
      ...summaryLines.slice(0, 12),
      summaryLines.length > 12 ? `... and ${summaryLines.length - 12} more files` : ""
    ].filter(Boolean).join("\n"),
    { modal: true },
    yes,
    no
  );
  if (choice !== yes) {
    return { ok: false, rejected: true, message: "apply rejected by local user" };
  }
  try {
    const changed = await applyUnifiedDiff(record.unifiedDiff, workspaceRoot);
    return { ok: true, rejected: false, message: `applied: ${changed.join(", ")}` };
  } catch (error) {
    return {
      ok: false,
      rejected: false,
      message: `apply failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function runTestWithConfirmation(
  workspaceRoot: string,
  commandInput?: string
): Promise<RunTestResult> {
  const allowRunTerminal = vscode.workspace
    .getConfiguration("codexbridge")
    .get<boolean>("allowRunTerminal", false);
  if (!allowRunTerminal) {
    return {
      ok: false,
      rejected: true,
      message: "test execution is disabled by codexbridge.allowRunTerminal",
      logs: ""
    };
  }

  const configuredDefault = vscode.workspace
    .getConfiguration("codexbridge")
    .get<string>("defaultTestCommand", getDefaultTestCommand());
  const testCommand = commandInput?.trim() || configuredDefault || getDefaultTestCommand();
  if (!isAllowedTestCommand(testCommand)) {
    return {
      ok: false,
      rejected: true,
      message: `test command not allowed: ${testCommand}`,
      logs: ""
    };
  }

  const yes = "Run Test";
  const no = "Reject";
  const choice = await vscode.window.showWarningMessage(
    `Execute test command?\ncommand: ${testCommand}\ncwd: ${workspaceRoot}`,
    { modal: true },
    yes,
    no
  );
  if (choice !== yes) {
    return {
      ok: false,
      rejected: true,
      message: "test execution rejected by local user",
      logs: ""
    };
  }

  const result = await runTestCommand(testCommand, undefined, workspaceRoot);
  if (result.cancelled) {
    return {
      ok: false,
      rejected: false,
      message: `test cancelled: ${testCommand}`,
      logs: result.outputTail
    };
  }
  if (result.timedOut) {
    return {
      ok: false,
      rejected: false,
      message: `test timed out: ${testCommand}`,
      logs: result.outputTail
    };
  }
  const ok = result.code === 0;
  return {
    ok,
    rejected: false,
    message: `test exit=${result.code} command=${testCommand}`,
    logs: result.outputTail
  };
}

type DiffPreviewCandidate = {
  path: string;
  additions: number;
  deletions: number;
  beforeText: string;
  afterText: string;
};

async function buildPreviewCandidates(
  unifiedDiff: string,
  workspaceRoot: string
): Promise<DiffPreviewCandidate[]> {
  const patches = parseUnifiedDiff(unifiedDiff);
  const summaries = summarizeUnifiedDiff(unifiedDiff);
  const candidates: DiffPreviewCandidate[] = [];
  for (let i = 0; i < patches.length; i += 1) {
    const patch = patches[i];
    const summary = summaries[i];
    const sourcePath = patch.oldPath === "/dev/null" ? undefined : safeWorkspacePath(workspaceRoot, patch.oldPath);
    const beforeText = sourcePath ? await readUtf8OrEmpty(sourcePath) : "";
    const afterText = patch.newPath === "/dev/null" ? "" : applyPatchToText(beforeText, patch);
    candidates.push({
      path: summary?.path ?? patch.newPath,
      additions: summary?.additions ?? 0,
      deletions: summary?.deletions ?? 0,
      beforeText,
      afterText
    });
  }
  return candidates;
}

function safeWorkspacePath(workspaceRoot: string, relPath: string): string {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, relPath);
  if (!(target === root || target.startsWith(`${root}${path.sep}`))) {
    throw new Error(`path traversal detected: ${relPath}`);
  }
  return target;
}

async function readUtf8OrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error: unknown) {
    const maybe = error as { code?: string };
    if (maybe.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}
