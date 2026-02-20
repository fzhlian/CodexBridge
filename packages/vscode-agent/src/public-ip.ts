import { isIP } from "node:net";

const IP_SOURCES = [
  "https://api.ipify.org",
  "https://ifconfig.me/ip",
  "https://ipinfo.io/ip"
] as const;

const DEFAULT_TIMEOUT_MS = 2_000;
const CACHE_TTL_MS = 60_000;

let cachedIp: string | undefined;
let cachedAtMs = 0;
let inflight: Promise<string | undefined> | undefined;

export async function resolvePublicEgressIp(
  options: { forceRefresh?: boolean; timeoutMs?: number } = {}
): Promise<string | undefined> {
  const now = Date.now();
  if (!options.forceRefresh && cachedIp && now - cachedAtMs < CACHE_TTL_MS) {
    return cachedIp;
  }
  if (!options.forceRefresh && inflight) {
    return inflight;
  }

  inflight = detectPublicEgressIp(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    .then((ip) => {
      if (ip) {
        cachedIp = ip;
        cachedAtMs = Date.now();
      }
      return ip;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

async function detectPublicEgressIp(timeoutMs: number): Promise<string | undefined> {
  for (const source of IP_SOURCES) {
    const ip = await requestIpFromSource(source, timeoutMs);
    if (ip) {
      return ip;
    }
  }
  return undefined;
}

async function requestIpFromSource(
  source: string,
  timeoutMs: number
): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(source, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "text/plain"
      }
    });
    if (!response.ok) {
      return undefined;
    }
    const text = (await response.text()).trim();
    if (!text || isIP(text) === 0) {
      return undefined;
    }
    return text;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
