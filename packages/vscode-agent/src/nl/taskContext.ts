import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import type { UIContextRequest } from "../chat/chatProtocol.js";
import type { RuntimeContextSnapshot } from "../context.js";
import type { TaskIntent } from "./taskTypes.js";

export type TaskContextLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxSelectionChars: number;
  maxWorkspaceEntries: number;
  maxDiagnostics: number;
  maxGitLines: number;
};

export const DEFAULT_TASK_CONTEXT_LIMITS: Readonly<TaskContextLimits> = Object.freeze({
  maxFiles: 10,
  maxFileBytes: 12_000,
  maxTotalBytes: 60_000,
  maxSelectionChars: 6_000,
  maxWorkspaceEntries: 120,
  maxDiagnostics: 100,
  maxGitLines: 80
});

export type NormalizedTaskContextRequest =
  Required<Pick<UIContextRequest, "includeActiveFile" | "includeSelection" | "includeWorkspaceSummary">> & {
    files: string[];
  };

export type TaskContextFile = {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
};

export type TaskContextDiagnostic = {
  path: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source?: string;
};

export type TaskContextGit = {
  branch?: string;
  changedFiles?: number;
  statusLines?: string[];
  diffStat?: string[];
};

export type TaskContextPayload = {
  activeFile?: TaskContextFile;
  selection?: string;
  explicitFiles: TaskContextFile[];
  workspaceSummary: string[];
  diagnostics: TaskContextDiagnostic[];
  git?: TaskContextGit;
};

export type CollectedTaskContext = {
  request: NormalizedTaskContextRequest;
  limits: TaskContextLimits;
  runtime: RuntimeContextSnapshot | undefined;
  context: TaskContextPayload;
  renderedContext: string;
};

export type ExplicitFileCollection = {
  files: TaskContextFile[];
  totalBytes: number;
};

export async function collectTaskContext(
  intent: TaskIntent,
  uiContextRequest: UIContextRequest,
  limitOverrides: Partial<TaskContextLimits> = {}
): Promise<CollectedTaskContext> {
  const limits = resolveTaskContextLimits(limitOverrides);
  const editor = vscode.window.activeTextEditor;
  const workspaceRoot = resolveWorkspaceRoot();
  const request = normalizeContextRequest(uiContextRequest, intent, editor, limits.maxFiles);

  const runtime: RuntimeContextSnapshot = {
    workspaceRoot,
    uiLanguage: vscode.env.language
  };
  const context: TaskContextPayload = {
    explicitFiles: [],
    workspaceSummary: [],
    diagnostics: []
  };

  let remainingBytes = limits.maxTotalBytes;

  if (request.includeActiveFile && editor && workspaceRoot && remainingBytes > 0) {
    const relPath = toWorkspaceRelativePath(workspaceRoot, editor.document.uri.fsPath);
    if (relPath) {
      const bounded = boundTextByBytes(editor.document.getText(), Math.min(limits.maxFileBytes, remainingBytes));
      if (bounded.bytes > 0) {
        context.activeFile = {
          path: relPath,
          content: bounded.text,
          bytes: bounded.bytes,
          truncated: bounded.truncated
        };
        runtime.activeFilePath = relPath;
        runtime.activeFileContent = bounded.text;
        runtime.languageId = editor.document.languageId;
        remainingBytes -= bounded.bytes;
      }
    }
  }

  if (request.includeSelection && editor && !editor.selection.isEmpty && remainingBytes > 0) {
    const selectedRaw = editor.document.getText(editor.selection).slice(0, limits.maxSelectionChars);
    const bounded = boundTextByBytes(selectedRaw, remainingBytes);
    if (bounded.bytes > 0) {
      context.selection = bounded.text;
      runtime.selectedText = bounded.text;
      remainingBytes -= bounded.bytes;
    }
  }

  const explicitCandidates = context.activeFile
    ? request.files.filter((item) => normalizeRelPath(item) !== context.activeFile?.path)
    : request.files;
  const explicit = await collectExplicitFiles(workspaceRoot, explicitCandidates, {
    maxFiles: limits.maxFiles,
    maxFileBytes: limits.maxFileBytes,
    maxTotalBytes: remainingBytes
  });
  context.explicitFiles = explicit.files;
  remainingBytes = Math.max(0, remainingBytes - explicit.totalBytes);

  if (request.includeWorkspaceSummary && workspaceRoot) {
    context.workspaceSummary = await buildWorkspaceSummaryPaths(workspaceRoot, limits.maxWorkspaceEntries);
  }
  context.diagnostics = collectWorkspaceDiagnostics(workspaceRoot, limits.maxDiagnostics);
  context.git = await collectGitContext(workspaceRoot, limits.maxGitLines);

  return {
    request,
    limits,
    runtime,
    context,
    renderedContext: renderTaskContext(intent, context)
  };
}

export function resolveTaskContextLimits(
  overrides: Partial<TaskContextLimits> = {}
): TaskContextLimits {
  return {
    maxFiles: clampLimit(overrides.maxFiles ?? readEnvLimit("CONTEXT_MAX_FILES", DEFAULT_TASK_CONTEXT_LIMITS.maxFiles)),
    maxFileBytes: clampLimit(
      overrides.maxFileBytes
      ?? readEnvLimit("CONTEXT_MAX_FILE_BYTES", readEnvLimit("CONTEXT_MAX_FILE_CHARS", DEFAULT_TASK_CONTEXT_LIMITS.maxFileBytes))
    ),
    maxTotalBytes: clampLimit(
      overrides.maxTotalBytes ?? readEnvLimit("CONTEXT_MAX_TOTAL_BYTES", DEFAULT_TASK_CONTEXT_LIMITS.maxTotalBytes)
    ),
    maxSelectionChars: clampLimit(
      overrides.maxSelectionChars ?? readEnvLimit("CONTEXT_MAX_SELECTION_CHARS", DEFAULT_TASK_CONTEXT_LIMITS.maxSelectionChars)
    ),
    maxWorkspaceEntries: clampLimit(
      overrides.maxWorkspaceEntries ?? readEnvLimit("CONTEXT_SUMMARY_MAX_ENTRIES", DEFAULT_TASK_CONTEXT_LIMITS.maxWorkspaceEntries)
    ),
    maxDiagnostics: clampLimit(
      overrides.maxDiagnostics ?? readEnvLimit("CONTEXT_MAX_DIAGNOSTICS", DEFAULT_TASK_CONTEXT_LIMITS.maxDiagnostics)
    ),
    maxGitLines: clampLimit(overrides.maxGitLines ?? readEnvLimit("CONTEXT_MAX_GIT_LINES", DEFAULT_TASK_CONTEXT_LIMITS.maxGitLines))
  };
}

export async function collectExplicitFiles(
  workspaceRoot: string | undefined,
  files: string[],
  limits: Pick<TaskContextLimits, "maxFiles" | "maxFileBytes" | "maxTotalBytes">
): Promise<ExplicitFileCollection> {
  if (!workspaceRoot || files.length === 0 || limits.maxTotalBytes <= 0) {
    return { files: [], totalBytes: 0 };
  }

  const output: TaskContextFile[] = [];
  const seen = new Set<string>();
  let remainingBytes = limits.maxTotalBytes;
  let totalBytes = 0;

  for (const rawPath of files) {
    if (output.length >= limits.maxFiles || remainingBytes <= 0) {
      break;
    }
    const sanitized = sanitizeFileCandidate(rawPath);
    if (!sanitized || seen.has(sanitized)) {
      continue;
    }
    seen.add(sanitized);

    let absolutePath: string;
    try {
      absolutePath = safeWorkspacePath(workspaceRoot, sanitized);
    } catch {
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(absolutePath);
    } catch {
      continue;
    }
    if (isBinaryBuffer(buffer)) {
      continue;
    }

    const cap = Math.min(limits.maxFileBytes, remainingBytes);
    if (cap <= 0) {
      break;
    }
    const bounded = boundBufferUtf8(buffer, cap);
    if (bounded.bytes <= 0) {
      continue;
    }

    output.push({
      path: normalizeRelPath(sanitized),
      content: bounded.text,
      bytes: bounded.bytes,
      truncated: bounded.truncated
    });
    totalBytes += bounded.bytes;
    remainingBytes -= bounded.bytes;
  }

  return {
    files: output,
    totalBytes
  };
}

export async function buildWorkspaceSummaryPaths(
  workspaceRoot: string,
  maxEntries: number
): Promise<string[]> {
  const lines: string[] = [];
  await walkWorkspace(workspaceRoot, "", lines, Math.max(1, maxEntries));
  return lines;
}

export function renderTaskContext(intent: TaskIntent, context: TaskContextPayload): string {
  const sections: string[] = [
    `Task intent: ${intent.kind}`,
    `Intent summary: ${intent.summary}`
  ];

  if (context.activeFile) {
    sections.push(`Active file: ${context.activeFile.path}`);
    sections.push(context.activeFile.content);
  }
  if (context.selection) {
    sections.push("Selection:");
    sections.push(context.selection);
  }
  if (context.explicitFiles.length > 0) {
    sections.push("Explicit files:");
    for (const file of context.explicitFiles) {
      sections.push(`FILE ${file.path}`);
      sections.push(file.content);
    }
  }
  if (context.workspaceSummary.length > 0) {
    sections.push("Workspace summary (paths only):");
    sections.push(context.workspaceSummary.join("\n"));
  }
  if (context.diagnostics.length > 0) {
    const diagnosticLines = context.diagnostics.map((item) =>
      `${item.severity.toUpperCase()} ${item.path}:${item.line}:${item.column} ${item.message}${item.source ? ` [${item.source}]` : ""}`
    );
    sections.push("Diagnostics:");
    sections.push(diagnosticLines.join("\n"));
  }
  if (context.git) {
    const gitLines: string[] = [];
    if (context.git.branch) {
      gitLines.push(`branch=${context.git.branch}`);
    }
    if (typeof context.git.changedFiles === "number") {
      gitLines.push(`changed_files=${context.git.changedFiles}`);
    }
    if (context.git.statusLines?.length) {
      gitLines.push("status:");
      gitLines.push(...context.git.statusLines);
    }
    if (context.git.diffStat?.length) {
      gitLines.push("diff_stat:");
      gitLines.push(...context.git.diffStat);
    }
    if (gitLines.length > 0) {
      sections.push("Git info:");
      sections.push(gitLines.join("\n"));
    }
  }
  return sections.join("\n\n").trim();
}

function normalizeContextRequest(
  request: UIContextRequest,
  intent: TaskIntent,
  editor: vscode.TextEditor | undefined,
  maxFiles: number
): NormalizedTaskContextRequest {
  const files = dedupeFiles([...(request.files ?? []), ...(intent.params?.files ?? [])]).slice(0, maxFiles);
  return {
    includeActiveFile: request.includeActiveFile ?? true,
    includeSelection: request.includeSelection ?? Boolean(editor && !editor.selection.isEmpty),
    includeWorkspaceSummary: request.includeWorkspaceSummary ?? true,
    files
  };
}

function dedupeFiles(values: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const sanitized = sanitizeFileCandidate(value);
    if (!sanitized || seen.has(sanitized)) {
      continue;
    }
    seen.add(sanitized);
    output.push(sanitized);
  }
  return output;
}

function sanitizeFileCandidate(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const unquoted = trimmed.replace(/^["'`]+|["'`]+$/g, "");
  const normalized = normalizeRelPath(unquoted.replace(/^\.\/+/, ""));
  if (!normalized || normalized.includes("\n") || normalized.includes("\r")) {
    return undefined;
  }
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    return undefined;
  }
  if (normalized.split("/").some((part) => part === "..")) {
    return undefined;
  }
  return normalized;
}

function collectWorkspaceDiagnostics(
  workspaceRoot: string | undefined,
  maxDiagnostics: number
): TaskContextDiagnostic[] {
  const all = vscode.languages.getDiagnostics();
  const output: TaskContextDiagnostic[] = [];
  for (const [uri, diagnostics] of all) {
    if (output.length >= maxDiagnostics) {
      break;
    }
    if (uri.scheme !== "file") {
      continue;
    }
    const relPath = workspaceRoot
      ? toWorkspaceRelativePath(workspaceRoot, uri.fsPath)
      : normalizeRelPath(uri.fsPath);
    if (!relPath) {
      continue;
    }
    for (const diagnostic of diagnostics) {
      if (output.length >= maxDiagnostics) {
        break;
      }
      output.push({
        path: relPath,
        line: diagnostic.range.start.line + 1,
        column: diagnostic.range.start.character + 1,
        severity: toDiagnosticSeverity(diagnostic.severity),
        message: toSingleLine(diagnostic.message, 240),
        source: diagnostic.source
      });
    }
  }
  return output;
}

async function collectGitContext(
  workspaceRoot: string | undefined,
  maxGitLines: number
): Promise<TaskContextGit | undefined> {
  if (!workspaceRoot) {
    return undefined;
  }
  const branch = await runProcess("git", ["-C", workspaceRoot, "rev-parse", "--abbrev-ref", "HEAD"]);
  const status = await runProcess("git", ["-C", workspaceRoot, "status", "--short"]);
  const diffStat = await runProcess("git", ["-C", workspaceRoot, "diff", "--stat", "--"]);
  if (!branch.ok && !status.ok && !diffStat.ok) {
    return undefined;
  }

  const statusLines = status.ok
    ? status.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, maxGitLines)
    : [];
  const diffLines = diffStat.ok
    ? diffStat.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, maxGitLines)
    : [];
  return {
    branch: branch.ok ? branch.stdout.trim() : undefined,
    changedFiles: statusLines.length,
    statusLines: statusLines.length > 0 ? statusLines : undefined,
    diffStat: diffLines.length > 0 ? diffLines : undefined
  };
}

async function walkWorkspace(
  workspaceRoot: string,
  relDir: string,
  out: string[],
  maxEntries: number
): Promise<void> {
  if (out.length >= maxEntries) {
    return;
  }

  const absoluteDir = relDir ? path.join(workspaceRoot, relDir) : workspaceRoot;
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= maxEntries) {
      return;
    }
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const entryRel = relDir ? `${normalizeRelPath(relDir)}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(`${entryRel}/`);
      await walkWorkspace(workspaceRoot, entryRel, out, maxEntries);
      continue;
    }
    out.push(normalizeRelPath(entryRel));
  }
}

function resolveWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function toWorkspaceRelativePath(workspaceRoot: string, absoluteFilePath: string): string | undefined {
  const relPath = normalizeRelPath(path.relative(workspaceRoot, absoluteFilePath));
  if (!relPath || relPath.startsWith("../") || relPath === "..") {
    return undefined;
  }
  return relPath;
}

function safeWorkspacePath(workspaceRoot: string, relPath: string): string {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, relPath);
  if (!(target === root || target.startsWith(`${root}${path.sep}`))) {
    throw new Error(`path traversal detected: ${relPath}`);
  }
  return target;
}

function boundBufferUtf8(buffer: Buffer, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  const bounded = buffer.subarray(0, Math.max(0, maxBytes));
  const text = bounded.toString("utf8");
  const bytes = Buffer.byteLength(text, "utf8");
  return {
    text,
    bytes,
    truncated: buffer.length > bytes
  };
}

function boundTextByBytes(text: string, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  const bounded = Buffer.from(text, "utf8").subarray(0, Math.max(0, maxBytes)).toString("utf8");
  const bytes = Buffer.byteLength(bounded, "utf8");
  return {
    text: bounded,
    bytes,
    truncated: Buffer.byteLength(text, "utf8") > bytes
  };
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const probe = buffer.subarray(0, Math.min(1024, buffer.length));
  for (const byte of probe) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

function toDiagnosticSeverity(value: vscode.DiagnosticSeverity): "error" | "warning" | "info" | "hint" {
  if (value === vscode.DiagnosticSeverity.Error) {
    return "error";
  }
  if (value === vscode.DiagnosticSeverity.Warning) {
    return "warning";
  }
  if (value === vscode.DiagnosticSeverity.Information) {
    return "info";
  }
  return "hint";
}

function normalizeRelPath(input: string): string {
  return input.replaceAll("\\", "/");
}

function toSingleLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function readEnvLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
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
    child.on("error", () => resolve({ ok: false, stdout: "", stderr: "" }));
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim()
      });
    });
  });
}
