import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyUnifiedDiff } from "../src/patch-apply.js";
import { collectExplicitFiles } from "../src/nl/taskContext.js";

const { runTestCommandMock, requestApprovalMock } = vi.hoisted(() => ({
  runTestCommandMock: vi.fn(),
  requestApprovalMock: vi.fn()
}));

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => {
        if (key === "allowRunTerminal") {
          return true;
        }
        return fallback;
      }
    }),
    workspaceFolders: []
  },
  tasks: undefined,
  window: {},
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

vi.mock("../src/test-runner.js", async () => {
  const actual = await vi.importActual("../src/test-runner.js");
  return {
    ...actual,
    runTestCommand: runTestCommandMock
  };
});

vi.mock("../src/nl/approvalGate.js", async () => {
  const actual = await vi.importActual("../src/nl/approvalGate.js");
  return {
    ...actual,
    requestApproval: requestApprovalMock
  };
});

import { runCommandWithConfirmation } from "../src/chat/chatActions.js";

describe("NL security regression", () => {
  beforeEach(() => {
    runTestCommandMock.mockReset();
    requestApprovalMock.mockReset();
  });

  it("rejects path traversal when applying diff", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codexbridge-nl-security-"));
    try {
      const diff = [
        "diff --git a/../../evil.txt b/../../evil.txt",
        "--- /dev/null",
        "+++ b/../../evil.txt",
        "@@ -0,0 +1 @@",
        "+boom"
      ].join("\n");
      await expect(applyUnifiedDiff(diff, root)).rejects.toThrow(/path traversal/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never executes command when local approval is rejected", async () => {
    requestApprovalMock.mockResolvedValue("rejected");
    const result = await runCommandWithConfirmation("D:/workspace", "pnpm test");
    expect(result.ok).toBe(false);
    expect(result.rejected).toBe(true);
    expect(runTestCommandMock).not.toHaveBeenCalled();
  });

  it("enforces context total byte limits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codexbridge-nl-context-limit-"));
    try {
      await writeFile(path.join(root, "a.txt"), "a".repeat(8_000), "utf8");
      await writeFile(path.join(root, "b.txt"), "b".repeat(8_000), "utf8");
      const collected = await collectExplicitFiles(root, ["a.txt", "b.txt"], {
        maxFiles: 10,
        maxFileBytes: 8_000,
        maxTotalBytes: 10_000
      });
      expect(collected.totalBytes).toBeLessThanOrEqual(10_000);
      expect(Buffer.byteLength(collected.files[0]?.content ?? "", "utf8")).toBeLessThanOrEqual(8_000);
      expect(Buffer.byteLength(collected.files[1]?.content ?? "", "utf8")).toBeLessThanOrEqual(2_000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
