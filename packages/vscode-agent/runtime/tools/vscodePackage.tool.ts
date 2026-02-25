import { AgentTool } from "../toolRegistry"

export class VSCodePackageTool implements AgentTool {

  name = "vscode.package"
  risk = "R1"

  async execute(ctx) {

    const { executor, workspace } = ctx

    await executor.runCommand(
      "pnpm install",
      workspace
    )

    await executor.runCommand(
      "pnpm build",
      workspace
    )

    await executor.runCommand(
      "npx vsce package",
      workspace
    )
  }
}
