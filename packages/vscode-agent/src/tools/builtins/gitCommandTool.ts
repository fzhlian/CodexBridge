import { parseSafeGitCommand } from "../../nl/commandExecution.js";
import { resolveExecutablePath, runSpawnProcess } from "../processRunner.js";
import type { ToolDefinition, ToolExecutionPlan, ToolPreflightResult } from "../types.js";

type GitCommandInput = {
  args: string[];
  command: string;
  executable?: string;
};

function asInput(plan: ToolExecutionPlan): GitCommandInput {
  return plan.input as GitCommandInput;
}

export function createGitCommandTool(): ToolDefinition {
  return {
    id: "git_command",
    matches(commandText) {
      const args = parseSafeGitCommand(commandText);
      if (!args) {
        return undefined;
      }
      return {
        toolId: "git_command",
        input: {
          args,
          command: commandText.trim()
        } satisfies GitCommandInput,
        commandPreview: commandText.trim()
      };
    },
    async preflight(plan): Promise<ToolPreflightResult> {
      const input = asInput(plan);
      const executable = await resolveExecutablePath("git");
      if (!executable) {
        return {
          ok: false,
          diagnostics: [{
            code: "tool.git.not_found",
            message: "git executable not found in PATH",
            severity: "error",
            recoverable: false
          }]
        };
      }
      return {
        ok: true,
        input: { ...input, executable },
        diagnostics: []
      };
    },
    async execute(plan, context) {
      const input = asInput(plan);
      const executable = input.executable || "git";
      return await runSpawnProcess(executable, input.args, {
        cwd: context.cwd,
        timeoutMs: context.timeoutMs,
        maxTailLines: context.maxTailLines,
        signal: context.signal,
        shell: false
      });
    }
  };
}
