import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { parseVsixInstallCommand } from "../src/tools/commandLine.js";
import { inferExtensionInstallRecoveryCommand } from "../src/tools/builtins/shellCommandTool.js";
import { createDefaultToolRegistry } from "../src/tools/commandToolSystem.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map(async (root) => {
    await fs.rm(root, { recursive: true, force: true });
  }));
  tempRoots.length = 0;
});

describe("tool system planner", () => {
  it("routes commands to the expected tool", () => {
    const registry = createDefaultToolRegistry();
    expect(registry.plan("code --install-extension ./a.vsix --force").toolId).toBe("vsix_install");
    expect(registry.plan("git status").toolId).toBe("git_command");
    expect(registry.plan("npm run build").toolId).toBe("shell_command");
  });
});

describe("vsix command parser", () => {
  it("parses quoted vsix install command", () => {
    const parsed = parseVsixInstallCommand("code --install-extension \"./dist/codexbridge-agent-0.1.22.vsix\" --force");
    expect(parsed).toEqual({
      vsixPath: "./dist/codexbridge-agent-0.1.22.vsix",
      force: true
    });
  });
});

describe("shell recovery for extension install", () => {
  it("switches npm install to code --install-extension when vsix exists", async () => {
    const root = await createWorkspace({
      "packages/vscode-agent/package.json": {
        name: "codexbridge-agent",
        version: "0.1.22",
        scripts: {
          "package:vsix": "node ./scripts/package-vsix.mjs"
        }
      },
      "packages/vscode-agent/codexbridge-agent-0.1.22.vsix": "binary"
    });
    const fallback = await inferExtensionInstallRecoveryCommand("npm install", root);
    expect(fallback).toBe("code --install-extension ./packages/vscode-agent/codexbridge-agent-0.1.22.vsix --force");
  });

  it("switches npm install to package:vsix when vsix is missing", async () => {
    const root = await createWorkspace({
      "packages/vscode-agent/package.json": {
        name: "codexbridge-agent",
        version: "0.1.22",
        scripts: {
          "package:vsix": "node ./scripts/package-vsix.mjs"
        }
      }
    });
    const fallback = await inferExtensionInstallRecoveryCommand("npm install", root);
    expect(fallback).toBe("pnpm --filter ./packages/vscode-agent package:vsix");
  });
});

async function createWorkspace(files: Record<string, unknown>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codexbridge-tool-system-"));
  tempRoots.push(root);
  for (const [relPath, value] of Object.entries(files)) {
    const absolute = path.join(root, ...relPath.split("/"));
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    if (typeof value === "string") {
      await fs.writeFile(absolute, value, "utf8");
      continue;
    }
    await fs.writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
  return root;
}
