export class AgentRuntime {

  constructor(
    private tools,
    private approval,
    private workspace,
    private executor
  ) {}

  async handleProposal(proposal) {

    for (const action of proposal.actions) {

      if (action.risk !== "R0") {
        await this.approval.wait(action.id)
      }

      await this.runAction(action)
    }
  }

  async runAction(action) {

    const tool = this.tools.get(action.tool)

    const ctx = {
      workspace: await this.workspace.resolve(),
      input: action.input
    }

    return this.executor.execute(tool, ctx)
  }
}
