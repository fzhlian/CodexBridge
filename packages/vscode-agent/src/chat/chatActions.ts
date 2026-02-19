import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { applyPatchToText, parseUnifiedDiff, summarizeUnifiedDiff } from "../diff/unifiedDiff.js";
import type { VirtualDiffDocumentProvider } from "../diff/virtualDocs.js";
import { t } from "../i18n/messages.js";
import { requestApproval, type ApprovalSource } from "../nl/approvalGate.js";
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

export type RunCommandResult = {
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
    return { ok: false, message: t("chatActions.error.diffNotFound", { diffId }) };
  }

  const candidates = await buildPreviewCandidates(record.unifiedDiff, workspaceRoot);
  if (candidates.length === 0) {
    return { ok: false, message: t("chatActions.error.diffNoPreviewableFiles") };
  }

  let selected = candidates[0];
  if (candidates.length > 1) {
    const choice = await vscode.window.showQuickPick(
      candidates.map((item) => ({
        label: item.path,
        description: `+${item.additions} -${item.deletions}`
      })),
      { placeHolder: t("chatActions.prompt.selectDiffPreviewFile") }
    );
    if (!choice) {
      return { ok: false, message: t("chatActions.error.diffPreviewCancelled") };
    }
    const matched = candidates.find((item) => item.path === choice.label);
    if (!matched) {
      return { ok: false, message: t("chatActions.error.selectedDiffFileNotFound") };
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
  workspaceRoot: string,
  options: { source?: ApprovalSource; onApproved?: () => void } = {}
): Promise<ApplyDiffResult> {
  const record = diffStore.get(diffId);
  if (!record) {
    return { ok: false, rejected: false, message: t("chatActions.error.diffNotFound", { diffId }) };
  }
  const allowApply = vscode.workspace
    .getConfiguration("codexbridge")
    .get<boolean>("allowApplyPatch", true);
  if (!allowApply) {
    return {
      ok: false,
      rejected: true,
      message: t("chatActions.error.applyDisabled")
    };
  }

  const summaryLines = record.files.map((file) => `${file.path} (+${file.additions} -${file.deletions})`);
  const decision = await requestApproval({
    action: "apply_diff",
    source: options.source ?? "local_ui",
    approveLabel: t("chatActions.prompt.applyLabel"),
    details: [
      t("chatActions.prompt.applyDiffToWorkspace"),
      ...summaryLines.slice(0, 12),
      summaryLines.length > 12
        ? t("chatActions.prompt.moreFiles", { count: summaryLines.length - 12 })
        : ""
    ].filter(Boolean)
  });
  if (decision !== "approved") {
    return { ok: false, rejected: true, message: t("chatActions.error.applyRejected") };
  }
  options.onApproved?.();
  try {
    const changed = await applyUnifiedDiff(record.unifiedDiff, workspaceRoot);
    return { ok: true, rejected: false, message: `applied: ${changed.join(", ")}` };
  } catch (error) {
    return {
      ok: false,
      rejected: false,
      message: t("chatActions.error.applyFailed", {
        message: error instanceof Error ? error.message : String(error)
      })
    };
  }
}

export async function runTestWithConfirmation(
  workspaceRoot: string,
  commandInput?: string,
  options: { source?: ApprovalSource; onApproved?: () => void } = {}
): Promise<RunTestResult> {
  const allowRunTerminal = vscode.workspace
    .getConfiguration("codexbridge")
    .get<boolean>("allowRunTerminal", false);
  if (!allowRunTerminal) {
    return {
      ok: false,
      rejected: true,
      message: t("chatActions.error.testDisabled"),
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
      message: t("chatActions.error.testNotAllowed", { command: testCommand }),
      logs: ""
    };
  }

  const decision = await requestApproval({
    action: "run_command",
    source: options.source ?? "local_ui",
    approveLabel: t("chatActions.prompt.runTestLabel"),
    details: [
      `${t("chatActions.prompt.commandLabel")}: ${testCommand}`,
      `${t("chatActions.prompt.cwdLabel")}: ${workspaceRoot}`
    ]
  });
  if (decision !== "approved") {
    return {
      ok: false,
      rejected: true,
      message: t("chatActions.error.testRejected"),
      logs: ""
    };
  }
  options.onApproved?.();

  const result = await runCommandPreferVscodeTask(testCommand, workspaceRoot, "Run Test");
  if (result.cancelled) {
    return {
      ok: false,
      rejected: false,
      message: t("chatActions.error.testCancelled", { command: testCommand }),
      logs: result.outputTail
    };
  }
  if (result.timedOut) {
    return {
      ok: false,
      rejected: false,
      message: t("chatActions.error.testTimedOut", { command: testCommand }),
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

export async function runCommandWithConfirmation(
  workspaceRoot: string,
  commandInput: string,
  options: {
    title?: string;
    requireAllowRunTerminal?: boolean;
    source?: ApprovalSource;
    onApproved?: () => void;
  } = {}
): Promise<RunCommandResult> {
  const requireAllowRunTerminal = options.requireAllowRunTerminal ?? true;
  if (requireAllowRunTerminal) {
    const allowRunTerminal = vscode.workspace
      .getConfiguration("codexbridge")
      .get<boolean>("allowRunTerminal", false);
    if (!allowRunTerminal) {
      return {
        ok: false,
        rejected: true,
        message: t("chatActions.error.commandDisabled"),
        logs: ""
      };
    }
  }

  const command = commandInput.trim();
  if (!command) {
    return {
      ok: false,
      rejected: true,
      message: t("chatActions.error.commandEmpty"),
      logs: ""
    };
  }

  const decision = await requestApproval({
    action: "run_command",
    source: options.source ?? "local_ui",
    approveLabel: options.title || t("chatActions.prompt.runCommandLabel"),
    details: [
      `${t("chatActions.prompt.commandLabel")}: ${command}`,
      `${t("chatActions.prompt.cwdLabel")}: ${workspaceRoot}`
    ]
  });
  if (decision !== "approved") {
    return {
      ok: false,
      rejected: true,
      message: t("chatActions.error.commandRejected"),
      logs: ""
    };
  }
  options.onApproved?.();

  const result = await runCommandPreferVscodeTask(command, workspaceRoot, options.title || "Run Command");
  if (result.cancelled) {
    return {
      ok: false,
      rejected: false,
      message: t("chatActions.error.commandCancelled", { command }),
      logs: result.outputTail
    };
  }
  if (result.timedOut) {
    return {
      ok: false,
      rejected: false,
      message: t("chatActions.error.commandTimedOut", { command }),
      logs: result.outputTail
    };
  }
  const ok = result.code === 0;
  return {
    ok,
    rejected: false,
    message: `command exit=${result.code} command=${command}`,
    logs: result.outputTail
  };
}

async function runCommandPreferVscodeTask(
  command: string,
  workspaceRoot: string,
  taskName: string
): Promise<{ code: number | null; cancelled: boolean; timedOut: boolean; outputTail: string }> {
  const taskResult = await runCommandViaVscodeTask(command, workspaceRoot, taskName);
  if (taskResult.supported) {
    return {
      code: taskResult.exitCode,
      cancelled: taskResult.cancelled,
      timedOut: taskResult.timedOut,
      outputTail: taskResult.logs
    };
  }
  return runTestCommand(command, undefined, workspaceRoot);
}

async function runCommandViaVscodeTask(
  command: string,
  workspaceRoot: string,
  taskName: string
): Promise<{
  supported: boolean;
  exitCode: number | null;
  cancelled: boolean;
  timedOut: boolean;
  logs: string;
}> {
  if (!vscode.tasks || !vscode.ShellExecution || !vscode.Task) {
    return {
      supported: false,
      exitCode: null,
      cancelled: false,
      timedOut: false,
      logs: ""
    };
  }

  try {
    if (!vscode.CustomExecution || !vscode.EventEmitter) {
      return {
        supported: false,
        exitCode: null,
        cancelled: false,
        timedOut: false,
        logs: ""
      };
    }
    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<number>();
    const runPromise = new Promise<{
      code: number | null;
      cancelled: boolean;
      timedOut: boolean;
      logs: string;
    }>((resolve) => {
      const pseudoTerminal: vscode.Pseudoterminal = {
        onDidWrite: writeEmitter.event,
        onDidClose: closeEmitter.event,
        open: () => {
          void (async () => {
            const result = await runTestCommand(command, undefined, workspaceRoot);
            if (result.outputTail) {
              writeEmitter.fire(result.outputTail.replace(/\n/g, "\r\n"));
            }
            closeEmitter.fire(result.code ?? 1);
            resolve({
              code: result.code,
              cancelled: result.cancelled,
              timedOut: result.timedOut,
              logs: result.outputTail
            });
          })();
        },
        close: () => undefined
      };
      const scope = vscode.workspace.workspaceFolders?.[0] ?? vscode.TaskScope.Workspace;
      const task = new vscode.Task(
        { type: "codexbridge-custom-shell" },
        scope,
        taskName,
        "codexbridge",
        new vscode.CustomExecution(async () => pseudoTerminal)
      );
      task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Never,
        panel: vscode.TaskPanelKind.Dedicated,
        clear: false,
        focus: false,
        showReuseMessage: false
      };
      void vscode.tasks.executeTask(task).then(undefined, () => {
        resolve({
          code: null,
          cancelled: false,
          timedOut: false,
          logs: ""
        });
      });
    });

    const timeoutMs = Number(process.env.CODEX_TASK_TIMEOUT_MS ?? "900000");
    const completion = await Promise.race([
      runPromise,
      wait(timeoutMs).then(() => ({
        code: null,
        cancelled: false,
        timedOut: true,
        logs: ""
      }))
    ]);
    writeEmitter.dispose();
    closeEmitter.dispose();
    return {
      supported: true,
      exitCode: completion.code,
      cancelled: completion.cancelled,
      timedOut: completion.timedOut,
      logs: completion.logs
    };
  } catch {
    return {
      supported: false,
      exitCode: null,
      cancelled: false,
      timedOut: false,
      logs: ""
    };
  }
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
