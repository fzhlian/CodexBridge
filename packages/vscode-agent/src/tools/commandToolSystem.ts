import { createGitCommandTool } from "./builtins/gitCommandTool.js";
import { createShellCommandTool } from "./builtins/shellCommandTool.js";
import { createVsixInstallTool } from "./builtins/vsixInstallTool.js";
import { ToolRegistry } from "./registry.js";
import type {
  ToolAuditEvent,
  ToolAuditSink,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionPlan,
  ToolExecutionReport,
  ToolExecutionResult
} from "./types.js";

const DEFAULT_TIMEOUT_MS = Number(process.env.CODEX_TOOL_TIMEOUT_MS ?? "900000");
const DEFAULT_MAX_TAIL_LINES = Number(process.env.TEST_OUTPUT_TAIL_LINES ?? "80");

export type RunCommandThroughToolSystemInput = {
  commandText: string;
  cwd: string;
  taskName: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxTailLines?: number;
  audit?: ToolAuditSink;
};

type PlanExecution = {
  plan: ToolExecutionPlan;
  result: ToolExecutionResult;
  diagnostics: ToolExecutionReport["diagnostics"];
};

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createVsixInstallTool());
  registry.register(createGitCommandTool());
  registry.register(createShellCommandTool());
  return registry;
}

export async function runCommandThroughToolSystem(
  input: RunCommandThroughToolSystemInput
): Promise<ToolExecutionReport> {
  const registry = createDefaultToolRegistry();
  const context: ToolExecutionContext = {
    cwd: input.cwd,
    commandText: input.commandText.trim(),
    taskName: input.taskName,
    signal: input.signal,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxTailLines: input.maxTailLines ?? DEFAULT_MAX_TAIL_LINES
  };
  const audit = input.audit ?? (() => undefined);

  let initialPlan: ToolExecutionPlan;
  try {
    initialPlan = registry.plan(context.commandText);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      toolId: "shell_command",
      executedCommand: context.commandText,
      recoveryApplied: false,
      diagnostics: [{
        code: "tool.plan.unmatched",
        message: detail,
        severity: "error",
        recoverable: false
      }],
      code: 1,
      cancelled: false,
      timedOut: false,
      outputTail: detail
    };
  }
  auditEvent(audit, {
    phase: "planned",
    toolId: initialPlan.toolId,
    command: initialPlan.commandPreview
  });

  const first = await executePlan(registry, initialPlan, context, audit);
  if (isSuccessful(first.result)) {
    return {
      ...first.result,
      toolId: first.plan.toolId,
      executedCommand: first.plan.commandPreview,
      diagnostics: first.diagnostics,
      recoveryApplied: false
    };
  }

  const firstTool = registry.get(first.plan.toolId);
  if (!firstTool?.recover) {
    return {
      ...first.result,
      toolId: first.plan.toolId,
      executedCommand: first.plan.commandPreview,
      diagnostics: first.diagnostics,
      recoveryApplied: false
    };
  }

  const decision = await firstTool.recover(first.plan, context, first.result);
  if (!decision?.nextCommandText?.trim()) {
    return {
      ...first.result,
      toolId: first.plan.toolId,
      executedCommand: first.plan.commandPreview,
      diagnostics: first.diagnostics,
      recoveryApplied: false
    };
  }

  let recoveredPlan: ToolExecutionPlan;
  try {
    recoveredPlan = registry.plan(decision.nextCommandText.trim());
  } catch {
    return {
      ...first.result,
      toolId: first.plan.toolId,
      executedCommand: first.plan.commandPreview,
      diagnostics: [
        ...first.diagnostics,
        {
          code: "tool.recover.unmatched",
          message: `recovery generated unsupported command: ${decision.nextCommandText}`,
          severity: "warn",
          recoverable: false
        }
      ],
      recoveryApplied: false
    };
  }

  auditEvent(audit, {
    phase: "recover",
    toolId: recoveredPlan.toolId,
    command: recoveredPlan.commandPreview,
    detail: decision.reason
  });
  const recovered = await executePlan(registry, recoveredPlan, context, audit);
  const recoveryNote = `recovered by tool-system: ${decision.reason}`;
  const mergedOutputTail = [recoveryNote, recovered.result.outputTail].filter(Boolean).join("\n");
  return {
    ...recovered.result,
    outputTail: mergedOutputTail.trim(),
    toolId: recovered.plan.toolId,
    executedCommand: recovered.plan.commandPreview,
    diagnostics: [...first.diagnostics, ...recovered.diagnostics],
    recoveryApplied: true
  };
}

async function executePlan(
  registry: ToolRegistry,
  plan: ToolExecutionPlan,
  context: ToolExecutionContext,
  audit: ToolAuditSink
): Promise<PlanExecution> {
  const tool = mustGetTool(registry, plan.toolId);
  const preflight = tool.preflight
    ? await tool.preflight(plan, context)
    : {
      ok: true,
      input: plan.input,
      diagnostics: []
    };
  auditEvent(audit, {
    phase: "preflight",
    toolId: plan.toolId,
    command: plan.commandPreview,
    detail: preflight.ok ? "ok" : "failed"
  });

  const diagnostics = [...preflight.diagnostics];
  if (!preflight.ok) {
    const message = diagnostics.map((item) => item.message).join("\n").trim()
      || "tool preflight failed";
    const result: ToolExecutionResult = {
      code: 1,
      cancelled: false,
      timedOut: false,
      outputTail: message
    };
    auditEvent(audit, {
      phase: "done",
      toolId: plan.toolId,
      command: plan.commandPreview,
      detail: "preflight_failed"
    });
    return { plan, result, diagnostics };
  }

  const effectivePlan = preflight.input !== undefined
    ? { ...plan, input: preflight.input }
    : plan;
  auditEvent(audit, {
    phase: "execute",
    toolId: effectivePlan.toolId,
    command: effectivePlan.commandPreview
  });
  const result = await tool.execute(effectivePlan, context);
  auditEvent(audit, {
    phase: "done",
    toolId: effectivePlan.toolId,
    command: effectivePlan.commandPreview,
    detail: isSuccessful(result) ? "ok" : "error"
  });
  return {
    plan: effectivePlan,
    result,
    diagnostics
  };
}

function mustGetTool(registry: ToolRegistry, toolId: ToolExecutionPlan["toolId"]): ToolDefinition {
  const tool = registry.get(toolId);
  if (!tool) {
    throw new Error(`tool not found: ${toolId}`);
  }
  return tool;
}

function isSuccessful(result: ToolExecutionResult): boolean {
  return result.code === 0 && !result.cancelled && !result.timedOut;
}

function auditEvent(audit: ToolAuditSink, event: ToolAuditEvent): void {
  try {
    audit(event);
  } catch {
    // ignore audit sink failures
  }
}
