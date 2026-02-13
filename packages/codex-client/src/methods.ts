export const CODEX_METHODS = {
  COMPLETE: "complete",
  PLAN: "plan",
  PATCH: "patch"
} as const;

export type CodexMethod = (typeof CODEX_METHODS)[keyof typeof CODEX_METHODS];

