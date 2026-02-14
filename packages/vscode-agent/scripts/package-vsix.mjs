import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  readFileSync(path.join(projectDir, "package.json"), "utf8")
);
const version = packageJson.version;
if (typeof version !== "string" || version.length === 0) {
  throw new Error("invalid vscode-agent version");
}

const output = `codexbridge-agent-${version}.vsix`;
const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vsce", "package", "-o", output],
  {
    cwd: projectDir,
    stdio: "inherit"
  }
);
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

process.stdout.write(`${output}\n`);
