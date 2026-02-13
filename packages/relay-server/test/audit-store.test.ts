import { describe, expect, it } from "vitest";
import { AuditStore } from "../src/audit-store.js";

describe("AuditStore", () => {
  it("records and returns command history", async () => {
    const store = new AuditStore();
    await store.record({
      commandId: "c1",
      timestamp: "2026-02-13T00:00:00.000Z",
      status: "created",
      userId: "u1",
      machineId: "m1"
    });
    await store.record({
      commandId: "c1",
      timestamp: "2026-02-13T00:00:01.000Z",
      status: "sent_to_agent"
    });

    const record = store.get("c1");
    expect(record?.status).toBe("sent_to_agent");
    expect(record?.events.length).toBe(2);
  });

  it("returns recent items sorted by updatedAt desc", async () => {
    const store = new AuditStore();
    await store.record({
      commandId: "a",
      timestamp: "2026-02-13T00:00:00.000Z",
      status: "created"
    });
    await store.record({
      commandId: "b",
      timestamp: "2026-02-13T00:00:02.000Z",
      status: "created"
    });
    const items = store.listRecent(2);
    expect(items[0]?.commandId).toBe("b");
    expect(items[1]?.commandId).toBe("a");
  });

  it("supports filter by user and status", async () => {
    const store = new AuditStore();
    await store.record({
      commandId: "c1",
      timestamp: "2026-02-13T00:00:00.000Z",
      status: "created",
      userId: "u1"
    });
    await store.record({
      commandId: "c2",
      timestamp: "2026-02-13T00:00:01.000Z",
      status: "agent_ok",
      userId: "u2"
    });
    await store.record({
      commandId: "c1",
      timestamp: "2026-02-13T00:00:02.000Z",
      status: "agent_error",
      userId: "u1"
    });

    const filtered = store.listRecent(10, { userId: "u1", status: "agent_error" });
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.commandId).toBe("c1");
  });

  it("prunes old records when max exceeded", async () => {
    const store = new AuditStore(undefined, 1);
    await store.record({
      commandId: "old",
      timestamp: "2026-02-13T00:00:00.000Z",
      status: "created"
    });
    await store.record({
      commandId: "new",
      timestamp: "2026-02-13T00:00:01.000Z",
      status: "created"
    });
    expect(store.get("old")).toBeUndefined();
    expect(store.get("new")?.commandId).toBe("new");
  });
});
