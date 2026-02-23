import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: []
  },
  window: {
    activeTextEditor: undefined
  },
  env: {
    language: "en"
  },
  languages: {
    getDiagnostics: () => []
  },
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3
  }
}));

import {
  buildWorkspaceSummaryPaths,
  collectExplicitFiles
} from "../src/nl/taskContext.js";

describe("taskContext helpers", () => {
  it("skips binary files and truncates oversized files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codexbridge-task-context-"));
    try {
      await writeFile(path.join(root, "large.txt"), "a".repeat(20_000), "utf8");
      await writeFile(path.join(root, "binary.bin"), Buffer.from([0xff, 0x00, 0x01, 0x02]));
      const collected = await collectExplicitFiles(root, ["large.txt", "binary.bin"], {
        maxFiles: 10,
        maxFileBytes: 12_000,
        maxTotalBytes: 6_000
      });
      expect(collected.files).toHaveLength(1);
      expect(collected.files[0]?.path).toBe("large.txt");
      expect(collected.files[0]?.truncated).toBe(true);
      expect(Buffer.byteLength(collected.files[0]?.content || "", "utf8")).toBeLessThanOrEqual(6_000);
      expect(collected.totalBytes).toBeLessThanOrEqual(6_000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("enforces maxTotalBytes across multiple files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codexbridge-task-context-total-"));
    try {
      await writeFile(path.join(root, "a.txt"), "a".repeat(5_000), "utf8");
      await writeFile(path.join(root, "b.txt"), "b".repeat(5_000), "utf8");
      const collected = await collectExplicitFiles(root, ["a.txt", "b.txt"], {
        maxFiles: 10,
        maxFileBytes: 5_000,
        maxTotalBytes: 6_000
      });
      expect(collected.files).toHaveLength(2);
      expect(collected.totalBytes).toBeLessThanOrEqual(6_000);
      expect(Buffer.byteLength(collected.files[1]?.content || "", "utf8")).toBeLessThanOrEqual(1_000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("builds workspace summary with paths only", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codexbridge-task-context-summary-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(path.join(root, "src", "a.ts"), "const TOP_SECRET = 'dont-leak';", "utf8");
      const summary = await buildWorkspaceSummaryPaths(root, 20);
      expect(summary).toContain("src/");
      expect(summary).toContain("src/a.ts");
      expect(summary.some((line) => line.includes("dont-leak"))).toBe(false);
      expect(summary.some((line) => line.includes("TOP_SECRET"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores TodoList.txt in explicit files and workspace summary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codexbridge-task-context-ignore-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(path.join(root, "TodoList.txt"), "personal notes", "utf8");
      await writeFile(path.join(root, "src", "main.ts"), "export const ok = true;", "utf8");

      const collected = await collectExplicitFiles(root, ["TodoList.txt", "src/main.ts"], {
        maxFiles: 10,
        maxFileBytes: 12_000,
        maxTotalBytes: 12_000
      });
      expect(collected.files.map((item) => item.path)).toEqual(["src/main.ts"]);

      const summary = await buildWorkspaceSummaryPaths(root, 20);
      expect(summary).toContain("src/");
      expect(summary).toContain("src/main.ts");
      expect(summary).not.toContain("TodoList.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
