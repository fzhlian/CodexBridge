import { isIP } from "node:net";
import process from "node:process";

const DEFAULT_OUTBOUND_IP_ENDPOINTS = [
  "https://api64.ipify.org?format=text",
  "https://ifconfig.me/ip",
  "https://ipv4.icanhazip.com"
];

const OUTBOUND_IP_CACHE_TTL_MS = 5 * 60_000;
const OUTBOUND_IP_CACHE_FALLBACK_TTL_MS = 60_000;

let outboundIpCache:
  | {
      value?: string;
      expiresAtMs: number;
    }
  | undefined;

export async function resolveOutboundIp(
  options: { signal?: AbortSignal; timeoutMs?: number; forceRefresh?: boolean } = {}
): Promise<string | undefined> {
  const now = Date.now();
  if (!options.forceRefresh && outboundIpCache && outboundIpCache.expiresAtMs > now) {
    return outboundIpCache.value;
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(300, Number(options.timeoutMs)) : 2500;
  const endpoints = resolveOutboundIpEndpoints();
  for (const endpoint of endpoints) {
    const resolved = await tryResolveIpFromEndpoint(endpoint, timeoutMs, options.signal);
    if (resolved) {
      outboundIpCache = {
        value: resolved,
        expiresAtMs: Date.now() + OUTBOUND_IP_CACHE_TTL_MS
      };
      return resolved;
    }
  }

  outboundIpCache = {
    value: undefined,
    expiresAtMs: Date.now() + OUTBOUND_IP_CACHE_FALLBACK_TTL_MS
  };
  return undefined;
}

function resolveOutboundIpEndpoints(): string[] {
  const fromList = process.env.CODEXBRIDGE_OUTBOUND_IP_ENDPOINTS
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (fromList && fromList.length > 0) {
    return fromList;
  }

  const single = process.env.CODEXBRIDGE_OUTBOUND_IP_ENDPOINT?.trim();
  if (single) {
    return [single];
  }
  return DEFAULT_OUTBOUND_IP_ENDPOINTS;
}

async function tryResolveIpFromEndpoint(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string | undefined> {
  try {
    const text = await fetchText(url, timeoutMs, signal);
    if (!text) {
      return undefined;
    }
    return parseIpFromText(text);
  } catch {
    return undefined;
  }
}

async function fetchText(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string | undefined> {
  if (signal?.aborted) {
    return undefined;
  }

  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);
  const abortHandler = () => timeoutController.abort();
  signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "text/plain, application/json;q=0.9, */*;q=0.1" },
      signal: timeoutController.signal
    });
    if (!response.ok) {
      return undefined;
    }
    return (await response.text()).trim();
  } finally {
    clearTimeout(timeoutHandle);
    if (signal) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}

function parseIpFromText(text: string): string | undefined {
  const direct = normalizeIpCandidate(text);
  if (direct) {
    return direct;
  }

  const normalized = text.replace(/[<>{}()[\]"'`;,\r\n\t]/g, " ");
  const parts = normalized
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  for (const part of parts) {
    const candidate = normalizeIpCandidate(part);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function normalizeIpCandidate(raw: string): string | undefined {
  let candidate = raw.trim();
  if (!candidate) {
    return undefined;
  }

  candidate = candidate.replace(/^[a-z]+:\/\//i, "");
  candidate = candidate.replace(/\/.*$/g, "");

  if (candidate.startsWith("[") && candidate.includes("]")) {
    const rightBracket = candidate.indexOf("]");
    candidate = candidate.slice(1, rightBracket);
  } else {
    const colonCount = (candidate.match(/:/g) ?? []).length;
    if (colonCount === 1) {
      const [host, maybePort] = candidate.split(":");
      if (maybePort && /^\d+$/.test(maybePort)) {
        candidate = host;
      }
    }
  }

  candidate = candidate.replace(/^\[+|\]+$/g, "").trim();
  if (!candidate) {
    return undefined;
  }
  return isIP(candidate) ? candidate : undefined;
}
