import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
});
