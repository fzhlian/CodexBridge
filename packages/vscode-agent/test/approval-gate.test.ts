import { beforeEach, describe, expect, it, vi } from "vitest";

const { showWarningMessageMock } = vi.hoisted(() => ({
  showWarningMessageMock: vi.fn()
}));

vi.mock("vscode", () => ({
  window: {
    showWarningMessage: showWarningMessageMock
  }
}));
import {
  buildApprovalQuestion,
  defaultApproveLabel,
  requestApproval
} from "../src/nl/approvalGate.js";

describe("approvalGate", () => {
  beforeEach(() => {
    showWarningMessageMock.mockReset();
  });

  it("returns action-specific approve labels", () => {
    expect(defaultApproveLabel("apply_diff")).toBe("Apply Diff");
    expect(defaultApproveLabel("run_command")).toBe("Run Command");
  });

  it("builds question with source and details", () => {
    const question = buildApprovalQuestion({
      action: "run_command",
      source: "wecom",
      details: ["command: pnpm test", "cwd: D:/workspace"]
    });
    expect(question).toContain("Execute command?");
    expect(question).toContain("Source: WeCom");
    expect(question).toContain("command: pnpm test");
    expect(question).toContain("cwd: D:/workspace");
  });

  it("returns approved when user confirms", async () => {
    showWarningMessageMock.mockResolvedValueOnce("Apply Diff");
    await expect(requestApproval({ action: "apply_diff" })).resolves.toBe("approved");
    expect(showWarningMessageMock).toHaveBeenCalledTimes(1);
    expect(showWarningMessageMock.mock.calls[0]?.[0]).toContain("Apply diff to workspace?");
    expect(showWarningMessageMock.mock.calls[0]?.[1]).toEqual({ modal: true });
    expect(showWarningMessageMock.mock.calls[0]?.[2]).toBe("Apply Diff");
    expect(showWarningMessageMock.mock.calls[0]?.[3]).toBe("Reject");
  });

  it("returns rejected when user rejects or dismisses", async () => {
    showWarningMessageMock.mockResolvedValueOnce("Reject");
    await expect(requestApproval({ action: "run_command", source: "local_ui" })).resolves.toBe("rejected");

    showWarningMessageMock.mockResolvedValueOnce(undefined);
    await expect(requestApproval({
      action: "run_command",
      source: "wecom",
      details: ["command: pnpm test"]
    })).resolves.toBe("rejected");
    expect(showWarningMessageMock.mock.calls[1]?.[0]).toContain("Source: WeCom");
  });
});
