import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { runTask } from "../src/nl/taskRunner.js";
import type { TaskIntent } from "../src/nl/taskTypes.js";

const tempWorkspaceRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempWorkspaceRoots.map(async (root) => {
      await fs.rm(root, { recursive: true, force: true });
    })
  );
  tempWorkspaceRoots.length = 0;
});

describe("runTask run command resolution", () => {
  it("uses package-scoped packaging script for generic repackage requests", async () => {
    const workspaceRoot = await createWorkspace({
      "package.json": {
        name: "codexbridge",
        private: true,
        scripts: {
          build: "pnpm -r run build"
        }
      },
      "packages/vscode-agent/package.json": {
        name: "codexbridge-agent",
        scripts: {
          build: "tsc -b",
          "package:vsix": "node ./scripts/package-vsix.mjs"
        }
      },
      "packages/relay-server/package.json": {
        name: "@codexbridge/relay-server",
        scripts: {
          build: "tsc -b"
        }
      }
    });

    const result = await runTask(
      {
        taskId: "run-1",
        request: {
          source: "local_ui",
          threadId: "default",
          text: "\u91cd\u65b0\u6253\u5305"
        },
        intent: createRunIntent("pnpm -r run build"),
        renderedContext: "",
        runtime: { workspaceRoot } as never
      },
      {
        codex: { completeWithStreaming: async () => "" }
      }
    );

    expect(result.proposal.type).toBe("command");
    if (result.proposal.type !== "command") {
      return;
    }
    expect(result.proposal.cmd).toBe("pnpm --filter ./packages/vscode-agent package:vsix");
  });

  it("uses package-scoped build command when request names a package target", async () => {
    const workspaceRoot = await createWorkspace({
      "package.json": {
        name: "codexbridge",
        private: true,
        scripts: {
          build: "pnpm -r run build"
        }
      },
      "packages/vscode-agent/package.json": {
        name: "codexbridge-agent",
        scripts: {
          build: "tsc -b",
          "package:vsix": "node ./scripts/package-vsix.mjs"
        }
      },
      "packages/relay-server/package.json": {
        name: "@codexbridge/relay-server",
        scripts: {
          build: "tsc -b"
        }
      }
    });

    const result = await runTask(
      {
        taskId: "run-2",
        request: {
          source: "local_ui",
          threadId: "default",
          text: "\u91cd\u65b0\u6253\u5305 relay-server"
        },
        intent: createRunIntent("pnpm -r run build"),
        renderedContext: "",
        runtime: { workspaceRoot } as never
      },
      {
        codex: { completeWithStreaming: async () => "" }
      }
    );

    expect(result.proposal.type).toBe("command");
    if (result.proposal.type !== "command") {
      return;
    }
    expect(result.proposal.cmd).toBe("pnpm --filter ./packages/relay-server build");
  });
});

function createRunIntent(cmd?: string): TaskIntent {
  return {
    kind: "run",
    confidence: 0.9,
    summary: "run task",
    params: cmd ? { cmd } : undefined
  };
}

async function createWorkspace(files: Record<string, unknown>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codexbridge-run-task-"));
  tempWorkspaceRoots.push(root);
  for (const [relPath, value] of Object.entries(files)) {
    const absolute = path.join(root, ...relPath.split("/"));
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
  return root;
}
