import path from "node:path";
import { fileURLToPath } from "node:url";
import { RelayAgent } from "./agent.js";

function envOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export function createAgentFromEnv(env: NodeJS.ProcessEnv = process.env): RelayAgent {
  const relayUrl = envOrDefault(env.RELAY_WS_URL, "ws://127.0.0.1:8787/agent");
  const machineId = envOrDefault(env.MACHINE_ID, "local-dev-machine");
  return new RelayAgent({
    relayUrl,
    machineId
  });
}

export function startAgentFromEnv(env: NodeJS.ProcessEnv = process.env): RelayAgent {
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
