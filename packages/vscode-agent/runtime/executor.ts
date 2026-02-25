import { spawn } from "child_process"

export class Executor {

  execute(tool, ctx) {
    return tool.execute(ctx)
  }

  runCommand(cmd, cwd) {

    return new Promise((resolve, reject) => {

      const p = spawn(cmd, {
        shell: true,
        cwd
      })

      p.stdout.on("data", d =>
        console.log(d.toString())
      )

      p.on("close", resolve)
      p.on("error", reject)
    })
  }
}
