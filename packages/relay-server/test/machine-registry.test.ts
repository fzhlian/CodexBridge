import { describe, expect, it } from "vitest";
import { MachineRegistry } from "../src/machine-registry.js";

describe("MachineRegistry", () => {
  it("stores and lists machine sessions", () => {
    const registry = new MachineRegistry();
    const socket = { send() {}, close() {} } as unknown as import("ws").default;
    registry.register("m1", socket);
    registry.markHeartbeat("m1", { runningCount: 1, pendingCount: 2 });

    const listed = registry.list();
    expect(listed.length).toBe(1);
    expect(listed[0]?.machineId).toBe("m1");
    expect(listed[0]?.runningCount).toBe(1);
    expect(listed[0]?.pendingCount).toBe(2);
    expect(registry.isOnline("m1")).toBe(true);
  });
});
