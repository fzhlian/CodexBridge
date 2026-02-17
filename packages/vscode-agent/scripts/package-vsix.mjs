import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

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
const outputPath = path.join(projectDir, output);
const stageDir = mkdtempSync(path.join(os.tmpdir(), "codexbridge-vsix-"));

try {
  const stageDistDir = path.join(stageDir, "dist");
  mkdirSync(stageDistDir, { recursive: true });

  await build({
    entryPoints: [path.join(projectDir, "src/extension.ts")],
    outfile: path.join(stageDistDir, "extension.cjs"),
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    sourcemap: false,
    external: ["vscode"],
    logLevel: "info"
  });

  const stageManifest = {
    name: "codexbridge-agent",
    version: packageJson.version,
    main: "dist/extension.cjs",
    files: [
      "dist/**",
      "README.md",
      "LICENSE.txt",
      "package.json"
    ],
    publisher: packageJson.publisher,
    displayName: packageJson.displayName ?? "CodexBridge Agent",
    description: packageJson.description ?? "CodexBridge local agent extension for VSCode.",
    engines: packageJson.engines,
    activationEvents: packageJson.activationEvents,
    contributes: packageJson.contributes,
    categories: packageJson.categories,
    repository: packageJson.repository,
    license: packageJson.license
  };

  writeFileSync(path.join(stageDir, "package.json"), `${JSON.stringify(stageManifest, null, 2)}\n`, "utf8");
  writeFileSync(
    path.join(stageDir, "README.md"),
    readFileSync(path.join(projectDir, "README.md"), "utf8"),
    "utf8"
  );
  writeFileSync(
    path.join(stageDir, "LICENSE.txt"),
    readFileSync(path.join(projectDir, "LICENSE.txt"), "utf8"),
    "utf8"
  );

  const vsceCmd =
    process.platform === "win32"
      ? path.join(projectDir, "node_modules", ".bin", "vsce.cmd")
      : path.join(projectDir, "node_modules", ".bin", "vsce");
  if (!existsSync(vsceCmd)) {
    throw new Error("vsce executable not found. Run `pnpm install` at repository root first.");
  }
  const result =
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", vsceCmd, "package", "-o", outputPath],
          {
            cwd: stageDir,
            stdio: "inherit"
          }
        )
      : spawnSync(vsceCmd, ["package", "-o", outputPath], {
          cwd: stageDir,
          stdio: "inherit"
        });
  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}

process.stdout.write(`${output}\n`);
