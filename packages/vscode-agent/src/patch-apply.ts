import { promises as fs } from "node:fs";
import path from "node:path";

type Hunk = {
  oldStart: number;
  lines: string[];
};

type FilePatch = {
  oldPath: string;
  newPath: string;
  hunks: Hunk[];
};

export async function applyUnifiedDiff(diff: string, workspaceRoot: string): Promise<string[]> {
  const patches = parseUnifiedDiff(diff);
  const changedPaths: string[] = [];

  for (const patch of patches) {
    const oldIsNull = patch.oldPath === "/dev/null";
    const newIsNull = patch.newPath === "/dev/null";

    if (newIsNull) {
      const deletePath = safeWorkspacePath(workspaceRoot, patch.oldPath);
      await fs.rm(deletePath, { force: true });
      changedPaths.push(relativeDisplay(workspaceRoot, deletePath));
      continue;
    }

    const targetPath = safeWorkspacePath(workspaceRoot, patch.newPath);
    const original = oldIsNull ? "" : await readUtf8OrEmpty(safeWorkspacePath(workspaceRoot, patch.oldPath));
    const next = applyPatchToText(original, patch);
    await atomicWriteFile(targetPath, next);
    changedPaths.push(relativeDisplay(workspaceRoot, targetPath));
  }

  return changedPaths;
}

function parseUnifiedDiff(input: string): FilePatch[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const patches: FilePatch[] = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].startsWith("diff --git ")) {
      const parsed = parsePatchBlockWithDiffGit(lines, i);
      patches.push(parsed.patch);
      i = parsed.nextIndex;
      continue;
    }

    if (lines[i].startsWith("--- ")) {
      const parsed = parsePatchBlockWithoutDiffGit(lines, i);
      patches.push(parsed.patch);
      i = parsed.nextIndex;
      continue;
    }

    i += 1;
  }

  if (patches.length === 0) {
    throw new Error("invalid diff: no file patch found");
  }
  return patches;
}

function parsePatchBlockWithDiffGit(
  lines: string[],
  startIndex: number
): { patch: FilePatch; nextIndex: number } {
  let i = startIndex;
  const diffLine = lines[i];
  const parts = diffLine.split(" ");
  const oldPath = trimPatchPath(parts[2] ?? "");
  const newPath = trimPatchPath(parts[3] ?? "");
  i += 1;

  while (i < lines.length && !lines[i].startsWith("--- ")) {
    if (lines[i].startsWith("diff --git ")) {
      break;
    }
    i += 1;
  }

  let headerOldPath = oldPath;
  let headerNewPath = newPath;
  if (i < lines.length && lines[i].startsWith("--- ")) {
    headerOldPath = trimPatchPath(lines[i].slice(4).trim());
    i += 1;
  }
  if (i < lines.length && lines[i].startsWith("+++ ")) {
    headerNewPath = trimPatchPath(lines[i].slice(4).trim());
    i += 1;
  }

  const hunks = parseHunks(lines, i);
  i = hunks.nextIndex;
  return {
    patch: {
      oldPath: headerOldPath,
      newPath: headerNewPath,
      hunks: hunks.hunks
    },
    nextIndex: i
  };
}

function parsePatchBlockWithoutDiffGit(
  lines: string[],
  startIndex: number
): { patch: FilePatch; nextIndex: number } {
  let i = startIndex;
  const oldPath = trimPatchPath(lines[i].slice(4).trim());
  i += 1;
  if (i >= lines.length || !lines[i].startsWith("+++ ")) {
    throw new Error("invalid diff: expected +++ after ---");
  }
  const newPath = trimPatchPath(lines[i].slice(4).trim());
  i += 1;

  const hunks = parseHunks(lines, i);
  return {
    patch: {
      oldPath,
      newPath,
      hunks: hunks.hunks
    },
    nextIndex: hunks.nextIndex
  };
}

function parseHunks(lines: string[], startIndex: number): { hunks: Hunk[]; nextIndex: number } {
  let i = startIndex;
  const hunks: Hunk[] = [];

  while (
    i < lines.length &&
    !lines[i].startsWith("diff --git ") &&
    !lines[i].startsWith("--- ")
  ) {
    const line = lines[i];
    if (!line.startsWith("@@")) {
      i += 1;
      continue;
    }
    const oldStart = parseOldStart(line);
    i += 1;
    const hunkLines: string[] = [];
    while (
      i < lines.length &&
      !lines[i].startsWith("@@") &&
      !lines[i].startsWith("diff --git ") &&
      !lines[i].startsWith("--- ")
    ) {
      const hunkLine = lines[i];
      if (hunkLine.startsWith("\\ No newline at end of file")) {
        i += 1;
        continue;
      }
      hunkLines.push(hunkLine);
      i += 1;
    }
    hunks.push({ oldStart, lines: hunkLines });
  }

  return { hunks, nextIndex: i };
}

function parseOldStart(hunkHeader: string): number {
  const match = /^@@\s*-(\d+)(?:,\d+)?\s+\+\d+(?:,\d+)?\s*@@/.exec(hunkHeader);
  if (!match) {
    throw new Error(`invalid hunk header: ${hunkHeader}`);
  }
  return Number(match[1]);
}

function applyPatchToText(sourceText: string, patch: FilePatch): string {
  const eol = detectEol(sourceText);
  const normalizedSource = sourceText.replace(/\r\n/g, "\n");
  const sourceLines = normalizedSource === "" ? [] : normalizedSource.split("\n");
  const out: string[] = [];
  let cursor = 0;

  for (const hunk of patch.hunks) {
    const targetStart = Math.max(0, hunk.oldStart - 1);
    if (targetStart < cursor) {
      throw new Error(`overlapping hunks for ${patch.newPath}`);
    }
    out.push(...sourceLines.slice(cursor, targetStart));
    cursor = targetStart;

    for (const line of hunk.lines) {
      const marker = line[0];
      const payload = line.slice(1);
      if (marker === " ") {
        if (sourceLines[cursor] !== payload) {
          throw new Error(`context mismatch for ${patch.newPath}`);
        }
        out.push(payload);
        cursor += 1;
        continue;
      }
      if (marker === "-") {
        if (sourceLines[cursor] !== payload) {
          throw new Error(`delete mismatch for ${patch.newPath}`);
        }
        cursor += 1;
        continue;
      }
      if (marker === "+") {
        out.push(payload);
        continue;
      }
      throw new Error(`invalid hunk line: ${line}`);
    }
  }

  out.push(...sourceLines.slice(cursor));
  const merged = out.join("\n");
  if (eol === "\r\n") {
    return merged.replace(/\n/g, "\r\n");
  }
  return merged;
}

function detectEol(sourceText: string): "\n" | "\r\n" {
  if (sourceText.includes("\r\n")) {
    return "\r\n";
  }
  return "\n";
}

function trimPatchPath(value: string): string {
  if (value === "/dev/null") {
    return value;
  }
  return value.replace(/^a\//, "").replace(/^b\//, "");
}

function safeWorkspacePath(workspaceRoot: string, patchPath: string): string {
  if (!patchPath || patchPath === "/dev/null") {
    throw new Error("invalid patch path");
  }
  if (patchPath.includes("\0")) {
    throw new Error("invalid null byte in patch path");
  }
  const root = path.resolve(workspaceRoot);
  const candidate = path.resolve(root, patchPath);
  if (!(candidate === root || candidate.startsWith(`${root}${path.sep}`))) {
    throw new Error(`path traversal detected: ${patchPath}`);
  }
  return candidate;
}

async function atomicWriteFile(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${targetPath}.codexbridge.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tmpPath, content, "utf8");
  await fs.rename(tmpPath, targetPath);
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

function relativeDisplay(root: string, fullPath: string): string {
  return path.relative(path.resolve(root), fullPath) || ".";
}
