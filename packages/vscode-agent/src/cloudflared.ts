import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export type CloudflaredProcess = {
  pid: number;
  commandLine: string;
  createdAtMs?: number;
};

export type CloudflaredSingletonSelection = {
  keep?: CloudflaredProcess;
  extras: CloudflaredProcess[];
};

export type CloudflaredRuntimeInfo = {
  callbackUrl?: string;
  logPath: string;
  totalProcessCount: number;
  managedProcessCount: number;
  keepPid?: number;
  terminatedPids: number[];
  warning?: string;
};

export type EnsuredCloudflaredRuntimeInfo = CloudflaredRuntimeInfo & {
  started: boolean;
  startError?: string;
};

export function inspectCloudflaredRuntime(workspaceRoot: string): CloudflaredRuntimeInfo {
  const logPath = resolveCloudflaredLogPath(workspaceRoot);
  const processes = listCloudflaredProcesses();
  const managed = selectManagedCloudflaredProcesses(processes, workspaceRoot, logPath);
  const selection = selectSingletonTargets(processes, managed);
  const callbackUrl = resolveCallbackUrl(logPath, selection.keep?.pid);

  const terminatedPids: number[] = [];
  const failedPids: number[] = [];
  let warning: string | undefined;
  if (shouldEnforceSingleton()) {
    for (const processInfo of selection.extras) {
      if (tryTerminateProcess(processInfo.pid)) {
        terminatedPids.push(processInfo.pid);
      } else {
        failedPids.push(processInfo.pid);
      }
    }
  }

  if (failedPids.length > 0) {
    warning = `failed to terminate cloudflared pids=${failedPids.join(",")}`;
  } else {
    const scope = resolveSingletonScope();
    if (scope === "managed" && processes.length > 1 && managed.length <= 1) {
      warning = "multiple cloudflared processes detected outside managed scope";
    }
  }

  return {
    callbackUrl,
    logPath,
    totalProcessCount: processes.length,
    managedProcessCount: managed.length,
    keepPid: selection.keep?.pid,
    terminatedPids,
    warning
  };
}

export function ensureCloudflaredRuntime(workspaceRoot: string): EnsuredCloudflaredRuntimeInfo {
  const runtime = inspectCloudflaredRuntime(workspaceRoot);
  if (!shouldAutoStartCloudflared()) {
    return {
      ...runtime,
      started: false
    };
  }
  if (runtime.managedProcessCount > 0) {
    return {
      ...runtime,
      started: false
    };
  }

  const startError = tryStartCloudflared(workspaceRoot, runtime.logPath);
  const refreshed = inspectCloudflaredRuntime(workspaceRoot);
  if (startError) {
    return {
      ...refreshed,
      started: false,
      startError
    };
  }
  if (refreshed.managedProcessCount <= 0) {
    return {
      ...refreshed,
      started: false,
      startError: "cloudflared process exited immediately after start"
    };
  }
  return {
    ...refreshed,
    started: true
  };
}

export function extractLatestQuickTunnelBaseUrl(logText: string): string | undefined {
  const matches = [...logText.matchAll(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/gi)];
  if (matches.length === 0) {
    return undefined;
  }
  const latest = matches[matches.length - 1]?.[1];
  if (!latest) {
    return undefined;
  }
  return `https://${latest.toLowerCase()}.trycloudflare.com`;
}

export function extractQuickTunnelBaseUrlFromMetrics(metricsText: string): string | undefined {
  const matches = [
    ...metricsText.matchAll(/userHostname="(https:\/\/[a-z0-9-]+\.trycloudflare\.com)"/gi)
  ];
  if (matches.length === 0) {
    return undefined;
  }
  const latest = matches[matches.length - 1]?.[1];
  if (!latest) {
    return undefined;
  }
  return latest.toLowerCase();
}

export function pickSingletonAndExtras(
  processes: CloudflaredProcess[]
): CloudflaredSingletonSelection {
  if (processes.length === 0) {
    return { extras: [] };
  }
  const sorted = [...processes].sort((left, right) => {
    const leftTs = left.createdAtMs ?? 0;
    const rightTs = right.createdAtMs ?? 0;
    if (leftTs !== rightTs) {
      return rightTs - leftTs;
    }
    return right.pid - left.pid;
  });
  return {
    keep: sorted[0],
    extras: sorted.slice(1)
  };
}

function resolveCallbackUrl(logPath: string, keepPid?: number): string | undefined {
  const explicit = process.env.WECOM_CALLBACK_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const callbackPath = normalizeCallbackPath(
    process.env.WECOM_CALLBACK_PATH?.trim() ?? "/wecom/callback"
  );
  const configuredBase = process.env.WECOM_CALLBACK_BASE_URL?.trim();
  if (configuredBase) {
    return joinCallbackUrl(configuredBase, callbackPath);
  }

  const activeBase = keepPid ? resolveQuickTunnelBaseUrlFromProcessMetrics(keepPid) : undefined;
  if (activeBase) {
    return joinCallbackUrl(activeBase, callbackPath);
  }

  const baseUrl = readLatestQuickTunnelBaseUrl(logPath);
  if (!baseUrl) {
    return undefined;
  }
  return joinCallbackUrl(baseUrl, callbackPath);
}

function readLatestQuickTunnelBaseUrl(logPath: string): string | undefined {
  if (!existsSync(logPath)) {
    return undefined;
  }
  try {
    const text = readFileSync(logPath, "utf8");
    return extractLatestQuickTunnelBaseUrl(text);
  } catch {
    return undefined;
  }
}

function normalizeCallbackPath(pathValue: string): string {
  if (!pathValue) {
    return "/wecom/callback";
  }
  return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
}

function joinCallbackUrl(baseUrl: string, callbackPath: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${callbackPath}`;
}

function resolveQuickTunnelBaseUrlFromProcessMetrics(pid: number): string | undefined {
  const ports = listListeningPortsByPid(pid);
  if (ports.length === 0) {
    return undefined;
  }

  for (const port of ports) {
    const metrics = readMetricsText(port);
    if (!metrics) {
      continue;
    }
    const baseUrl = extractQuickTunnelBaseUrlFromMetrics(metrics);
    if (baseUrl) {
      return baseUrl;
    }
  }
  return undefined;
}

function listListeningPortsByPid(pid: number): number[] {
  if (!Number.isFinite(pid) || pid <= 0) {
    return [];
  }
  if (process.platform === "win32") {
    return listListeningPortsByPidWindows(pid);
  }
  return listListeningPortsByPidPosix(pid);
}

function listListeningPortsByPidWindows(pid: number): number[] {
  const script = [
    `$ports = Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort`,
    "if ($null -eq $ports) { '' } else { ($ports | Sort-Object -Unique) -join ',' }"
  ].join("; ");
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return [];
  }
  return parsePortList(result.stdout ?? "");
}

function listListeningPortsByPidPosix(pid: number): number[] {
  const result = spawnSync("lsof", ["-Pan", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return [];
  }
  const ports = [...(result.stdout ?? "").matchAll(/n(?:\*|[^:]+):(\d+)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
  return Array.from(new Set(ports));
}

function parsePortList(raw: string): number[] {
  const ports = raw
    .split(/[\s,]+/)
    .map((item) => Number(item.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  return Array.from(new Set(ports));
}

function readMetricsText(port: number): string | undefined {
  const command = process.platform === "win32" ? "curl.exe" : "curl";
  const result = spawnSync(command, ["-sS", "--max-time", "2", `http://127.0.0.1:${port}/metrics`], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return undefined;
  }
  const text = result.stdout ?? "";
  return text.trim() ? text : undefined;
}

function resolveCloudflaredLogPath(workspaceRoot: string): string {
  const explicit = process.env.CLOUDFLARED_LOG_PATH?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  const candidatePaths = uniquePaths([
    path.join(path.resolve(workspaceRoot), "tmp", "cloudflared.log"),
    process.env.WORKSPACE_ROOT?.trim()
      ? path.join(path.resolve(process.env.WORKSPACE_ROOT.trim()), "tmp", "cloudflared.log")
      : undefined,
    process.env.INIT_CWD?.trim()
      ? path.join(path.resolve(process.env.INIT_CWD.trim()), "tmp", "cloudflared.log")
      : undefined,
    path.join(process.cwd(), "tmp", "cloudflared.log")
  ]);
  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const discovered = discoverLatestLogFromAncestors([
    workspaceRoot,
    process.env.WORKSPACE_ROOT,
    process.env.INIT_CWD,
    process.cwd()
  ]);
  if (discovered) {
    return discovered;
  }

  return candidatePaths[0] ?? path.join(path.resolve(workspaceRoot), "tmp", "cloudflared.log");
}

function shouldEnforceSingleton(): boolean {
  const raw = process.env.CLOUDFLARED_ENFORCE_SINGLETON?.trim().toLowerCase();
  if (!raw) {
    return true;
  }
  return !["0", "false", "no", "off"].includes(raw);
}

function shouldAutoStartCloudflared(): boolean {
  const raw = process.env.CLOUDFLARED_AUTO_START?.trim().toLowerCase();
  if (!raw) {
    return true;
  }
  return !["0", "false", "no", "off"].includes(raw);
}

function resolveSingletonScope(): "all" | "managed" {
  const raw = process.env.CLOUDFLARED_SINGLETON_SCOPE?.trim().toLowerCase();
  if (raw === "managed") {
    return "managed";
  }
  return "all";
}

function selectSingletonTargets(
  allProcesses: CloudflaredProcess[],
  managedProcesses: CloudflaredProcess[]
): CloudflaredSingletonSelection {
  const scope = resolveSingletonScope();
  if (scope === "managed") {
    return pickSingletonAndExtras(managedProcesses);
  }

  if (allProcesses.length === 0) {
    return { extras: [] };
  }

  if (managedProcesses.length === 0) {
    return pickSingletonAndExtras(allProcesses);
  }

  const managedSelection = pickSingletonAndExtras(managedProcesses);
  const keep = managedSelection.keep;
  if (!keep) {
    return pickSingletonAndExtras(allProcesses);
  }

  return {
    keep,
    extras: allProcesses.filter((item) => item.pid !== keep.pid)
  };
}

function selectManagedCloudflaredProcesses(
  processes: CloudflaredProcess[],
  workspaceRoot: string,
  logPath: string
): CloudflaredProcess[] {
  const targetUrl = (process.env.CLOUDFLARED_TARGET_URL ?? "http://127.0.0.1:8787").trim();
  const targetUrlNorm = normalizeForCompare(targetUrl);
  const workspaceNorm = normalizeForCompare(workspaceRoot);
  const logPathNorm = normalizeForCompare(logPath);

  return processes.filter((item) => {
    const commandNorm = normalizeForCompare(item.commandLine);
    return commandNorm.includes(targetUrlNorm)
      || commandNorm.includes(workspaceNorm)
      || commandNorm.includes(logPathNorm);
  });
}

function tryStartCloudflared(workspaceRoot: string, logPath: string): string | undefined {
  const command = process.env.CLOUDFLARED_COMMAND?.trim() || "cloudflared";
  const targetUrl = (process.env.CLOUDFLARED_TARGET_URL ?? "http://127.0.0.1:8787").trim();
  const protocol = (process.env.CLOUDFLARED_PROTOCOL ?? "http2").trim() || "http2";
  const metrics = process.env.CLOUDFLARED_METRICS?.trim();

  try {
    mkdirSync(path.dirname(logPath), { recursive: true });
  } catch {
    // ignore directory creation failure and let spawn report error if any
  }

  const args = [
    "tunnel",
    "--url",
    targetUrl,
    "--protocol",
    protocol,
    "--no-autoupdate",
    "--loglevel",
    "info",
    "--logfile",
    logPath
  ];
  if (metrics) {
    args.push("--metrics", metrics);
  }

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      cwd: path.resolve(workspaceRoot)
    });
    child.unref();
    return undefined;
  } catch (error) {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}

function listCloudflaredProcesses(): CloudflaredProcess[] {
  if (process.platform === "win32") {
    return listCloudflaredProcessesWindows();
  }
  return listCloudflaredProcessesPosix();
}

function listCloudflaredProcessesWindows(): CloudflaredProcess[] {
  const script = [
    "$items = Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Select-Object ProcessId,CreationDate,CommandLine",
    "if ($null -eq $items) { '[]' } else { $items | ConvertTo-Json -Compress }"
  ].join("; ");
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return [];
  }

  const raw = (result.stdout ?? "").trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .map(toCloudflaredProcessFromWindows)
      .filter((item): item is CloudflaredProcess => item !== undefined);
  } catch {
    return [];
  }
}

function toCloudflaredProcessFromWindows(input: unknown): CloudflaredProcess | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const record = input as {
    ProcessId?: number | string;
    CreationDate?: string;
    CommandLine?: string;
  };
  const pid = Number(record.ProcessId);
  if (!Number.isFinite(pid) || pid <= 0) {
    return undefined;
  }
  return {
    pid,
    createdAtMs: parseWmiCreationDate(record.CreationDate),
    commandLine: record.CommandLine ?? ""
  };
}

function parseWmiCreationDate(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const match = /^(\d{14})/.exec(raw);
  if (!match?.[1]) {
    return undefined;
  }
  const stamp = match[1];
  const year = Number(stamp.slice(0, 4));
  const month = Number(stamp.slice(4, 6));
  const day = Number(stamp.slice(6, 8));
  const hour = Number(stamp.slice(8, 10));
  const minute = Number(stamp.slice(10, 12));
  const second = Number(stamp.slice(12, 14));
  const value = new Date(year, month - 1, day, hour, minute, second).getTime();
  return Number.isFinite(value) ? value : undefined;
}

function listCloudflaredProcessesPosix(): CloudflaredProcess[] {
  const result = spawnSync("ps", ["-eo", "pid=,args="], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return [];
  }
  const lines = (result.stdout ?? "").split(/\r?\n/);
  const output: CloudflaredProcess[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("cloudflared")) {
      continue;
    }
    const match = /^(\d+)\s+(.*)$/.exec(trimmed);
    if (!match?.[1] || !match[2]) {
      continue;
    }
    const pid = Number(match[1]);
    if (!Number.isFinite(pid) || pid <= 0) {
      continue;
    }
    output.push({
      pid,
      commandLine: match[2]
    });
  }
  return output;
}

function tryTerminateProcess(pid: number): boolean {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/F"], {
      encoding: "utf8"
    });
    return result.status === 0;
  }
  const result = spawnSync("kill", ["-9", String(pid)], {
    encoding: "utf8"
  });
  return result.status === 0;
}

function normalizeForCompare(input: string): string {
  const normalized = path.normalize(input);
  return process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}

function discoverLatestLogFromAncestors(startPaths: Array<string | undefined>): string | undefined {
  let latestPath: string | undefined;
  let latestMtimeMs = Number.NEGATIVE_INFINITY;

  for (const startRaw of startPaths) {
    const start = startRaw?.trim();
    if (!start) {
      continue;
    }

    let current = path.resolve(start);
    while (true) {
      const candidate = path.join(current, "tmp", "cloudflared.log");
      if (existsSync(candidate)) {
        const mtimeMs = getMtimeMs(candidate);
        if (mtimeMs > latestMtimeMs) {
          latestMtimeMs = mtimeMs;
          latestPath = candidate;
        }
      }

      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return latestPath;
}

function getMtimeMs(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const item of paths) {
    if (!item) {
      continue;
    }
    const resolved = path.resolve(item);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(resolved);
  }

  return output;
}
