import { promises as fs } from "node:fs";
import path from "node:path";
import { applyPatchToText, parseUnifiedDiff, type FilePatch } from "./diff/unifiedDiff.js";

type TargetSnapshot = {
  existed: boolean;
  content: string;
};

type PreparedOperation = {
  displayPath: string;
  targetPath: string;
  nextContent: string | undefined;
  snapshot: TargetSnapshot;
};

export async function applyUnifiedDiff(diff: string, workspaceRoot: string): Promise<string[]> {
  const patches = parseUnifiedDiff(diff);
  const operations = await prepareOperations(patches, workspaceRoot);
  await applyOperationsWithRollback(operations);
  return operations.map((item) => item.displayPath);
}

async function prepareOperations(
  patches: FilePatch[],
  workspaceRoot: string
): Promise<PreparedOperation[]> {
  const operations: PreparedOperation[] = [];
  for (const patch of patches) {
    const oldIsNull = patch.oldPath === "/dev/null";
    const newIsNull = patch.newPath === "/dev/null";

    const oldAbsolute = oldIsNull ? undefined : safeWorkspacePath(workspaceRoot, patch.oldPath);
    const targetPath = newIsNull
      ? safeWorkspacePath(workspaceRoot, patch.oldPath)
      : safeWorkspacePath(workspaceRoot, patch.newPath);

    const original = oldAbsolute ? await readUtf8OrEmpty(oldAbsolute) : "";
    const nextContent = newIsNull ? undefined : applyPatchToText(original, patch);
    const snapshot = await snapshotTargetPath(targetPath);
    operations.push({
      displayPath: relativeDisplay(workspaceRoot, targetPath),
      targetPath,
      nextContent,
      snapshot
    });
  }
  return operations;
}

async function applyOperationsWithRollback(operations: PreparedOperation[]): Promise<void> {
  const applied: PreparedOperation[] = [];
  try {
    for (const operation of operations) {
      if (operation.nextContent === undefined) {
        await fs.rm(operation.targetPath, { force: true });
      } else {
        await atomicWriteFile(operation.targetPath, operation.nextContent);
      }
      applied.push(operation);
    }
  } catch (error) {
    for (let i = applied.length - 1; i >= 0; i -= 1) {
      const operation = applied[i];
      try {
        if (operation.snapshot.existed) {
          await atomicWriteFile(operation.targetPath, operation.snapshot.content);
        } else {
          await fs.rm(operation.targetPath, { force: true });
        }
      } catch {
        // Best-effort rollback; keep original failure.
      }
    }
    throw error;
  }
}

async function snapshotTargetPath(targetPath: string): Promise<TargetSnapshot> {
  try {
    const content = await fs.readFile(targetPath, "utf8");
    return {
      existed: true,
      content
    };
  } catch (error: unknown) {
    const maybe = error as { code?: string };
    if (maybe.code === "ENOENT") {
      return {
        existed: false,
        content: ""
      };
    }
    throw error;
  }
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
  let renamed = false;
  try {
    await renameWithRetry(tmpPath, targetPath);
    renamed = true;
    return;
  } catch (error) {
    if (!isRenameContentionError(error)) {
      throw error;
    }
    await writeFileInPlaceFallback(targetPath, content, error);
  } finally {
    if (!renamed) {
      await fs.rm(tmpPath, { force: true });
    }
  }
}

async function renameWithRetry(tmpPath: string, targetPath: string): Promise<void> {
  let lastError: unknown;
  const retryDelaysMs = [20, 40, 80, 120, 200];
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      await fs.rename(tmpPath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isRenameContentionError(error) || attempt === retryDelaysMs.length) {
        throw error;
      }
      await sleepMs(retryDelaysMs[attempt]);
    }
  }
  throw lastError;
}

function isRenameContentionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

async function writeFileInPlaceFallback(
  targetPath: string,
  content: string,
  renameError: unknown
): Promise<void> {
  try {
    await fs.writeFile(targetPath, content, "utf8");
  } catch (error) {
    const renameDetail = describeErr(renameError);
    const fallbackDetail = describeErr(error);
    throw new Error(
      `failed to replace file after rename contention: target=${targetPath}; rename=${renameDetail}; fallbackWrite=${fallbackDetail}`
    );
  }
}

function describeErr(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
