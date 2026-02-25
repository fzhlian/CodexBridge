export class ToolRegistry {

  tools = new Map()

  register(tool) {
    this.tools.set(tool.name, tool)
  }

  get(name) {
    return this.tools.get(name)
  }
}
