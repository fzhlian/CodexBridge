import { promises as fs } from "node:fs";
import path from "node:path";
import { sanitizeCmd } from "./validate.js";

type WorkspaceScriptTarget = {
  name?: string;
  version?: string;
  relDir: string;
  scripts: Set<string>;
};

export type ResolveRunCommandInput = {
  intentCommand?: string;
  requestText: string;
  workspaceRoot?: string;
  defaultTestCommand?: string;
  defaultBuildCommand?: string;
};

export async function resolveRunCommand(input: ResolveRunCommandInput): Promise<string> {
  const defaultTestCommand = sanitizeCmd(input.defaultTestCommand ?? "").trim() || "pnpm test";
  const defaultBuildCommand = sanitizeCmd(input.defaultBuildCommand ?? "").trim() || "pnpm build";
  const defaultInstallCommand = "pnpm install";
  const fromIntent = sanitizeCmd(input.intentCommand ?? "").trim();

  const packageAware = await inferPackageAwareRunCommand(input.requestText, fromIntent, input.workspaceRoot);
  if (packageAware) {
    return packageAware;
  }
  if (fromIntent) {
    return fromIntent;
  }

  const fromGitSync = inferGitSyncCommandFromText(input.requestText);
  if (fromGitSync) {
    return fromGitSync;
  }

  const fromBackticks = sanitizeCmd(input.requestText.match(/`([^`]+)`/)?.[1] ?? "").trim();
  if (fromBackticks) {
    return fromBackticks;
  }

  const fromNatural = sanitizeCmd(
    input.requestText.match(
      /(?:run|execute|test|build|lint|package|pack|bundle|\u8fd0\u884c|\u6267\u884c|\u6d4b\u8bd5|\u7f16\u8bd1|\u6253\u5305)\s+(.+)$/i
    )?.[1] ?? ""
  ).trim();
  if (fromNatural) {
    return fromNatural;
  }

  if (isBuildOrPackagingRequest(input.requestText)) {
    return defaultBuildCommand;
  }
  if (isInstallRequest(normalizeRunRequestText(input.requestText))) {
    return defaultInstallCommand;
  }
  return defaultTestCommand;
}

export function parseSafeGitCommand(command: string): string[] | undefined {
  const normalized = command.trim();
  if (!normalized) {
    return undefined;
  }
  if (
    /[\r\n`]/.test(normalized)
    || /\$\(/.test(normalized)
    || /&&|\|\||[;|<>]/.test(normalized)
  ) {
    return undefined;
  }
  const commitMatch = normalized.match(
    /^git\s+commit\s+-m\s+(?:"([^"\r\n]{1,200})"|'([^'\r\n]{1,200})')$/i
  );
  if (commitMatch) {
    return ["commit", "-m", commitMatch[1] ?? commitMatch[2] ?? ""];
  }

  const tokens = normalized.split(/\s+/);
  if (tokens[0]?.toLowerCase() !== "git") {
    return undefined;
  }
  const sub = (tokens[1] || "").toLowerCase();
  if (!sub) {
    return undefined;
  }
  if (sub === "add") {
    const rest = tokens.slice(2);
    if (rest.length === 1 && (rest[0] === "-A" || rest[0].toLowerCase() === "--all")) {
      return ["add", rest[0]];
    }
    return undefined;
  }
  if (sub === "push") {
    const rest = tokens.slice(2);
    if (rest.some((value) => /--force|--force-with-lease/i.test(value))) {
      return undefined;
    }
    let index = 0;
    const parsed: string[] = ["push"];
    if (rest[index]?.toLowerCase() === "-u" || rest[index]?.toLowerCase() === "--set-upstream") {
      parsed.push(rest[index]);
      index += 1;
    }
    const refs = rest.slice(index);
    if (refs.length > 2 || !refs.every(isSafeGitArg)) {
      return undefined;
    }
    parsed.push(...refs);
    return parsed;
  }
  if (sub === "pull") {
    const rest = tokens.slice(2);
    const parsed: string[] = ["pull"];
    let index = 0;
    if (rest[index]?.startsWith("--")) {
      const flag = rest[index].toLowerCase();
      if (flag !== "--ff-only" && flag !== "--rebase") {
        return undefined;
      }
      parsed.push(rest[index]);
      index += 1;
    }
    const refs = rest.slice(index);
    if (refs.length > 2 || !refs.every(isSafeGitArg)) {
      return undefined;
    }
    parsed.push(...refs);
    return parsed;
  }
  if (sub === "fetch") {
    const rest = tokens.slice(2);
    const parsed: string[] = ["fetch"];
    let index = 0;
    const seen = new Set<string>();
    while (rest[index]?.startsWith("--")) {
      const flag = rest[index].toLowerCase();
      if (flag !== "--all" && flag !== "--prune") {
        return undefined;
      }
      if (seen.has(flag)) {
        return undefined;
      }
      seen.add(flag);
      parsed.push(rest[index]);
      index += 1;
    }
    const refs = rest.slice(index);
    if (refs.length > 1 || !refs.every(isSafeGitArg)) {
      return undefined;
    }
    parsed.push(...refs);
    return parsed;
  }
  if (sub === "remote" && (tokens[2] || "").toLowerCase() === "update") {
    const refs = tokens.slice(3);
    if (refs.length > 1 || !refs.every(isSafeGitArg)) {
      return undefined;
    }
    return ["remote", "update", ...refs];
  }
  if (sub === "status") {
    if (tokens.length === 2) {
      return ["status"];
    }
    if (tokens.length === 3 && tokens[2].toLowerCase() === "--porcelain=v1") {
      return ["status", "--porcelain=v1"];
    }
    return undefined;
  }
  if (sub === "diff" && tokens.length === 3 && tokens[2].toLowerCase() === "--stat") {
    return ["diff", "--stat"];
  }
  return undefined;
}

export function isSafeGitCommand(command: string): boolean {
  return Boolean(parseSafeGitCommand(command));
}

export function hasExplicitExecutionIntentText(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (/(?:\brun\b|\bexecute\b|\btest\b|\bbuild\b|\bpackage\b|\bpack\b|\bbundle\b|\blint\b|\binstall\b|\bsetup\b)/i.test(normalized)) {
    return true;
  }
  return /(?:\u8fd0\u884c|\u6267\u884c|\u6d4b\u8bd5|\u7f16\u8bd1|\u6253\u5305|\u5b89\u88c5|\u5b89\u88dd)/.test(normalized);
}

export function inferGitSyncCommandFromText(text: string): string | undefined {
  if (!isLikelyGitSyncIntent(text)) {
    return undefined;
  }
  const normalized = normalizeIntentText(text);
  const lower = normalized.toLowerCase();
  if (
    /\bgit\s+fetch\b/i.test(normalized)
    || /\bfetch\b/i.test(normalized)
    || /(?:\u62c9\u53d6\u8fdc\u7a0b|\u83b7\u53d6\u8fdc\u7a0b)/.test(normalized)
  ) {
    return "git fetch --all --prune";
  }
  if (/\brebase\b/i.test(normalized) || /\u53d8\u57fa/.test(normalized)) {
    return "git pull --rebase";
  }
  if (
    /\bfrom\s+github\b/i.test(lower)
    || /(?:\u4ecegithub|\u4ece github|\u62c9\u53d6|\u540c\u6b65\u5230?\u672c\u5730|\u5230\u672c\u5730)/.test(normalized)
  ) {
    return "git pull --ff-only";
  }
  if (
    /\bto\s+github\b/i.test(lower)
    || /\bpush\b/i.test(lower)
    || /(?:\u63a8\u9001|\u63d0\u4ea4\u5e76\u63a8\u9001|\u540c\u6b65\u5230github|\u540c\u6b65\u5230 github|\u4e0a\u4f20\u5230github|\u53d1\u5e03\u5230github)/.test(normalized)
  ) {
    return "git push";
  }
  return "git push";
}

async function inferPackageAwareRunCommand(
  requestText: string,
  intentCommand: string | undefined,
  workspaceRoot: string | undefined
): Promise<string | undefined> {
  const normalizedRequest = normalizeRunRequestText(requestText);
  const wantsPackage = isPackagingRequest(normalizedRequest);
  const wantsBuild = isBuildRequest(normalizedRequest);
  const wantsInstall = isInstallRequest(normalizedRequest);
  const wantsExtensionInstall = isExtensionInstallRequest(normalizedRequest);
  const normalizedIntentCommand = normalizeCommandText(intentCommand);
  const intentIsGenericMonorepoCommand = isGenericMonorepoScriptCommand(normalizedIntentCommand);
  const intentIsGenericDependencyInstall = isGenericDependencyInstallCommand(normalizedIntentCommand);

  if (
    !wantsPackage
    && !wantsBuild
    && !wantsInstall
    && !intentIsGenericMonorepoCommand
    && !intentIsGenericDependencyInstall
  ) {
    return undefined;
  }
  if (!workspaceRoot) {
    return undefined;
  }
  if (
    normalizedIntentCommand
    && !intentIsGenericMonorepoCommand
    && !intentIsGenericDependencyInstall
  ) {
    return undefined;
  }

  const targets = await loadWorkspaceScriptTargets(workspaceRoot);
  if (targets.length === 0) {
    return undefined;
  }

  const mentionedTarget = resolveMentionedScriptTarget(normalizedRequest, targets);

  if (wantsInstall || intentIsGenericDependencyInstall) {
    const extensionTarget = resolveExtensionInstallTarget(
      normalizedRequest,
      targets,
      mentionedTarget,
      wantsExtensionInstall
    );
    if (extensionTarget) {
      const installCommand = await buildVsixInstallCommand(workspaceRoot, extensionTarget);
      if (installCommand) {
        return installCommand;
      }
      const packageScript = findPreferredPackageScript(extensionTarget.scripts);
      if (packageScript) {
        return buildFilteredPnpmScriptCommand(extensionTarget.relDir, packageScript);
      }
    }
  }

  if (mentionedTarget) {
    const packageScript = findPreferredPackageScript(mentionedTarget.scripts);
    if (wantsPackage && packageScript) {
      return buildFilteredPnpmScriptCommand(mentionedTarget.relDir, packageScript);
    }
    if (mentionedTarget.scripts.has("build")) {
      return buildFilteredPnpmScriptCommand(mentionedTarget.relDir, "build");
    }
    if (packageScript) {
      return buildFilteredPnpmScriptCommand(mentionedTarget.relDir, packageScript);
    }
  }

  if (wantsPackage) {
    const packageTargets = targets
      .map((target) => ({ target, script: findPreferredPackageScript(target.scripts) }))
      .filter((item): item is { target: WorkspaceScriptTarget; script: string } => Boolean(item.script));
    if (packageTargets.length === 1) {
      return buildFilteredPnpmScriptCommand(packageTargets[0].target.relDir, packageTargets[0].script);
    }
  }

  return undefined;
}

async function loadWorkspaceScriptTargets(workspaceRoot: string): Promise<WorkspaceScriptTarget[]> {
  const targets: WorkspaceScriptTarget[] = [];

  const rootManifest = await readPackageScripts(path.join(workspaceRoot, "package.json"));
  if (rootManifest.scripts.size > 0) {
    targets.push({
      name: rootManifest.name,
      version: rootManifest.version,
      relDir: ".",
      scripts: rootManifest.scripts
    });
  }

  const packagesDir = path.join(workspaceRoot, "packages");
  let dirs: string[];
  try {
    const rawEntries = await fs.readdir(packagesDir, { withFileTypes: true });
    dirs = rawEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => (typeof entry.name === "string" ? entry.name : String(entry.name)));
  } catch {
    return targets;
  }

  for (const dir of dirs) {
    const relDir = normalizeRelPath(path.join("packages", dir));
    const packageJsonPath = path.join(workspaceRoot, relDir, "package.json");
    const manifest = await readPackageScripts(packageJsonPath);
    if (manifest.scripts.size === 0) {
      continue;
    }
    targets.push({
      name: manifest.name,
      version: manifest.version,
      relDir,
      scripts: manifest.scripts
    });
  }
  return targets;
}

async function readPackageScripts(
  packageJsonPath: string
): Promise<{ name?: string; version?: string; scripts: Set<string> }> {
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown; scripts?: unknown };
    const scripts = new Set<string>();
    if (parsed.scripts && typeof parsed.scripts === "object" && !Array.isArray(parsed.scripts)) {
      for (const [scriptName, scriptValue] of Object.entries(parsed.scripts as Record<string, unknown>)) {
        if (typeof scriptName !== "string") {
          continue;
        }
        if (typeof scriptValue !== "string" || !scriptValue.trim()) {
          continue;
        }
        scripts.add(scriptName.trim());
      }
    }
    const name = typeof parsed.name === "string" ? parsed.name.trim() : undefined;
    const version = typeof parsed.version === "string" ? parsed.version.trim() : undefined;
    return { name: name || undefined, version: version || undefined, scripts };
  } catch {
    return { scripts: new Set<string>() };
  }
}

function resolveMentionedScriptTarget(
  normalizedRequest: string,
  targets: WorkspaceScriptTarget[]
): WorkspaceScriptTarget | undefined {
  const matched = targets
    .map((target) => ({ target, score: scoreScriptTargetMatch(normalizedRequest, target) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  if (matched.length === 0) {
    return undefined;
  }
  if (matched.length > 1 && matched[0]?.score === matched[1]?.score) {
    return undefined;
  }
  return matched[0]?.target;
}

function scoreScriptTargetMatch(request: string, target: WorkspaceScriptTarget): number {
  const terms = buildTargetMatchTerms(target);
  let score = 0;
  for (const term of terms) {
    if (!term) {
      continue;
    }
    if (!request.includes(term)) {
      continue;
    }
    if (term.length >= 10) {
      score += 4;
      continue;
    }
    if (term.length >= 6) {
      score += 3;
      continue;
    }
    if (term.length >= 3) {
      score += 2;
      continue;
    }
    score += 1;
  }
  return score;
}

function buildTargetMatchTerms(target: WorkspaceScriptTarget): string[] {
  const output = new Set<string>();
  const push = (value: string | undefined): void => {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || normalized.length < 2) {
      return;
    }
    output.add(normalized);
  };

  const baseDir = path.basename(target.relDir).toLowerCase();
  push(baseDir);
  push(target.name?.toLowerCase());

  const bareName = target.name?.split("/").pop()?.toLowerCase();
  push(bareName);

  for (const token of splitByDelimiters(baseDir)) {
    push(token);
  }
  for (const token of splitByDelimiters(bareName)) {
    push(token);
  }

  for (const alias of buildTargetAliases(baseDir)) {
    push(alias);
  }

  return Array.from(output);
}

function splitByDelimiters(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[^a-z0-9]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildTargetAliases(baseDir: string): string[] {
  if (baseDir === "vscode-agent") {
    return ["agent", "vscode", "extension", "vsix", "\u63d2\u4ef6", "\u6269\u5c55", "\u5ba2\u6237\u7aef"];
  }
  if (baseDir === "relay-server") {
    return ["relay", "server", "\u4e2d\u7ee7", "\u670d\u52a1\u7aef"];
  }
  if (baseDir === "codex-client") {
    return ["client", "\u5ba2\u6237\u7aef"];
  }
  if (baseDir === "shared") {
    return ["shared", "\u5171\u4eab"];
  }
  return [];
}

function findPreferredPackageScript(scripts: Set<string>): string | undefined {
  const preferred = ["package:vsix", "package", "pack", "bundle"];
  for (const script of preferred) {
    if (scripts.has(script)) {
      return script;
    }
  }
  for (const script of scripts) {
    if (script.startsWith("package:")) {
      return script;
    }
  }
  return undefined;
}

function resolveExtensionInstallTarget(
  normalizedRequest: string,
  targets: WorkspaceScriptTarget[],
  mentionedTarget: WorkspaceScriptTarget | undefined,
  wantsExtensionInstall: boolean
): WorkspaceScriptTarget | undefined {
  if (mentionedTarget && isExtensionPackageTarget(mentionedTarget)) {
    return mentionedTarget;
  }

  if (isBareInstallRequest(normalizedRequest)) {
    const rootExtensionTarget = targets.find(
      (target) => target.relDir === "." && isExtensionPackageTarget(target)
    );
    if (rootExtensionTarget) {
      return rootExtensionTarget;
    }
    const extensionTargets = targets.filter(isExtensionPackageTarget);
    if (extensionTargets.length === 1) {
      return extensionTargets[0];
    }
  }

  if (!wantsExtensionInstall) {
    return undefined;
  }

  const extensionTargets = targets.filter(isExtensionPackageTarget);
  if (extensionTargets.length === 1) {
    return extensionTargets[0];
  }
  return undefined;
}

function isExtensionPackageTarget(target: WorkspaceScriptTarget): boolean {
  if (target.scripts.has("package:vsix")) {
    return true;
  }
  const baseDir = path.basename(target.relDir).toLowerCase();
  if (baseDir === "vscode-agent") {
    return true;
  }
  const name = target.name?.toLowerCase() || "";
  return name.includes("codexbridge-agent") || name.includes("vscode-agent");
}

async function buildVsixInstallCommand(
  workspaceRoot: string,
  target: WorkspaceScriptTarget
): Promise<string | undefined> {
  const version = target.version?.trim();
  if (!version) {
    return undefined;
  }

  const baseName = resolveVsixBaseName(target);
  if (!baseName) {
    return undefined;
  }

  const vsixFile = `${baseName}-${version}.vsix`;
  const relDir = normalizeRelPath(target.relDir);
  const relPath = relDir && relDir !== "."
    ? `./${relDir}/${vsixFile}`
    : `./${vsixFile}`;
  const absPath = relDir && relDir !== "."
    ? path.join(workspaceRoot, relDir, vsixFile)
    : path.join(workspaceRoot, vsixFile);
  if (!(await fileExists(absPath))) {
    return undefined;
  }
  return `code --install-extension ${quoteCommandPath(relPath)} --force`;
}

function resolveVsixBaseName(target: WorkspaceScriptTarget): string | undefined {
  const fromName = normalizeVsixName(target.name?.split("/").pop());
  if (fromName) {
    return fromName;
  }
  return normalizeVsixName(path.basename(target.relDir));
}

function normalizeVsixName(input: string | undefined): string | undefined {
  const normalized = (input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || undefined;
}

function quoteCommandPath(value: string): string {
  if (!/[\s"]/g.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\\\"")}"`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildFilteredPnpmScriptCommand(relDir: string, scriptName: string): string {
  if (!relDir || relDir === ".") {
    return `pnpm ${scriptName}`;
  }
  const filterPath = normalizeRelPath(relDir).replace(/\\/g, "/");
  return `pnpm --filter ./${filterPath} ${scriptName}`;
}

function normalizeRelPath(input: string): string {
  return input
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

function normalizeRunRequestText(text: string): string {
  return normalizeIntentText(text).toLowerCase();
}

function normalizeIntentText(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, " ");
}

function normalizeCommandText(command: string | undefined): string | undefined {
  const normalized = command?.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized || undefined;
}

function isPackagingRequest(normalizedText: string): boolean {
  return /\b(?:package|pack|bundle|repackage)\b/.test(normalizedText)
    || /(?:\u6253\u5305|\u91cd\u65b0\u6253\u5305|\u91cd\u6253\u5305|\u51fa\u5305|\u5c01\u88c5)/.test(normalizedText);
}

function isBuildRequest(normalizedText: string): boolean {
  return /\b(?:build|compile|rebuild)\b/.test(normalizedText)
    || /(?:\u7f16\u8bd1|\u6784\u5efa|\u91cd\u7f16\u8bd1)/.test(normalizedText);
}

function isInstallRequest(normalizedText: string): boolean {
  return /\b(?:install|setup)\b/.test(normalizedText)
    || /(?:\u5b89\u88c5|\u5b89\u88dd)/.test(normalizedText);
}

function isExtensionInstallRequest(normalizedText: string): boolean {
  return /\b(?:extension|vsix|plugin|vscode)\b/.test(normalizedText)
    || /(?:\u63d2\u4ef6|\u6269\u5c55|\u64f4\u5c55|\u5ba2\u6237\u7aef|vsix)/.test(normalizedText);
}

function isBareInstallRequest(normalizedText: string): boolean {
  if (!isInstallRequest(normalizedText)) {
    return false;
  }
  const compact = normalizedText.replace(/\s+/g, "");
  return compact === "install"
    || compact === "setup"
    || compact === "\u5b89\u88c5"
    || compact === "\u8bf7\u5b89\u88c5"
    || compact === "\u5b89\u88c5\u4e00\u4e0b"
    || compact === "\u5e2e\u6211\u5b89\u88c5";
}

function isBuildOrPackagingRequest(text: string): boolean {
  const normalized = normalizeRunRequestText(text);
  return isBuildRequest(normalized) || isPackagingRequest(normalized);
}

function isGenericMonorepoScriptCommand(normalizedCommand: string | undefined): boolean {
  if (!normalizedCommand) {
    return false;
  }
  return normalizedCommand === "pnpm -r run build"
    || normalizedCommand === "pnpm build"
    || normalizedCommand === "pnpm run build"
    || normalizedCommand === "npm run build"
    || normalizedCommand === "yarn build"
    || normalizedCommand === "pnpm -r run package"
    || normalizedCommand === "pnpm package"
    || normalizedCommand === "pnpm run package"
    || normalizedCommand === "npm run package"
    || normalizedCommand === "yarn package";
}

function isGenericDependencyInstallCommand(normalizedCommand: string | undefined): boolean {
  if (!normalizedCommand) {
    return false;
  }
  return normalizedCommand === "pnpm install"
    || normalizedCommand === "pnpm i"
    || normalizedCommand === "npm install"
    || normalizedCommand === "npm i"
    || normalizedCommand === "yarn install";
}

function isSafeGitArg(value: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(value);
}

function isLikelyGitSyncIntent(text: string): boolean {
  const normalized = normalizeIntentText(text);
  const hasTarget = /\b(?:git|github|repo|repository)\b/i.test(normalized)
    || /(?:github|\u4ed3\u5e93|\u4ee3\u7801\u4ed3|\u4ee3\u7801\u5e93|\u8fdc\u7a0b\u4ed3)/.test(normalized);
  if (!hasTarget) {
    return false;
  }
  return /\b(?:sync|synchronize|push|pull|fetch|rebase|commit|publish)\b/i.test(normalized)
    || /(?:\u540c\u6b65|\u63a8\u9001|\u62c9\u53d6|\u53d8\u57fa|\u63d0\u4ea4|\u4e0a\u4f20|\u53d1\u5e03)/.test(normalized);
}
