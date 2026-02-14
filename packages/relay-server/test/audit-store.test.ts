import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AuditStore } from "../src/audit-store.js";
import { MemoryAuditIndexStore } from "../src/memory-stores.js";

describe("AuditStore", () => {
  it("records and returns command history", async () => {
    const store = new AuditStore(new MemoryAuditIndexStore());
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

    const record = await store.get("c1");
    expect(record?.status).toBe("sent_to_agent");
    expect(record?.events.length).toBe(2);
  });

  it("returns recent items sorted by updatedAt desc", async () => {
    const store = new AuditStore(new MemoryAuditIndexStore());
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
    const items = await store.listRecent(2);
    expect(items[0]?.commandId).toBe("b");
    expect(items[1]?.commandId).toBe("a");
  });

  it("supports filter by user and status", async () => {
    const store = new AuditStore(new MemoryAuditIndexStore());
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

    const filtered = await store.listRecent(10, { userId: "u1", status: "agent_error" });
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.commandId).toBe("c1");
  });

  it("prunes old records when max exceeded", async () => {
    const store = new AuditStore(new MemoryAuditIndexStore(), undefined, 1);
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
    expect(await store.get("old")).toBeUndefined();
    expect((await store.get("new"))?.commandId).toBe("new");
  });

  it("hydrates records from JSONL file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "codexbridge-audit-"));
    const file = path.join(dir, "audit.jsonl");
    try {
      const lines = [
        JSON.stringify({
          commandId: "h1",
          timestamp: "2026-02-13T00:00:00.000Z",
          status: "created",
          userId: "u1"
        }),
        JSON.stringify({
          commandId: "h1",
          timestamp: "2026-02-13T00:00:02.000Z",
          status: "agent_ok"
        })
      ].join("\n");
      await writeFile(file, lines, "utf8");

      const store = new AuditStore(new MemoryAuditIndexStore(), file);
      await store.hydrateFromDisk();
      const record = await store.get("h1");
      expect(record?.status).toBe("agent_ok");
      expect(record?.events.length).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
