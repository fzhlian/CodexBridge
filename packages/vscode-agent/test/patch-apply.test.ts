import { promises as fs } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applyUnifiedDiff } from "../src/patch-apply.js";

describe("applyUnifiedDiff", () => {
  it("applies add-file patch atomically", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codexbridge-"));
    try {
      const diff = [
        "diff --git a/notes.txt b/notes.txt",
        "--- /dev/null",
        "+++ b/notes.txt",
        "@@ -0,0 +1,2 @@",
        "+line1",
        "+line2"
      ].join("\n");

      const changed = await applyUnifiedDiff(diff, root);
      expect(changed).toEqual(["notes.txt"]);

      const content = await readFile(path.join(root, "notes.txt"), "utf8");
      expect(content).toBe("line1\nline2");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects traversal path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codexbridge-"));
    try {
      const diff = [
        "diff --git a/../../evil.txt b/../../evil.txt",
        "--- /dev/null",
        "+++ b/../../evil.txt",
        "@@ -0,0 +1 @@",
        "+x"
      ].join("\n");
      await expect(applyUnifiedDiff(diff, root)).rejects.toThrow(/path traversal/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies unified diff without diff-git header", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codexbridge-"));
    try {
      const diff = [
        "--- /dev/null",
        "+++ b/plain.patch.txt",
        "@@ -0,0 +1 @@",
        "+hello"
      ].join("\n");
      const changed = await applyUnifiedDiff(diff, root);
      expect(changed).toEqual(["plain.patch.txt"]);
      const content = await readFile(path.join(root, "plain.patch.txt"), "utf8");
      expect(content).toBe("hello");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies LF patch to CRLF source file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codexbridge-"));
    try {
      const filePath = path.join(root, "README.md");
      await writeFile(filePath, "line1\r\nline2\r\n", "utf8");
      const diff = [
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -2,1 +2,2 @@",
        " line2",
        "+line3"
      ].join("\n");

      const changed = await applyUnifiedDiff(diff, root);
      expect(changed).toEqual(["README.md"]);
      const content = await readFile(filePath, "utf8");
      expect(content).toBe("line1\r\nline2\r\nline3\r\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to in-place write when rename is blocked", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codexbridge-"));
    const filePath = path.join(root, "chat.js");
    const originalRename = fs.rename.bind(fs);
    let injected = false;
    const renameSpy = vi.spyOn(fs, "rename");
    try {
      await writeFile(filePath, "before\n", "utf8");
      const diff = [
        "diff --git a/chat.js b/chat.js",
        "--- a/chat.js",
        "+++ b/chat.js",
        "@@ -1,1 +1,1 @@",
        "-before",
        "+after"
      ].join("\n");

      renameSpy.mockImplementation(async (from, to) => {
        if (
          !injected
          && typeof from === "string"
          && from.includes(".codexbridge.tmp-")
          && to === filePath
        ) {
          injected = true;
          const error = new Error("locked by another process") as NodeJS.ErrnoException;
          error.code = "EPERM";
          throw error;
        }
        return originalRename(from, to);
      });

      const changed = await applyUnifiedDiff(diff, root);
      expect(changed).toEqual(["chat.js"]);
      expect(injected).toBe(true);
      const content = await readFile(filePath, "utf8");
      expect(content).toBe("after\n");
    } finally {
      renameSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
