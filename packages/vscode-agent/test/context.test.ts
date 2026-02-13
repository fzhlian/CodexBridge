import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildPatchContext } from "../src/context.js";

describe("buildPatchContext", () => {
  it("prioritizes runtime active file context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codexbridge-ctx-"));
    try {
      await writeFile(path.join(root, "a.ts"), "const a = 1;", "utf8");
      const context = await buildPatchContext(root, "update a.ts", {
        activeFilePath: "a.ts",
        activeFileContent: "const a = 2;",
        selectedText: "a = 2",
        languageId: "typescript"
      });

      expect(context.files[0]?.path).toBe("a.ts");
      expect(context.files[0]?.content).toContain("const a = 2");
      expect(context.runtime?.languageId).toBe("typescript");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

