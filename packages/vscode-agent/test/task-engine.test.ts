import { describe, expect, it } from "vitest";
import { TaskEngine } from "../src/nl/taskEngine.js";
import type { TaskIntent } from "../src/nl/taskTypes.js";

const INTENT: TaskIntent = {
  kind: "explain",
  confidence: 0.9,
  summary: "explain router behavior"
};

describe("TaskEngine", () => {
  it("emits start and state transitions in order", () => {
    const states: string[] = [];
    const engine = new TaskEngine({
      onTaskStart: ({ taskId }) => states.push(`start:${taskId}`),
      onTaskState: ({ state }) => states.push(`state:${state}`)
    });
    const task = engine.createTask(
      {
        source: "local_ui",
        threadId: "default",
        text: "explain router"
      },
      INTENT
    );
    engine.updateState(task.taskId, "ROUTED");
    engine.updateState(task.taskId, "CONTEXT_COLLECTED");
    engine.updateState(task.taskId, "PROPOSING");
    engine.updateState(task.taskId, "PROPOSAL_READY");
    engine.updateState(task.taskId, "COMPLETED");
    expect(states[0]?.startsWith("start:")).toBe(true);
    expect(states).toEqual([
      states[0],
      "state:RECEIVED",
      "state:ROUTED",
      "state:CONTEXT_COLLECTED",
      "state:PROPOSING",
      "state:PROPOSAL_READY",
      "state:COMPLETED"
    ]);
  });

  it("rejects invalid state transitions", () => {
    const engine = new TaskEngine();
    const task = engine.createTask(
      {
        source: "local_ui",
        threadId: "default",
        text: "explain router"
      },
      INTENT
    );
    expect(() => engine.updateState(task.taskId, "COMPLETED")).toThrow(/invalid task transition/i);
  });
});

