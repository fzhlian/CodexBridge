export const CODEX_METHODS = {
  INITIALIZE: "initialize",
  COMPLETE: "complete",
  PLAN: "plan",
  PATCH: "patch",
  COMMAND_EXEC: "command/exec"
} as const;

export type CodexMethod = (typeof CODEX_METHODS)[keyof typeof CODEX_METHODS];
