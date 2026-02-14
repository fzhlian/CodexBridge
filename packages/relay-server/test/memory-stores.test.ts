import { describe, expect, it } from "vitest";
import {
  MemoryAuditIndexStore,
  MemoryInflightCommandStore,
  MemoryMachineStateStore
} from "../src/memory-stores.js";

describe("MemoryMachineStateStore", () => {
  it("registers, heartbeats, and removes machine state", async () => {
    const store = new MemoryMachineStateStore();
    await store.register(
      {
        machineId: "m1",
        connectedAt: 100,
        lastHeartbeatAt: 100,
        runningCount: 0,
        pendingCount: 0,
        sessionId: "s1"
      },
      60_000
    );
    await store.markHeartbeat("m1", 200, 60_000, { runningCount: 1, pendingCount: 2 });
    const found = await store.get("m1");
    expect(found?.lastHeartbeatAt).toBe(200);
    expect(found?.runningCount).toBe(1);
    expect(found?.pendingCount).toBe(2);
    await store.remove("m1");
    expect(await store.get("m1")).toBeUndefined();
  });
});

describe("MemoryInflightCommandStore", () => {
  it("stores and lists inflight records", async () => {
    const store = new MemoryInflightCommandStore();
    await store.set(
      {
        commandId: "c1",
        userId: "u1",
        machineId: "m1",
        kind: "patch",
        createdAtMs: 100
      },
      60_000
    );
    const list = await store.list();
    expect(list.length).toBe(1);
    expect(list[0]?.commandId).toBe("c1");
    await store.remove("c1");
    expect(await store.get("c1")).toBeUndefined();
  });
});

describe("MemoryAuditIndexStore", () => {
  it("aggregates recent records and status counts", async () => {
    const store = new MemoryAuditIndexStore();
    await store.applyEvent(
      {
        commandId: "c1",
        timestamp: "2026-02-13T00:00:00.000Z",
        status: "created",
        userId: "u1",
        machineId: "m1"
      },
      100
    );
    await store.applyEvent(
      {
        commandId: "c1",
        timestamp: "2026-02-13T00:00:01.000Z",
        status: "agent_ok",
        userId: "u1",
        machineId: "m1"
      },
      100
    );
    expect(await store.count()).toBe(1);
    expect((await store.statusCounts()).agent_ok).toBe(1);
    const recent = await store.listRecent(10, { userId: "u1" });
    expect(recent.length).toBe(1);
    expect(recent[0]?.events.length).toBe(2);
  });
});
