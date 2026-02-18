import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import type { RuntimeContextSnapshot } from "../context.js";
import type { UIContextRequest } from "./chatProtocol.js";

export type CollectedChatContext = {
  request: Required<Pick<UIContextRequest, "includeActiveFile" | "includeSelection" | "includeWorkspaceSummary">> & {
    files: string[];
  };
  runtime: RuntimeContextSnapshot | undefined;
  renderedContext: string;
};

export async function collectChatContext(
  request: UIContextRequest
): Promise<CollectedChatContext> {
  const normalized = normalizeRequest(request);
  const editor = vscode.window.activeTextEditor;
  const workspaceRoot = resolveWorkspaceRoot();
  const runtime: RuntimeContextSnapshot = {
    workspaceRoot,
    uiLanguage: vscode.env.language
  };

  const sections: string[] = [];
  const maxFileBytes = 12_000;

  if (normalized.includeActiveFile && editor && workspaceRoot) {
    const rel = toWorkspaceRelativePath(workspaceRoot, editor.document.uri.fsPath);
    if (rel) {
      runtime.activeFilePath = rel;
      runtime.activeFileContent = clipByBytes(editor.document.getText(), maxFileBytes);
      runtime.languageId = editor.document.languageId;
      sections.push(`Active file: ${rel}`);
      sections.push(runtime.activeFileContent);
    }
  }

  if (normalized.includeSelection && editor && !editor.selection.isEmpty) {
    runtime.selectedText = clip(editor.document.getText(editor.selection), 6000);
    sections.push("Selection:");
    sections.push(runtime.selectedText);
  }

  const explicitFiles = await collectExplicitFiles(workspaceRoot, normalized.files, maxFileBytes);
  if (explicitFiles.length > 0) {
    sections.push("Explicit files:");
    for (const file of explicitFiles) {
      sections.push(`FILE ${file.path}`);
      sections.push(file.content);
    }
  }

  if (normalized.includeWorkspaceSummary && workspaceRoot) {
    const summary = await buildWorkspaceSummary(workspaceRoot);
    sections.push("Workspace summary (path size-bytes):");
    sections.push(summary);
  }

  return {
    request: normalized,
    runtime,
    renderedContext: sections.join("\n\n").trim()
  };
}

function normalizeRequest(request: UIContextRequest): CollectedChatContext["request"] {
  const editor = vscode.window.activeTextEditor;
  return {
    includeActiveFile: request.includeActiveFile ?? true,
    includeSelection: request.includeSelection ?? Boolean(editor && !editor.selection.isEmpty),
    includeWorkspaceSummary: request.includeWorkspaceSummary ?? true,
    files: (request.files ?? []).slice(0, 10)
  };
}

async function collectExplicitFiles(
  workspaceRoot: string | undefined,
  files: string[],
  maxFileBytes: number
): Promise<Array<{ path: string; content: string }>> {
  if (!workspaceRoot || files.length === 0) {
    return [];
  }
  const output: Array<{ path: string; content: string }> = [];
  for (const filePath of files) {
    const safePath = safeWorkspacePath(workspaceRoot, filePath);
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(safePath);
    } catch {
      continue;
    }
    if (isBinaryBuffer(buffer)) {
      continue;
    }
    output.push({
      path: filePath.replaceAll("\\", "/"),
      content: clip(buffer.toString("utf8"), maxFileBytes)
    });
  }
  return output;
}

async function buildWorkspaceSummary(workspaceRoot: string): Promise<string> {
  const lines: string[] = [];
  await walk(workspaceRoot, "", lines, 120);
  return lines.join("\n");
}

async function walk(root: string, rel: string, out: string[], maxEntries: number): Promise<void> {
  if (out.length >= maxEntries) {
    return;
  }
  const dirPath = rel ? path.join(root, rel) : root;
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
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
    const entryRel = rel ? `${rel.replaceAll("\\", "/")}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(`${entryRel}/`);
      await walk(root, entryRel, out, maxEntries);
      continue;
    }
    try {
      const stat = await fs.stat(path.join(root, entryRel));
      out.push(`${entryRel} ${stat.size}`);
    } catch {
      out.push(`${entryRel} ?`);
    }
  }
}

function resolveWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function toWorkspaceRelativePath(workspaceRoot: string, absoluteFilePath: string): string | undefined {
  const rel = path.relative(workspaceRoot, absoluteFilePath).replaceAll("\\", "/");
  if (!rel || rel.startsWith("..")) {
    return undefined;
  }
  return rel;
}

function safeWorkspacePath(workspaceRoot: string, relPath: string): string {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, relPath);
  if (!(target === root || target.startsWith(`${root}${path.sep}`))) {
    throw new Error(`path traversal detected: ${relPath}`);
  }
  return target;
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars);
}

function clipByBytes(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) {
    return value;
  }
  return buffer.subarray(0, maxBytes).toString("utf8");
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
