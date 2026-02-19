type LocaleCode = "en" | "zh-CN";

const EN_MESSAGES = {
  "errors.hintPrefix": "Hint: {hint}",

  "codex.fallback.completeUnavailable":
    "Codex complete RPC unavailable. Enable setting codexbridge.chat.enableExecFallback or set CODEX_CHAT_ENABLE_EXEC_FALLBACK=1.",
  "codex.fallback.completeUnavailableHint":
    "Enable VS Code setting codexbridge.chat.enableExecFallback, or set CODEX_CHAT_ENABLE_EXEC_FALLBACK=1 and restart the extension host.",
  "codex.fallback.execTimedOut":
    "Codex exec fallback timed out in sandbox.",
  "codex.fallback.execTimedOutHint":
    "Try a shorter request, reduce context size, or adjust timeout and sandbox settings.",
  "codex.fallback.invalidExecResponse": "invalid command/exec response",
  "codex.fallback.execFailed": "codex exec failed",
  "codex.fallback.execMissingAssistantMessage": "codex exec returned no assistant message",

  "chat.warn.invalidWebviewMessage": "Ignored invalid chat message from webview.",
  "chat.warn.chatViewDisabled": "Chat view is disabled by settings.",
  "chat.warn.uiProtocolVersionMismatch": "UI protocol version mismatch: {version}",
  "chat.warn.emptyMessage": "Cannot send an empty message.",
  "chat.error.codexResponseFailed": "Failed to get response from Codex.",
  "chat.error.codexRequestFailed": "Codex request failed: {message}",
  "chat.error.agentCommandFailed": "Agent command failed.",
  "chat.error.agentCommandFailedWithReason": "Agent command failed: {message}",
  "chat.error.remoteAgentCommandFailedWithReason": "agent native command failed: {message}",
  "chat.error.applyRequiresRefId": "apply command requires a valid refId.",
  "chat.error.taskMissingPrompt": "task missing prompt",
  "chat.error.taskExecutionCancelled": "Task execution cancelled.",
  "chat.error.taskExecutionFailed": "Task execution failed.",
  "chat.error.taskExecutionFailedWithReason": "task execution failed: {message}",
  "chat.error.taskCancelledInternal": "task cancelled",
  "chat.error.patchGenerationFailed": "Patch generation failed.",
  "chat.error.patchGenerationFailedWithReason": "Patch generation failed: {message}",
  "chat.error.missingPatchPrompt": "Missing patch prompt.",
  "chat.error.patchMissingPromptSummary": "patch missing prompt",
  "chat.error.patchInvalidDiffSummary": "codex returned invalid patch format",
  "chat.error.patchTooLargeSummary": "patch too large; max {maxBytes} bytes",
  "chat.error.patchGenerationCancelledSummary": "patch generation cancelled",
  "chat.error.codexPatchGenerationFailedWithReason": "codex patch generation failed: {message}",
  "chat.error.applyMissingRefIdSummary": "apply missing refId",
  "chat.error.applyMissingCachedPatchSummary": "no cached patch found for refId={refId}",
  "chat.error.noWorkspaceOpen": "No workspace is open.",
  "chat.error.patchPromptRequired": "Missing patch prompt. Use /patch <prompt>.",
  "chat.error.patchPromptAttachmentRequired": "Slash command /patch requires a prompt.",
  "chat.error.patchWorkspaceRequired": "Patch generation requires an open workspace folder.",
  "chat.error.retryTaskNotFound": "task not found for retry: {taskId}",
  "chat.error.retryTaskFailed": "retry failed: {message}",
  "chat.error.unknownTask": "unknown task: {taskId}",
  "chat.error.taskAlreadyFinished": "task already finished: {taskId}",
  "chat.state.cancelledWhileWaitingApproval": "Cancelled while waiting for approval.",
  "chat.state.executingApprovedDiff": "Applying approved diff...",
  "chat.state.executingApprovedCommand": "Executing approved command...",
  "chat.state.executionStarted": "Execution started.",
  "chat.info.cancelRequestedTask": "cancel requested for task {taskId}",
  "chat.info.cancelRequestedToast": "Cancel requested: {taskIdShort}",

  "chatActions.error.diffNotFound": "diff not found: {diffId}",
  "chatActions.error.diffNoPreviewableFiles": "diff has no previewable files",
  "chatActions.error.diffPreviewCancelled": "diff preview cancelled",
  "chatActions.error.selectedDiffFileNotFound": "selected diff file not found",
  "chatActions.error.applyDisabled": "apply is disabled by codexbridge.allowApplyPatch",
  "chatActions.error.applyRejected": "apply rejected by local user",
  "chatActions.error.applyFailed": "apply failed: {message}",
  "chatActions.error.testDisabled": "test execution is disabled by codexbridge.allowRunTerminal",
  "chatActions.error.testNotAllowed": "test command not allowed: {command}",
  "chatActions.error.testRejected": "test execution rejected by local user",
  "chatActions.error.testCancelled": "test cancelled: {command}",
  "chatActions.error.testTimedOut": "test timed out: {command}",
  "chatActions.error.commandDisabled": "command execution is disabled by codexbridge.allowRunTerminal",
  "chatActions.error.commandEmpty": "empty command cannot be executed",
  "chatActions.error.commandRejected": "command execution rejected by local user",
  "chatActions.error.commandCancelled": "command cancelled: {command}",
  "chatActions.error.commandTimedOut": "command timed out: {command}",
  "chatActions.prompt.selectDiffPreviewFile": "Select file to preview diff",
  "chatActions.prompt.applyLabel": "Apply",
  "chatActions.prompt.applyDiffToWorkspace": "Apply diff to workspace?",
  "chatActions.prompt.moreFiles": "... and {count} more files",
  "chatActions.prompt.runTestLabel": "Run Test",
  "chatActions.prompt.runCommandLabel": "Run Command",
  "chatActions.prompt.commandLabel": "command",
  "chatActions.prompt.cwdLabel": "cwd",

  "agent.error.commandExecutionFailure": "command execution failure"
} as const;

type MessageKey = keyof typeof EN_MESSAGES;

const ZH_CN_MESSAGES: Record<MessageKey, string> = {
  "errors.hintPrefix": "\u63d0\u793a\uff1a{hint}",

  "codex.fallback.completeUnavailable":
    "Codex complete RPC \u4e0d\u53ef\u7528\u3002\u8bf7\u542f\u7528\u8bbe\u7f6e codexbridge.chat.enableExecFallback\uff0c\u6216\u8bbe\u7f6e CODEX_CHAT_ENABLE_EXEC_FALLBACK=1\u3002",
  "codex.fallback.completeUnavailableHint":
    "\u8bf7\u542f\u7528 VS Code \u8bbe\u7f6e codexbridge.chat.enableExecFallback\uff0c\u6216\u8bbe\u7f6e CODEX_CHAT_ENABLE_EXEC_FALLBACK=1 \u540e\u91cd\u542f\u6269\u5c55\u4e3b\u673a\u3002",
  "codex.fallback.execTimedOut":
    "Codex exec \u56de\u9000\u5728 sandbox \u4e2d\u6267\u884c\u8d85\u65f6\u3002",
  "codex.fallback.execTimedOutHint":
    "\u53ef\u4ee5\u5c1d\u8bd5\u7f29\u77ed\u8bf7\u6c42\u3001\u51cf\u5c11\u4e0a\u4e0b\u6587\uff0c\u6216\u8c03\u6574\u8d85\u65f6\u4e0e sandbox \u76f8\u5173\u8bbe\u7f6e\u3002",
  "codex.fallback.invalidExecResponse": "command/exec \u54cd\u5e94\u65e0\u6548",
  "codex.fallback.execFailed": "codex exec \u6267\u884c\u5931\u8d25",
  "codex.fallback.execMissingAssistantMessage": "codex exec \u672a\u8fd4\u56de assistant \u6d88\u606f",

  "chat.warn.invalidWebviewMessage": "\u5ffd\u7565\u4e86\u6765\u81ea webview \u7684\u65e0\u6548\u804a\u5929\u6d88\u606f\u3002",
  "chat.warn.chatViewDisabled": "\u804a\u5929\u89c6\u56fe\u5df2\u88ab\u8bbe\u7f6e\u7981\u7528\u3002",
  "chat.warn.uiProtocolVersionMismatch": "UI \u534f\u8bae\u7248\u672c\u4e0d\u5339\u914d\uff1a{version}",
  "chat.warn.emptyMessage": "\u4e0d\u80fd\u53d1\u9001\u7a7a\u6d88\u606f\u3002",
  "chat.error.codexResponseFailed": "\u672a\u80fd\u4ece Codex \u83b7\u53d6\u54cd\u5e94\u3002",
  "chat.error.codexRequestFailed": "Codex \u8bf7\u6c42\u5931\u8d25\uff1a{message}",
  "chat.error.agentCommandFailed": "Agent \u547d\u4ee4\u6267\u884c\u5931\u8d25\u3002",
  "chat.error.agentCommandFailedWithReason": "Agent \u547d\u4ee4\u6267\u884c\u5931\u8d25\uff1a{message}",
  "chat.error.remoteAgentCommandFailedWithReason": "agent native \u547d\u4ee4\u6267\u884c\u5931\u8d25\uff1a{message}",
  "chat.error.applyRequiresRefId": "apply \u547d\u4ee4\u9700\u8981\u6709\u6548\u7684 refId\u3002",
  "chat.error.taskMissingPrompt": "\u4efb\u52a1\u7f3a\u5c11 prompt",
  "chat.error.taskExecutionCancelled": "\u4efb\u52a1\u6267\u884c\u5df2\u53d6\u6d88\u3002",
  "chat.error.taskExecutionFailed": "\u4efb\u52a1\u6267\u884c\u5931\u8d25\u3002",
  "chat.error.taskExecutionFailedWithReason": "\u4efb\u52a1\u6267\u884c\u5931\u8d25\uff1a{message}",
  "chat.error.taskCancelledInternal": "\u4efb\u52a1\u5df2\u53d6\u6d88",
  "chat.error.patchGenerationFailed": "Patch \u751f\u6210\u5931\u8d25\u3002",
  "chat.error.patchGenerationFailedWithReason": "Patch \u751f\u6210\u5931\u8d25\uff1a{message}",
  "chat.error.missingPatchPrompt": "\u7f3a\u5c11 patch prompt\u3002",
  "chat.error.patchMissingPromptSummary": "patch \u7f3a\u5c11 prompt",
  "chat.error.patchInvalidDiffSummary": "codex \u8fd4\u56de\u7684 patch \u683c\u5f0f\u65e0\u6548",
  "chat.error.patchTooLargeSummary": "patch \u8fc7\u5927\uff0c\u4e0a\u9650 {maxBytes} \u5b57\u8282",
  "chat.error.patchGenerationCancelledSummary": "patch \u751f\u6210\u5df2\u53d6\u6d88",
  "chat.error.codexPatchGenerationFailedWithReason": "codex patch \u751f\u6210\u5931\u8d25\uff1a{message}",
  "chat.error.applyMissingRefIdSummary": "apply \u7f3a\u5c11 refId",
  "chat.error.applyMissingCachedPatchSummary": "\u672a\u627e\u5230 refId={refId} \u5bf9\u5e94\u7684\u7f13\u5b58 patch",
  "chat.error.noWorkspaceOpen": "\u5f53\u524d\u6ca1\u6709\u6253\u5f00\u5de5\u4f5c\u533a\u3002",
  "chat.error.patchPromptRequired": "\u7f3a\u5c11 patch prompt\u3002\u8bf7\u4f7f\u7528 /patch <prompt>\u3002",
  "chat.error.patchPromptAttachmentRequired": "\u659c\u6760\u547d\u4ee4 /patch \u5fc5\u987b\u5e26 prompt\u3002",
  "chat.error.patchWorkspaceRequired": "Patch \u751f\u6210\u9700\u8981\u5148\u6253\u5f00\u5de5\u4f5c\u533a\u6587\u4ef6\u5939\u3002",
  "chat.error.retryTaskNotFound": "\u672a\u627e\u5230\u53ef\u91cd\u8bd5\u7684\u4efb\u52a1\uff1a{taskId}",
  "chat.error.retryTaskFailed": "\u4efb\u52a1\u91cd\u8bd5\u5931\u8d25\uff1a{message}",
  "chat.error.unknownTask": "\u672a\u77e5\u4efb\u52a1\uff1a{taskId}",
  "chat.error.taskAlreadyFinished": "\u4efb\u52a1\u5df2\u7ecf\u7ed3\u675f\uff1a{taskId}",
  "chat.state.cancelledWhileWaitingApproval": "\u7b49\u5f85\u5ba1\u6279\u65f6\u5df2\u53d6\u6d88\u3002",
  "chat.state.executingApprovedDiff": "\u6b63\u5728\u5e94\u7528\u5df2\u6279\u51c6\u7684 diff...",
  "chat.state.executingApprovedCommand": "\u6b63\u5728\u6267\u884c\u5df2\u6279\u51c6\u7684\u547d\u4ee4...",
  "chat.state.executionStarted": "\u5df2\u5f00\u59cb\u6267\u884c\u3002",
  "chat.info.cancelRequestedTask": "\u5df2\u53d1\u9001\u53d6\u6d88\u8bf7\u6c42\uff0c\u4efb\u52a1 {taskId}",
  "chat.info.cancelRequestedToast": "\u5df2\u8bf7\u6c42\u53d6\u6d88\uff1a{taskIdShort}",

  "chatActions.error.diffNotFound": "\u672a\u627e\u5230 diff\uff1a{diffId}",
  "chatActions.error.diffNoPreviewableFiles": "diff \u4e2d\u6ca1\u6709\u53ef\u9884\u89c8\u7684\u6587\u4ef6",
  "chatActions.error.diffPreviewCancelled": "diff \u9884\u89c8\u5df2\u53d6\u6d88",
  "chatActions.error.selectedDiffFileNotFound": "\u672a\u627e\u5230\u6240\u9009\u7684 diff \u6587\u4ef6",
  "chatActions.error.applyDisabled": "apply \u5df2\u88ab codexbridge.allowApplyPatch \u7981\u7528",
  "chatActions.error.applyRejected": "\u672c\u5730\u7528\u6237\u62d2\u7edd\u4e86 apply",
  "chatActions.error.applyFailed": "apply \u5931\u8d25\uff1a{message}",
  "chatActions.error.testDisabled": "\u6d4b\u8bd5\u6267\u884c\u5df2\u88ab codexbridge.allowRunTerminal \u7981\u7528",
  "chatActions.error.testNotAllowed": "\u6d4b\u8bd5\u547d\u4ee4\u4e0d\u5141\u8bb8\uff1a{command}",
  "chatActions.error.testRejected": "\u672c\u5730\u7528\u6237\u62d2\u7edd\u4e86\u6d4b\u8bd5\u6267\u884c",
  "chatActions.error.testCancelled": "\u6d4b\u8bd5\u5df2\u53d6\u6d88\uff1a{command}",
  "chatActions.error.testTimedOut": "\u6d4b\u8bd5\u5df2\u8d85\u65f6\uff1a{command}",
  "chatActions.error.commandDisabled": "\u547d\u4ee4\u6267\u884c\u5df2\u88ab codexbridge.allowRunTerminal \u7981\u7528",
  "chatActions.error.commandEmpty": "\u7a7a\u547d\u4ee4\u4e0d\u80fd\u6267\u884c",
  "chatActions.error.commandRejected": "\u672c\u5730\u7528\u6237\u62d2\u7edd\u4e86\u547d\u4ee4\u6267\u884c",
  "chatActions.error.commandCancelled": "\u547d\u4ee4\u5df2\u53d6\u6d88\uff1a{command}",
  "chatActions.error.commandTimedOut": "\u547d\u4ee4\u5df2\u8d85\u65f6\uff1a{command}",
  "chatActions.prompt.selectDiffPreviewFile": "\u9009\u62e9\u8981\u9884\u89c8\u7684 diff \u6587\u4ef6",
  "chatActions.prompt.applyLabel": "\u5e94\u7528",
  "chatActions.prompt.applyDiffToWorkspace": "\u786e\u8ba4\u5c06 diff \u5e94\u7528\u5230\u5de5\u4f5c\u533a\u5417\uff1f",
  "chatActions.prompt.moreFiles": "\u8fd8\u6709 {count} \u4e2a\u6587\u4ef6...",
  "chatActions.prompt.runTestLabel": "\u8fd0\u884c\u6d4b\u8bd5",
  "chatActions.prompt.runCommandLabel": "\u8fd0\u884c\u547d\u4ee4",
  "chatActions.prompt.commandLabel": "\u547d\u4ee4",
  "chatActions.prompt.cwdLabel": "\u5de5\u4f5c\u76ee\u5f55",

  "agent.error.commandExecutionFailure": "\u547d\u4ee4\u6267\u884c\u5931\u8d25"
};

export function t(
  key: MessageKey,
  vars?: Record<string, string | number>
): string {
  const locale = resolveLocale();
  const template = (locale === "zh-CN" ? ZH_CN_MESSAGES[key] : EN_MESSAGES[key]) ?? EN_MESSAGES[key] ?? key;
  if (!vars) {
    return template;
  }
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, name: string) => {
    if (!(name in vars)) {
      return full;
    }
    return String(vars[name]);
  });
}

function resolveLocale(): LocaleCode {
  const fromEnv = process.env.CODEXBRIDGE_UI_LOCALE?.trim();
  if (fromEnv) {
    return normalizeLocale(fromEnv);
  }

  const fromVscodeNls = parseVscodeNlsLocale(process.env.VSCODE_NLS_CONFIG);
  if (fromVscodeNls) {
    return normalizeLocale(fromVscodeNls);
  }

  const fromLang = process.env.LANG?.trim();
  if (fromLang) {
    return normalizeLocale(fromLang);
  }
  return "en";
}

function normalizeLocale(raw: string): LocaleCode {
  return raw.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function parseVscodeNlsLocale(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { locale?: unknown };
    return typeof parsed.locale === "string" ? parsed.locale : undefined;
  } catch {
    return undefined;
  }
}
