export type ToolId = "vsix_install" | "git_command" | "shell_command";

export type ToolSeverity = "info" | "warn" | "error";

export type ToolDiagnostic = {
  code: string;
  message: string;
  severity: ToolSeverity;
  recoverable: boolean;
};

export type ToolExecutionResult = {
  code: number | null;
  cancelled: boolean;
  timedOut: boolean;
  outputTail: string;
};

export type ToolExecutionContext = {
  cwd: string;
  commandText: string;
  taskName: string;
  signal?: AbortSignal;
  timeoutMs: number;
  maxTailLines: number;
};

export type ToolExecutionPlan = {
  toolId: ToolId;
  input: unknown;
  commandPreview: string;
};

export type ToolPreflightResult = {
  ok: boolean;
  input?: unknown;
  diagnostics: ToolDiagnostic[];
};

export type ToolRecoveryDecision = {
  reason: string;
  nextCommandText: string;
};

export type ToolExecutionReport = ToolExecutionResult & {
  toolId: ToolId;
  executedCommand: string;
  diagnostics: ToolDiagnostic[];
  recoveryApplied: boolean;
};

export type ToolAuditEvent = {
  phase: "planned" | "preflight" | "execute" | "recover" | "done";
  toolId: ToolId;
  command: string;
  detail?: string;
};

export type ToolAuditSink = (event: ToolAuditEvent) => void;

export interface ToolDefinition {
  readonly id: ToolId;
  matches(commandText: string): ToolExecutionPlan | undefined;
  preflight?(
    plan: ToolExecutionPlan,
    context: ToolExecutionContext
  ): Promise<ToolPreflightResult>;
  execute(
    plan: ToolExecutionPlan,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult>;
  recover?(
    plan: ToolExecutionPlan,
    context: ToolExecutionContext,
    result: ToolExecutionResult
  ): Promise<ToolRecoveryDecision | undefined>;
}
