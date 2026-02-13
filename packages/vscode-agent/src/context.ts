import { promises as fs } from "node:fs";
import path from "node:path";

export type PatchContext = {
  workspaceRoot: string;
  prompt: string;
  files: Array<{
    path: string;
    content: string;
  }>;
  summary: string;
  runtime?: RuntimeContextSnapshot;
};

export type RuntimeContextSnapshot = {
  activeFilePath?: string;
  activeFileContent?: string;
  selectedText?: string;
  languageId?: string;
};

export async function buildPatchContext(
  workspaceRoot: string,
  prompt: string,
  runtime?: RuntimeContextSnapshot
): Promise<PatchContext> {
  const requestedFiles = extractFileCandidates(prompt);
  const files: Array<{ path: string; content: string }> = [];
  const maxFiles = Number(process.env.CONTEXT_MAX_FILES ?? "3");
  const maxChars = Number(process.env.CONTEXT_MAX_FILE_CHARS ?? "12000");
  const used = new Set<string>();

  if (runtime?.activeFilePath && runtime.activeFileContent) {
    files.push({
      path: runtime.activeFilePath,
      content: runtime.activeFileContent.slice(0, maxChars)
    });
    used.add(runtime.activeFilePath);
  }

  for (const relPath of requestedFiles.slice(0, maxFiles)) {
    if (used.has(relPath)) {
      continue;
    }
    const absolute = safeWorkspacePath(workspaceRoot, relPath);
    try {
      const raw = await fs.readFile(absolute, "utf8");
      files.push({
        path: relPath,
        content: raw.slice(0, maxChars)
      });
      used.add(relPath);
    } catch {
      continue;
    }
  }

  const summary = await buildDirectorySummary(workspaceRoot);
  return {
    workspaceRoot,
    prompt,
    files,
    summary,
    runtime
  };
}

function extractFileCandidates(text: string): string[] {
  const found = new Set<string>();
  const regex = /(?:^|\s)([A-Za-z0-9_./-]+\.[A-Za-z0-9_+-]+)(?=\s|$)/g;
  for (const match of text.matchAll(regex)) {
    const value = match[1]?.trim();
    if (value) {
      found.add(value);
    }
  }
  return [...found];
}

function safeWorkspacePath(workspaceRoot: string, relPath: string): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, relPath);
  if (!(resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    throw new Error(`path traversal in context request: ${relPath}`);
  }
  return resolved;
}

async function buildDirectorySummary(workspaceRoot: string): Promise<string> {
  const maxEntries = Number(process.env.CONTEXT_SUMMARY_MAX_ENTRIES ?? "60");
  const lines: string[] = [];
  await walk(workspaceRoot, "", lines, maxEntries);
  return lines.join("\n");
}

async function walk(
  root: string,
  rel: string,
  out: string[],
  maxEntries: number
): Promise<void> {
  if (out.length >= maxEntries) {
    return;
  }
  const dirPath = path.join(root, rel);
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
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
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
      continue;
    }
    const entryRel = rel ? path.posix.join(rel.replaceAll("\\", "/"), entry.name) : entry.name;
    out.push(entry.isDirectory() ? `${entryRel}/` : entryRel);
    if (entry.isDirectory()) {
      await walk(root, entryRel, out, maxEntries);
    }
  }
}
