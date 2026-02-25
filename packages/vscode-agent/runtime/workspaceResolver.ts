import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"

export class WorkspaceResolver {

  async resolve() {

    const folder =
      vscode.workspace.workspaceFolders?.[0]

    if (!folder)
      throw new Error("No workspace")

    return folder.uri.fsPath
  }

  async findPackageRoot() {

    const root = await this.resolve()

    let dir = root

    while (dir !== "/") {

      if (fs.existsSync(
          path.join(dir, "package.json")
      )) {
        return dir
      }

      dir = path.dirname(dir)
    }

    return root
  }
}
