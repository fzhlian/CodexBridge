import * as vscode from "vscode";

export type ApprovalAction = "apply_diff" | "run_command";
export type ApprovalSource = "wecom" | "local_ui";
export type ApprovalDecision = "approved" | "rejected";

export type ApprovalRequest = {
  action: ApprovalAction;
  source?: ApprovalSource;
  question?: string;
  details?: string[];
  approveLabel?: string;
  rejectLabel?: string;
};

export async function requestApproval(
  request: ApprovalRequest
): Promise<ApprovalDecision> {
  const approveLabel = request.approveLabel ?? defaultApproveLabel(request.action);
  const rejectLabel = request.rejectLabel ?? "Reject";
  const question = request.question?.trim() || buildApprovalQuestion(request);
  const choice = await vscode.window.showWarningMessage(
    question,
    { modal: true },
    approveLabel,
    rejectLabel
  );
  return choice === approveLabel ? "approved" : "rejected";
}

export function buildApprovalQuestion(request: ApprovalRequest): string {
  const header = approvalHeader(request.action, request.source);
  const detailLines = (request.details ?? [])
    .map((line) => line.trim())
    .filter(Boolean);
  return [header, ...detailLines].join("\n");
}

export function defaultApproveLabel(action: ApprovalAction): string {
  return action === "apply_diff" ? "Apply Diff" : "Run Command";
}

function approvalHeader(action: ApprovalAction, source: ApprovalSource = "local_ui"): string {
  const sourceText = source === "wecom" ? "Source: WeCom" : "Source: Local UI";
  const actionText = action === "apply_diff" ? "Apply diff to workspace?" : "Execute command?";
  return `${actionText}\n${sourceText}`;
}

