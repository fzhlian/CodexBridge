import { describe, expect, it } from "vitest";
import {
  extractQuickTunnelBaseUrlFromMetrics,
  extractLatestQuickTunnelBaseUrl,
  pickSingletonAndExtras
} from "../src/cloudflared.js";

describe("extractLatestQuickTunnelBaseUrl", () => {
  it("returns undefined when no quick tunnel URL exists", () => {
    expect(extractLatestQuickTunnelBaseUrl("no url here")).toBeUndefined();
  });

  it("returns the latest quick tunnel URL from log text", () => {
    const log = [
      "https://first-trycloud.trycloudflare.com",
      "noise",
      "https://second-fresh-url.trycloudflare.com"
    ].join("\n");
    expect(extractLatestQuickTunnelBaseUrl(log)).toBe(
      "https://second-fresh-url.trycloudflare.com"
    );
  });
});

describe("pickSingletonAndExtras", () => {
  it("keeps newest process by created timestamp", () => {
    const selection = pickSingletonAndExtras([
      { pid: 101, commandLine: "cloudflared a", createdAtMs: 1000 },
      { pid: 102, commandLine: "cloudflared b", createdAtMs: 3000 },
      { pid: 103, commandLine: "cloudflared c", createdAtMs: 2000 }
    ]);

    expect(selection.keep?.pid).toBe(102);
    expect(selection.extras.map((item) => item.pid)).toEqual([103, 101]);
  });

  it("falls back to pid when timestamp is missing", () => {
    const selection = pickSingletonAndExtras([
      { pid: 201, commandLine: "cloudflared a" },
      { pid: 205, commandLine: "cloudflared b" }
    ]);

    expect(selection.keep?.pid).toBe(205);
    expect(selection.extras.map((item) => item.pid)).toEqual([201]);
  });
});

describe("extractQuickTunnelBaseUrlFromMetrics", () => {
  it("returns undefined when metrics do not expose hostname", () => {
    expect(extractQuickTunnelBaseUrlFromMetrics("cloudflared_tunnel_total_requests 0")).toBeUndefined();
  });

  it("extracts latest quick tunnel hostname from metrics labels", () => {
    const metrics = [
      'cloudflared_tunnel_user_hostnames_counts{userHostname="https://first-old.trycloudflare.com"} 1',
      'cloudflared_tunnel_user_hostnames_counts{userHostname="https://second-live.trycloudflare.com"} 1'
    ].join("\n");
    expect(extractQuickTunnelBaseUrlFromMetrics(metrics)).toBe(
      "https://second-live.trycloudflare.com"
    );
  });
});
