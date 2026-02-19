import { createHash } from "node:crypto";
import type { CommandKind } from "@codexbridge/shared";

export type CommandFingerprintInput = {
  userId: string;
  machineId: string;
  kind: CommandKind;
  prompt?: string;
  refId?: string;
};

export function shouldApplyCommandFingerprintDedupe(kind: CommandKind): boolean {
  return kind === "patch" || kind === "apply" || kind === "test";
}

export function buildCommandFingerprintKey(input: CommandFingerprintInput): string {
  const fingerprint = [
    normalizeSegment(input.userId),
    normalizeSegment(input.machineId),
    input.kind,
    normalizeSegment(input.refId),
    normalizeSegment(input.prompt)
  ].join("|");

  const hash = createHash("sha256").update(fingerprint, "utf8").digest("hex");
  return `cmdfp:${hash}`;
}

function normalizeSegment(raw?: string): string {
  return (raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
