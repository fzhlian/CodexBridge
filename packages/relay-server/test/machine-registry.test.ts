import { describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { MachineRegistry } from "../src/machine-registry.js";
import { MemoryMachineStateStore } from "../src/memory-stores.js";

describe("MachineRegistry", () => {
  it("stores and lists machine sessions", async () => {
    const registry = new MachineRegistry(new MemoryMachineStateStore(), 60_000);
    const socket = { send() {}, close() {} } as unknown as WebSocket;
    await registry.register("m1", socket);
    await registry.markHeartbeat("m1", { runningCount: 1, pendingCount: 2 });

    const listed = await registry.list();
    expect(listed.length).toBe(1);
    expect(listed[0]?.machineId).toBe("m1");
    expect(listed[0]?.runningCount).toBe(1);
    expect(listed[0]?.pendingCount).toBe(2);
    expect(registry.getSocket("m1")).toBe(socket);
  });
});
