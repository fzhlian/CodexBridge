import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { RelayAgent } from "./agent.js";
import { ensureCloudflaredRuntime } from "./cloudflared.js";

function envOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export function createAgentFromEnv(env: NodeJS.ProcessEnv = process.env): RelayAgent {
  const relayUrl = envOrDefault(env.RELAY_WS_URL, "ws://127.0.0.1:8787/agent");
  const machineId = envOrDefault(env.MACHINE_ID, "local-dev-machine");
  return new RelayAgent({
    relayUrl,
    machineId,
    eventLogger: (event) => console.info("[vscode-agent] %s", event)
  });
}

export function startAgentFromEnv(env: NodeJS.ProcessEnv = process.env): RelayAgent {
  const workspaceRoot = resolveRuntimeWorkspaceRoot(env);
  process.env.WORKSPACE_ROOT = workspaceRoot;
  try {
    const runtime = ensureCloudflaredRuntime(workspaceRoot);
    console.info(
      "[vscode-agent] cloudflared callback=%s total=%d managed=%d keepPid=%s terminated=%s",
      runtime.callbackUrl ?? "unknown",
      runtime.totalProcessCount,
      runtime.managedProcessCount,
      runtime.keepPid ?? "none",
      runtime.terminatedPids.length > 0 ? runtime.terminatedPids.join(",") : "none"
    );
    if (runtime.started) {
      console.info("[vscode-agent] cloudflared restarted automatically");
    }
    if (runtime.startError) {
      console.warn("[vscode-agent] cloudflared restart failed: %s", runtime.startError);
    }
    if (runtime.warning) {
      console.warn("[vscode-agent] cloudflared warning: %s", runtime.warning);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.warn("[vscode-agent] cloudflared inspection failed: %s", detail);
  }

  const agent = createAgentFromEnv(env);
  agent.start();

  const stopAndExit = (): void => {
    agent.stop();
    process.exit(0);
  };
  process.once("SIGINT", stopAndExit);
  process.once("SIGTERM", stopAndExit);

  return agent;
}

export function runIfMain(metaUrl: string): RelayAgent | undefined {
  const executedScript = process.argv[1];
  if (!executedScript) {
    return undefined;
  }
  const entryFile = normalizeForComparison(fileURLToPath(metaUrl));
  const scriptFile = normalizeForComparison(
    executedScript.startsWith("file:") ? fileURLToPath(executedScript) : executedScript
  );
  if (entryFile !== scriptFile) {
    return undefined;
  }
  return startAgentFromEnv();
}

function normalizeForComparison(filePath: string): string {
  const resolved = path.resolve(filePath);
  const normalized = path.normalize(resolved);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function resolveRuntimeWorkspaceRoot(env: NodeJS.ProcessEnv): string {
  const fromEnv = env.WORKSPACE_ROOT?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  const fromInit = env.INIT_CWD?.trim();
  if (fromInit) {
    return path.resolve(fromInit);
  }
  const discovered = discoverWorkspaceRoot(process.cwd());
  if (discovered) {
    return discovered;
  }
  return path.resolve(process.cwd());
}

function discoverWorkspaceRoot(startPath: string): string | undefined {
  let current = path.resolve(startPath);
  while (true) {
    if (looksLikeWorkspaceRoot(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function looksLikeWorkspaceRoot(candidate: string): boolean {
  return existsSync(path.join(candidate, "pnpm-workspace.yaml"))
    || existsSync(path.join(candidate, "tmp", "cloudflared.log"));
}
