import { describe, expect, it } from "vitest";
import {
  buildCommandFingerprintKey,
  shouldApplyCommandFingerprintDedupe
} from "../src/command-dedupe.js";

describe("command dedupe fingerprint", () => {
  it("produces same fingerprint for equivalent patch payloads", () => {
    const a = buildCommandFingerprintKey({
      userId: "WangGangWu",
      machineId: "dev-machine-1",
      kind: "patch",
      prompt: "  Patch   README.md  add one line  ",
      refId: undefined
    });
    const b = buildCommandFingerprintKey({
      userId: "wanggangwu",
      machineId: "DEV-machine-1",
      kind: "patch",
      prompt: "patch README.md add one line",
      refId: undefined
    });
    expect(a).toBe(b);
  });

  it("produces different fingerprints for different payloads", () => {
    const patchA = buildCommandFingerprintKey({
      userId: "u1",
      machineId: "m1",
      kind: "patch",
      prompt: "patch a",
      refId: undefined
    });
    const patchB = buildCommandFingerprintKey({
      userId: "u1",
      machineId: "m1",
      kind: "patch",
      prompt: "patch b",
      refId: undefined
    });
    expect(patchA).not.toBe(patchB);
  });

  it("enables short-window dedupe for high-cost command kinds only", () => {
    expect(shouldApplyCommandFingerprintDedupe("patch")).toBe(true);
    expect(shouldApplyCommandFingerprintDedupe("apply")).toBe(true);
    expect(shouldApplyCommandFingerprintDedupe("test")).toBe(true);
    expect(shouldApplyCommandFingerprintDedupe("task")).toBe(false);
    expect(shouldApplyCommandFingerprintDedupe("plan")).toBe(false);
    expect(shouldApplyCommandFingerprintDedupe("status")).toBe(false);
    expect(shouldApplyCommandFingerprintDedupe("help")).toBe(false);
  });
});
