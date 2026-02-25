import { promises as fs } from "node:fs";
import path from "node:path";
import { quoteCommandArg } from "../commandLine.js";
import { runSpawnProcess } from "../processRunner.js";
import type {
  ToolDefinition,
  ToolExecutionPlan,
  ToolExecutionResult,
  ToolRecoveryDecision
} from "../types.js";

type ShellCommandInput = {
  command: string;
};

type PackageManifest = {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
};

function asInput(plan: ToolExecutionPlan): ShellCommandInput {
  return plan.input as ShellCommandInput;
}

export function createShellCommandTool(): ToolDefinition {
  return {
    id: "shell_command",
    matches(commandText) {
      const command = commandText.trim();
      if (!command) {
        return undefined;
      }
      return {
        toolId: "shell_command",
        input: { command } satisfies ShellCommandInput,
        commandPreview: command
      };
    },
    async execute(plan, context) {
      const input = asInput(plan);
      return await runSpawnProcess(input.command, [], {
        cwd: context.cwd,
        timeoutMs: context.timeoutMs,
        maxTailLines: context.maxTailLines,
        signal: context.signal,
        shell: true
      });
    },
    async recover(plan, context, result) {
      return await inferShellRecovery(plan, context.cwd, result);
    }
  };
}

async function inferShellRecovery(
  plan: ToolExecutionPlan,
  cwd: string,
  result: ToolExecutionResult
): Promise<ToolRecoveryDecision | undefined> {
  if (result.cancelled || result.timedOut || result.code === 0) {
    return undefined;
  }
  const input = asInput(plan);
  const fallback = await inferExtensionInstallRecoveryCommand(input.command, cwd);
  if (!fallback || fallback === input.command) {
    return undefined;
  }
  return {
    reason: "install_command_recovered_to_extension_flow",
    nextCommandText: fallback
  };
}

export async function inferExtensionInstallRecoveryCommand(
  commandText: string,
  cwd: string
): Promise<string | undefined> {
  if (!isDependencyInstallCommand(commandText)) {
    return undefined;
  }
  const candidates = [
    {
      manifestPath: path.join(cwd, "package.json"),
      relDir: "."
    },
    {
      manifestPath: path.join(cwd, "packages", "vscode-agent", "package.json"),
      relDir: "packages/vscode-agent"
    }
  ];
  for (const candidate of candidates) {
    const manifest = await readPackageManifest(candidate.manifestPath);
    if (!manifest || !hasVsixScript(manifest)) {
      continue;
    }
    const vsixFile = resolveVsixFilename(manifest);
    if (!vsixFile) {
      continue;
    }
    const baseDir = candidate.relDir === "."
      ? cwd
      : path.join(cwd, candidate.relDir);
    const vsixPath = path.join(baseDir, vsixFile);
    if (await fileExists(vsixPath)) {
      const rel = candidate.relDir === "."
        ? `./${vsixFile}`
        : `./${candidate.relDir.replace(/\\/g, "/")}/${vsixFile}`;
      return `code --install-extension ${quoteCommandArg(rel)} --force`;
    }
    if (candidate.relDir === ".") {
      return "pnpm package:vsix";
    }
    return `pnpm --filter ./${candidate.relDir.replace(/\\/g, "/")} package:vsix`;
  }
  return undefined;
}

function isDependencyInstallCommand(commandText: string): boolean {
  const normalized = commandText.trim().toLowerCase();
  return normalized === "npm install"
    || normalized === "npm i"
    || normalized === "pnpm install"
    || normalized === "pnpm i"
    || normalized === "yarn install";
}

function hasVsixScript(manifest: PackageManifest): boolean {
  return typeof manifest.scripts?.["package:vsix"] === "string";
}

function resolveVsixFilename(manifest: PackageManifest): string | undefined {
  const version = manifest.version?.trim();
  if (!version) {
    return undefined;
  }
  const base = normalizeVsixBaseName(manifest.name?.split("/").pop() || "codexbridge-agent");
  if (!base) {
    return undefined;
  }
  return `${base}-${version}.vsix`;
}

function normalizeVsixBaseName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readPackageManifest(filePath: string): Promise<PackageManifest | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as PackageManifest;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
