import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  hasExplicitExecutionIntentText,
  inferGitSyncCommandFromText,
  isSafeGitCommand,
  parseSafeGitCommand,
  resolveRunCommand
} from "../src/nl/commandExecution.js";

const tempWorkspaceRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempWorkspaceRoots.map(async (root) => {
      await fs.rm(root, { recursive: true, force: true });
    })
  );
  tempWorkspaceRoots.length = 0;
});

describe("commandExecution git safety", () => {
  it("parses safe git commands and rejects unsafe chaining", () => {
    expect(parseSafeGitCommand("git push origin main")).toEqual(["push", "origin", "main"]);
    expect(parseSafeGitCommand("git pull --ff-only")).toEqual(["pull", "--ff-only"]);
    expect(parseSafeGitCommand("git push --force origin main")).toBeUndefined();
    expect(parseSafeGitCommand("git pull && whoami")).toBeUndefined();
  });

  it("shares safety decision as boolean helper", () => {
    expect(isSafeGitCommand("git status")).toBe(true);
    expect(isSafeGitCommand("pnpm test")).toBe(false);
  });
});

describe("commandExecution intent helpers", () => {
  it("detects explicit execution intent in Chinese and English", () => {
    expect(hasExplicitExecutionIntentText("run pnpm test")).toBe(true);
    expect(hasExplicitExecutionIntentText("\u91cd\u65b0\u6253\u5305 vscode \u63d2\u4ef6")).toBe(true);
    expect(hasExplicitExecutionIntentText("install extension")).toBe(true);
    expect(hasExplicitExecutionIntentText("\u5b89\u88c5\u63d2\u4ef6")).toBe(true);
    expect(hasExplicitExecutionIntentText("explain this flow")).toBe(false);
  });

  it("infers git sync command defaults", () => {
    expect(inferGitSyncCommandFromText("\u540c\u6b65\u5230github")).toBe("git push");
    expect(inferGitSyncCommandFromText("\u4ece github \u540c\u6b65\u5230\u672c\u5730")).toBe("git pull --ff-only");
  });
});

describe("commandExecution run command resolution", () => {
  it("resolves package-scoped packaging command from generic build intent", async () => {
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

    const command = await resolveRunCommand({
      intentCommand: "pnpm -r run build",
      requestText: "\u91cd\u65b0\u6253\u5305",
      workspaceRoot
    });

    expect(command).toBe("pnpm --filter ./packages/vscode-agent package:vsix");
  });

  it("keeps explicit non-generic command after sanitization", async () => {
    const command = await resolveRunCommand({
      intentCommand: "pnpm --filter ./packages/shared test && whoami",
      requestText: "run tests"
    });
    expect(command).toBe("pnpm --filter ./packages/shared test");
  });

  it("uses workspace-root package script when workspace is vscode-agent package", async () => {
    const workspaceRoot = await createWorkspace({
      "package.json": {
        name: "codexbridge-agent",
        scripts: {
          build: "tsc -b",
          "package:vsix": "node ./scripts/package-vsix.mjs"
        }
      }
    });

    const command = await resolveRunCommand({
      intentCommand: "pnpm -r run build",
      requestText: "\u91cd\u65b0\u6253\u5305\u9879\u76ee",
      workspaceRoot
    });

    expect(command).toBe("pnpm package:vsix");
  });

  it("keeps packaging target for extension-focused error follow-up text", async () => {
    const workspaceRoot = await createWorkspace({
      "package.json": {
        name: "codexbridge-agent",
        scripts: {
          build: "tsc -b",
          "package:vsix": "node ./scripts/package-vsix.mjs"
        }
      }
    });

    const command = await resolveRunCommand({
      requestText: "\u91cd\u65b0\u6253\u5305\u9879\u76ee\u547d\u4ee4\u6267\u884c\u9519\u8bef\uff0c\u5e94\u8be5\u6253\u5305\u6269\u5c55\u7a0b\u5e8f",
      workspaceRoot
    });

    expect(command).toBe("pnpm package:vsix");
  });

  it("resolves extension install command when vsix exists", async () => {
    const workspaceRoot = await createWorkspace({
      "package.json": {
        name: "codexbridge",
        private: true
      },
      "packages/vscode-agent/package.json": {
        name: "codexbridge-agent",
        version: "0.1.22",
        scripts: {
          "package:vsix": "node ./scripts/package-vsix.mjs"
        }
      },
      "packages/vscode-agent/codexbridge-agent-0.1.22.vsix": "dummy vsix bytes"
    });

    const command = await resolveRunCommand({
      intentCommand: "npm install",
      requestText: "\u5b89\u88c5\u6269\u5c55",
      workspaceRoot
    });

    expect(command).toBe("code --install-extension ./packages/vscode-agent/codexbridge-agent-0.1.22.vsix --force");
  });

  it("falls back to package command when extension install is requested but vsix is missing", async () => {
    const workspaceRoot = await createWorkspace({
      "package.json": {
        name: "codexbridge",
        private: true
      },
      "packages/vscode-agent/package.json": {
        name: "codexbridge-agent",
        version: "0.1.22",
        scripts: {
          "package:vsix": "node ./scripts/package-vsix.mjs"
        }
      }
    });

    const command = await resolveRunCommand({
      intentCommand: "npm install",
      requestText: "\u5b89\u88c5\u63d2\u4ef6",
      workspaceRoot
    });

    expect(command).toBe("pnpm --filter ./packages/vscode-agent package:vsix");
  });

  it("maps bare install in extension workspace to local vsix install", async () => {
    const workspaceRoot = await createWorkspace({
      "package.json": {
        name: "codexbridge-agent",
        version: "0.1.22",
        scripts: {
          "package:vsix": "node ./scripts/package-vsix.mjs"
        }
      },
      "codexbridge-agent-0.1.22.vsix": "dummy vsix bytes"
    });

    const command = await resolveRunCommand({
      intentCommand: "npm install",
      requestText: "\u5b89\u88c5",
      workspaceRoot
    });

    expect(command).toBe("code --install-extension ./codexbridge-agent-0.1.22.vsix --force");
  });

  it("uses install default command for install requests when workspace heuristics do not apply", async () => {
    const command = await resolveRunCommand({
      requestText: "\u5b89\u88c5"
    });
    expect(command).toBe("pnpm install");
  });
});

async function createWorkspace(files: Record<string, unknown>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codexbridge-command-exec-"));
  tempWorkspaceRoots.push(root);
  for (const [relPath, value] of Object.entries(files)) {
    const absolute = path.join(root, ...relPath.split("/"));
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
  return root;
}
