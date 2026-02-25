import { promises as fs } from "node:fs";
import { parseVsixInstallCommand, quoteCommandArg, resolveCommandPath } from "../commandLine.js";
import { resolveExecutablePath, runSpawnProcess } from "../processRunner.js";
import type { ToolDefinition, ToolExecutionPlan, ToolPreflightResult } from "../types.js";

type VsixInstallInput = {
  vsixPath: string;
  force: boolean;
  absoluteVsixPath?: string;
  executable?: string;
};

function asInput(plan: ToolExecutionPlan): VsixInstallInput {
  return plan.input as VsixInstallInput;
}

export function createVsixInstallTool(): ToolDefinition {
  return {
    id: "vsix_install",
    matches(commandText) {
      const parsed = parseVsixInstallCommand(commandText);
      if (!parsed) {
        return undefined;
      }
      return {
        toolId: "vsix_install",
        input: parsed satisfies VsixInstallInput,
        commandPreview: commandText.trim()
      };
    },
    async preflight(plan, context): Promise<ToolPreflightResult> {
      const input = asInput(plan);
      const absoluteVsixPath = resolveCommandPath(context.cwd, input.vsixPath);
      try {
        await fs.access(absoluteVsixPath);
      } catch {
        return {
          ok: false,
          diagnostics: [{
            code: "tool.vsix.file_not_found",
            message: `vsix file not found: ${absoluteVsixPath}`,
            severity: "error",
            recoverable: false
          }]
        };
      }

      const executable = await resolveCodeExecutable();
      const diagnostics = executable
        ? []
        : [{
          code: "tool.vsix.code_cli_missing",
          message: "code CLI not found, will try VS Code API fallback",
          severity: "warn",
          recoverable: true
        } satisfies ToolPreflightResult["diagnostics"][number]];
      return {
        ok: true,
        diagnostics,
        input: {
          ...input,
          absoluteVsixPath,
          executable
        } satisfies VsixInstallInput
      };
    },
    async execute(plan, context) {
      const input = asInput(plan);
      const absoluteVsixPath = input.absoluteVsixPath || resolveCommandPath(context.cwd, input.vsixPath);
      if (input.executable) {
        const args = ["--install-extension", absoluteVsixPath];
        if (input.force) {
          args.push("--force");
        }
        return await runSpawnProcess(input.executable, args, {
          cwd: context.cwd,
          timeoutMs: context.timeoutMs,
          maxTailLines: context.maxTailLines,
          signal: context.signal,
          shell: false
        });
      }
      return await installViaVscodeApi(absoluteVsixPath, input.force);
    }
  };
}

async function resolveCodeExecutable(): Promise<string | undefined> {
  return await resolveExecutablePath("code")
    || await resolveExecutablePath("code.cmd")
    || await resolveExecutablePath("code-insiders");
}

async function installViaVscodeApi(vsixPath: string, force: boolean): Promise<{
  code: number;
  cancelled: false;
  timedOut: false;
  outputTail: string;
}> {
  try {
    const vscode = await import("vscode");
    if (!vscode.commands || !vscode.Uri) {
      return {
        code: 1,
        cancelled: false,
        timedOut: false,
        outputTail: "VS Code API unavailable for extension installation fallback"
      };
    }
    const args: unknown[] = [vscode.Uri.file(vsixPath)];
    if (force) {
      args.push({ installPreReleaseVersion: false, donotSync: true });
    }
    await vscode.commands.executeCommand("workbench.extensions.installExtension", ...args);
    return {
      code: 0,
      cancelled: false,
      timedOut: false,
      outputTail: `installed via VS Code API: ${quoteCommandArg(vsixPath)}`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      code: 1,
      cancelled: false,
      timedOut: false,
      outputTail: `VS Code API install failed: ${message}`
    };
  }
}
