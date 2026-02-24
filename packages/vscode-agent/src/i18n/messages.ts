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
  "chat.state.verifyingChanges": "Running validation: {command}",
  "chat.state.verificationSkippedRunDisabled":
    "Validation skipped (allowRunTerminal disabled): {command}",
  "chat.state.verificationSkippedCommandNotAllowed":
    "Validation skipped (command not allowed): {command}",
  "chat.state.verificationPassed": "Validation passed: {command}",
  "chat.state.verificationFailed": "Validation failed (exit={code}): {command}",
  "chat.state.verificationTimedOut": "Validation timed out: {command}",
  "chat.state.verificationCancelled": "Validation cancelled: {command}",
  "chat.info.cancelRequestedTask": "cancel requested for task {taskId}",
  "chat.info.cancelRequestedToast": "Cancel requested: {taskIdShort}",
  "chat.gitSync.collectingStatusAndDiffMetadata": "Collecting git status and diff metadata...",
  "chat.gitSync.summarizingChanges": "Summarizing changes...",
  "chat.gitSync.preparingProposal": "Preparing Git Sync proposal...",
  "chat.gitSync.taskNotFound": "Git Sync task not found: {taskId}",
  "chat.gitSync.taskAlreadyExecuting": "Git Sync task is already executing.",
  "chat.gitSync.noPendingActions": "No pending Git Sync actions.",
  "chat.gitSync.runAllApprovalRejectedState": "Git Sync run-all approval rejected.",
  "chat.gitSync.runAllApprovalRejectedMilestone": "Git Sync approval rejected locally.",
  "chat.gitSync.executionRejectedLocally": "Git Sync execution was rejected locally.",
  "chat.gitSync.executingApprovedActions": "Executing approved Git Sync actions...",
  "chat.gitSync.stepNotAvailableInPlan": "Step not available in current plan: {stepId}",
  "chat.gitSync.stepAlreadyCompleted": "Step already completed: {stepId}",
  "chat.gitSync.stepApprovalRejectedState": "Approval rejected for step: {stepId}",
  "chat.gitSync.stepApprovalRejectedMilestone": "Git Sync step approval rejected: {stepId}",
  "chat.gitSync.stepRejectedLocally": "Git Sync step was rejected locally: {stepId}",
  "chat.gitSync.executingStep": "Executing: {stepId}",
  "chat.gitSync.stepCompletedWaitingApproval":
    "Step completed: {stepId}. Waiting approval for remaining actions.",
  "chat.gitSync.stepCompleted": "Step completed: {stepId}",
  "chat.gitSync.unknownStepAction": "Unknown step action: {stepId}",
  "chat.gitSync.stepExecutingMilestone": "Executing: {stepId}",
  "chat.gitSync.addCompleted": "git add -A completed.",
  "chat.gitSync.addFailed": "git add -A failed.",
  "chat.gitSync.missingCommitMessage": "Missing commit message for git commit.",
  "chat.gitSync.commitCompleted": "git commit completed.",
  "chat.gitSync.commitFailed": "git commit failed.",
  "chat.gitSync.pushCompleted": "git push completed.",
  "chat.gitSync.pushFailed": "git push failed.",
  "chat.gitSync.stepFailedSummary": "{stepId} failed: {message}",
  "chat.gitSync.completedPrefix": "Git Sync completed.",
  "chat.gitSync.prereqApproveAddBeforeCommit": "Approve Add before Commit.",
  "chat.gitSync.prereqApproveCommitBeforePush": "Approve Commit before Push.",
  "chat.gitSync.detailRepo": "repo: {repo}",
  "chat.gitSync.detailBranch": "branch: {branch}",
  "chat.gitSync.detailUpstream": "upstream: {upstream}",
  "chat.gitSync.detailStepsHeader": "steps:",
  "chat.gitSync.detailCommitMessage": "commit message: {message}",
  "chat.gitSync.detailPushWarning": "warning: git push will modify remote repository state.",
  "chat.gitSync.runAllApprovalQuestion": "Execute Git Sync action plan?",
  "chat.gitSync.approvePushLabel": "Approve & Push",
  "chat.gitSync.approveRunAllLabel": "Approve & Run All",
  "chat.gitSync.rejectLabel": "Reject",
  "chat.gitSync.detailCommand": "command: {command}",
  "chat.gitSync.stepApprovalQuestion": "Execute Git Sync step: {stepId}?",
  "chat.gitSync.approveStepLabel": "Approve {stepId}",
  "chat.gitSync.cardTitle": "Git Sync",
  "chat.gitSync.cancelRequestedMilestone": "Git Sync task cancellation requested.",
  "chat.gitSync.cancelledWhileWaitingApprovalMilestone":
    "Git Sync task cancelled while waiting approval.",
  "chat.gitSync.proposalReadyTitle": "Git Sync proposal ready.",
  "chat.gitSync.summaryBranchUpstream": "branch: {branch}  upstream: {upstream}",
  "chat.gitSync.summaryAheadBehind": "ahead/behind: {ahead}/{behind}",
  "chat.gitSync.summaryChanges":
    "changes: staged={staged} unstaged={unstaged} untracked={untracked}",
  "chat.gitSync.summaryDiffStat": "diffStat: {diffStat}",
  "chat.gitSync.summaryCommit": "commit: {message}",
  "chat.gitSync.summaryPlannedSteps": "planned steps:",
  "chat.gitSync.summaryNote": "note: {note}",
  "chat.gitSync.placeholderDetached": "(detached)",
  "chat.gitSync.placeholderNone": "(none)",
  "chat.gitSync.placeholderNoDiffStat": "(no diff stat)",
  "chat.task.waitingApproval.gitSyncPlanReady":
    "Git sync proposal ready. Waiting for local approval on add/commit/push actions.",
  "chat.task.waitingApproval.diffProposalReady":
    "Diff proposal ready. Waiting for local approval to apply.",
  "chat.task.waitingApproval.commandProposalReady":
    "Command proposal ready. Waiting for local approval to run.",
  "chat.task.attachment.commandProposalTitle": "Command Proposal",
  "chat.task.attachment.validationLogsTitle": "Validation Output",
  "chat.task.attachment.searchResultsTitle": "Search Results",
  "chat.task.render.commandLine": "command: {command}",
  "chat.task.render.cwdLine": "cwd: {cwd}",
  "chat.remote.processing": "Processing remote command...",
  "chat.remote.unknownCommand": "unknown command",
  "chat.remoteResult.taskIdLine": "taskId={taskId}",
  "chat.remoteResult.intentLine": "intent={intent}",
  "chat.remoteResult.summaryLine": "summary={summary}",
  "chat.remoteResult.diffLine": "diff={count} files (+{additions} -{deletions})",
  "chat.remoteResult.commandLine": "command={command}",
  "chat.remoteResult.statusProposalReadyLine": "status=proposal_ready",
  "chat.remoteResult.branchLine": "branch={branch}",
  "chat.remoteResult.upstreamLine": "upstream={upstream}",
  "chat.remoteResult.changesLine": "changes={changes}",
  "chat.remoteResult.stepsLine": "steps={steps}",
  "chat.remoteResult.finalSummaryLine": "finalSummary={summary}",
  "chat.remoteResult.nextWaitingApprovalLine": "next=waiting for local approval on {machineId}",
  "chat.remoteResult.none": "none",
  "chat.remoteResult.intentKind.help": "help",
  "chat.remoteResult.intentKind.status": "status",
  "chat.remoteResult.intentKind.explain": "explain",
  "chat.remoteResult.intentKind.change": "change",
  "chat.remoteResult.intentKind.run": "run",
  "chat.remoteResult.intentKind.gitSync": "git sync",
  "chat.remoteResult.intentKind.diagnose": "diagnose",
  "chat.remoteResult.intentKind.search": "search",
  "chat.remoteResult.intentKind.review": "review",

  "taskRunner.help.lineIntro": "Natural language task kinds:",
  "taskRunner.help.lineExplain": "- explain",
  "taskRunner.help.lineChange": "- change",
  "taskRunner.help.lineDiagnose": "- diagnose",
  "taskRunner.help.lineRun": "- run (proposal only, local approval required)",
  "taskRunner.help.lineGitSync":
    "- git_sync (status + add/commit/push proposal, local approval required)",
  "taskRunner.help.lineSearch": "- search",
  "taskRunner.help.lineReview": "- review",
  "taskRunner.help.summary": "Help is ready.",
  "taskRunner.help.details": "Use @dev <natural language> or type directly in chat.",
  "taskRunner.status.summary": "Workspace status collected.",
  "taskRunner.status.fieldWorkspace": "workspace",
  "taskRunner.status.fieldPlatform": "platform",
  "taskRunner.status.fieldNode": "node",
  "taskRunner.status.fieldGitBranch": "git_branch",
  "taskRunner.status.fieldGitChanged": "git_changed",
  "taskRunner.status.valueNotOpen": "not_open",
  "taskRunner.search.noMatches": "No matches found.",
  "taskRunner.search.summary": "Search completed: {count} result(s).",
  "taskRunner.review.summaryReady": "Review summary is ready.",
  "taskRunner.run.summaryReady": "Command proposal ready: {command}",
  "taskRunner.run.waitingApproval": "Waiting for local approval to run this command.",
  "taskRunner.change.workspaceRequired":
    "No workspace is open. Open a workspace before generating a diff proposal.",
  "taskRunner.change.strictRetryFailed": "strict retry failed: {reason}",
  "taskRunner.change.completionFallbackFailed": "completion fallback failed: {reason}",
  "taskRunner.change.diffGenerationFailed": "Diff generation failed: {reasons}",
  "taskRunner.fallback.planTitle": "Could not produce a safe executable proposal.",
  "taskRunner.fallback.reason": "Reason: {reason}",
  "taskRunner.fallback.suggest":
    "Suggested next step: refine the request with explicit files and expected output.",
  "taskRunner.explain.timeoutReturnedReview":
    "Codex timed out for this request. Returned local review summary instead.",
  "taskRunner.explain.timeoutReviewSummary":
    "Codex timed out; local review summary returned.",
  "taskRunner.explain.timeout": "Codex timed out for this request.",
  "taskRunner.explain.reason": "Reason: {reason}",
  "taskRunner.explain.suggest": "Try narrowing the request or selecting specific files.",
  "taskRunner.explain.timeoutSummary": "Codex timed out.",
  "taskRunner.review.workspaceRequired":
    "No workspace is open. Open a workspace to review local diff.",
  "taskRunner.review.unableReadDiffStat": "Unable to read git diff --stat.",
  "taskRunner.review.noLocalDiff": "No local diff found.",
  "taskRunner.search.pathMatchPreview": "path match",
  "taskRunner.diff.error.noValidDiffInCompletion":
    "model completion returned no valid unified diff",
  "taskRunner.diff.generatedByCompletionFallback":
    "patch generated by completion fallback",
  "taskRunner.diff.error.invalidUnifiedDiff":
    "Diff proposal was not in valid unified diff format.",
  "taskRunner.diff.filesSummary": "Files: {count}, +{additions}, -{deletions}",
  "taskRunner.diff.summaryReady":
    "Diff proposal ready: {count} file(s), +{additions}, -{deletions}.",

  "taskRunner.gitSync.disabledText": "Git sync is disabled by codexbridge.git.enable.",
  "taskRunner.gitSync.disabledSummary": "Git sync is disabled by configuration.",
  "taskRunner.gitSync.disabledDetails":
    "Set codexbridge.git.enable=true to enable git sync planning.",
  "taskRunner.gitSync.workspaceRequired":
    "No workspace is open. Open a workspace before running Git sync.",
  "taskRunner.gitSync.notRepository": "Current workspace is not a Git repository.",
  "taskRunner.gitSync.readOnlyDisabledLine1":
    "Read-only Git auto-run is disabled by codexbridge.git.autoRunReadOnly=false.",
  "taskRunner.gitSync.readOnlyDisabledLine2":
    "Enable it to collect status/diff metadata automatically for git_sync planning.",
  "taskRunner.gitSync.readOnlyDisabledSummary": "Git read-only auto-run is disabled.",
  "taskRunner.gitSync.readOnlyDisabledDetails":
    "Enable codexbridge.git.autoRunReadOnly to continue.",
  "taskRunner.gitSync.noteNoLocalChangesForCommit": "No local changes detected for commit.",
  "taskRunner.gitSync.actionTitleApproveAddR1": "Approve Add (R1)",
  "taskRunner.gitSync.actionTitleApproveCommitR1": "Approve Commit (R1)",
  "taskRunner.gitSync.notePushOnlyUncommittedChanges":
    "Local changes are uncommitted; push-only mode cannot sync working tree changes.",
  "taskRunner.gitSync.noteNoLocalCommitsAhead":
    "No local commits ahead of upstream; push is not required.",
  "taskRunner.gitSync.noteNoUpstreamConfigured":
    "No upstream configured; push proposal uses -u to set upstream.",
  "taskRunner.gitSync.actionTitleApprovePushR2": "Approve Push (R2)",
  "taskRunner.gitSync.noActionsRequiredTitle": "No Git sync actions required.",
  "taskRunner.gitSync.noActionsRequiredSummary": "No Git sync actions required.",
  "taskRunner.gitSync.detailBranch": "branch={branch}",
  "taskRunner.gitSync.detailUpstream": "upstream={upstream}",
  "taskRunner.gitSync.detailAheadBehind": "ahead={ahead} behind={behind}",
  "taskRunner.gitSync.detailChangeCounts":
    "staged={staged} unstaged={unstaged} untracked={untracked}",
  "taskRunner.gitSync.detailDiffStat": "diffStat={diffStat}",
  "taskRunner.gitSync.detailMode": "mode={mode}",
  "taskRunner.gitSync.detailNote": "note={note}",
  "taskRunner.gitSync.detailAction": "action={cmd}",
  "taskRunner.gitSync.summaryProposalReady": "Git sync proposal ready: {count} action(s).",

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
  "chat.state.verifyingChanges": "\u6b63\u5728\u6267\u884c\u9a8c\u8bc1\uff1a{command}",
  "chat.state.verificationSkippedRunDisabled":
    "\u9a8c\u8bc1\u5df2\u8df3\u8fc7\uff08allowRunTerminal \u5df2\u7981\u7528\uff09\uff1a{command}",
  "chat.state.verificationSkippedCommandNotAllowed":
    "\u9a8c\u8bc1\u5df2\u8df3\u8fc7\uff08\u547d\u4ee4\u4e0d\u5728\u5141\u8bb8\u5217\u8868\uff09\uff1a{command}",
  "chat.state.verificationPassed": "\u9a8c\u8bc1\u901a\u8fc7\uff1a{command}",
  "chat.state.verificationFailed": "\u9a8c\u8bc1\u5931\u8d25\uff08exit={code}\uff09\uff1a{command}",
  "chat.state.verificationTimedOut": "\u9a8c\u8bc1\u8d85\u65f6\uff1a{command}",
  "chat.state.verificationCancelled": "\u9a8c\u8bc1\u5df2\u53d6\u6d88\uff1a{command}",
  "chat.info.cancelRequestedTask": "\u5df2\u53d1\u9001\u53d6\u6d88\u8bf7\u6c42\uff0c\u4efb\u52a1 {taskId}",
  "chat.info.cancelRequestedToast": "\u5df2\u8bf7\u6c42\u53d6\u6d88\uff1a{taskIdShort}",
  "chat.gitSync.collectingStatusAndDiffMetadata": "\u6b63\u5728\u6536\u96c6 git status \u4e0e diff \u5143\u6570\u636e...",
  "chat.gitSync.summarizingChanges": "\u6b63\u5728\u6c47\u603b\u53d8\u66f4...",
  "chat.gitSync.preparingProposal": "\u6b63\u5728\u51c6\u5907 Git \u540c\u6b65\u65b9\u6848...",
  "chat.gitSync.taskNotFound": "\u672a\u627e\u5230 Git \u540c\u6b65\u4efb\u52a1\uff1a{taskId}",
  "chat.gitSync.taskAlreadyExecuting": "Git \u540c\u6b65\u4efb\u52a1\u6b63\u5728\u6267\u884c\u4e2d\u3002",
  "chat.gitSync.noPendingActions": "\u6ca1\u6709\u5f85\u6267\u884c\u7684 Git \u540c\u6b65\u64cd\u4f5c\u3002",
  "chat.gitSync.runAllApprovalRejectedState": "Git \u540c\u6b65\u6574\u4f53\u6267\u884c\u5ba1\u6279\u88ab\u62d2\u7edd\u3002",
  "chat.gitSync.runAllApprovalRejectedMilestone": "\u672c\u5730\u62d2\u7edd\u4e86 Git \u540c\u6b65\u5ba1\u6279\u3002",
  "chat.gitSync.executionRejectedLocally": "Git \u540c\u6b65\u6267\u884c\u5df2\u5728\u672c\u5730\u88ab\u62d2\u7edd\u3002",
  "chat.gitSync.executingApprovedActions": "\u6b63\u5728\u6267\u884c\u5df2\u6279\u51c6\u7684 Git \u540c\u6b65\u64cd\u4f5c...",
  "chat.gitSync.stepNotAvailableInPlan": "\u5f53\u524d\u65b9\u6848\u4e2d\u4e0d\u53ef\u7528\u7684\u6b65\u9aa4\uff1a{stepId}",
  "chat.gitSync.stepAlreadyCompleted": "\u6b65\u9aa4\u5df2\u5b8c\u6210\uff1a{stepId}",
  "chat.gitSync.stepApprovalRejectedState": "\u6b65\u9aa4\u5ba1\u6279\u88ab\u62d2\u7edd\uff1a{stepId}",
  "chat.gitSync.stepApprovalRejectedMilestone": "Git \u540c\u6b65\u6b65\u9aa4\u5ba1\u6279\u88ab\u62d2\u7edd\uff1a{stepId}",
  "chat.gitSync.stepRejectedLocally": "Git \u540c\u6b65\u6b65\u9aa4\u5df2\u5728\u672c\u5730\u88ab\u62d2\u7edd\uff1a{stepId}",
  "chat.gitSync.executingStep": "\u6b63\u5728\u6267\u884c\uff1a{stepId}",
  "chat.gitSync.stepCompletedWaitingApproval":
    "\u6b65\u9aa4\u5df2\u5b8c\u6210\uff1a{stepId}\u3002\u6b63\u5728\u7b49\u5f85\u5269\u4f59\u64cd\u4f5c\u7684\u5ba1\u6279\u3002",
  "chat.gitSync.stepCompleted": "\u6b65\u9aa4\u5df2\u5b8c\u6210\uff1a{stepId}",
  "chat.gitSync.unknownStepAction": "\u672a\u77e5\u7684\u6b65\u9aa4\u64cd\u4f5c\uff1a{stepId}",
  "chat.gitSync.stepExecutingMilestone": "\u6b63\u5728\u6267\u884c\uff1a{stepId}",
  "chat.gitSync.addCompleted": "git add -A \u5df2\u5b8c\u6210\u3002",
  "chat.gitSync.addFailed": "git add -A \u6267\u884c\u5931\u8d25\u3002",
  "chat.gitSync.missingCommitMessage": "git commit \u7f3a\u5c11\u63d0\u4ea4\u4fe1\u606f\u3002",
  "chat.gitSync.commitCompleted": "git commit \u5df2\u5b8c\u6210\u3002",
  "chat.gitSync.commitFailed": "git commit \u6267\u884c\u5931\u8d25\u3002",
  "chat.gitSync.pushCompleted": "git push \u5df2\u5b8c\u6210\u3002",
  "chat.gitSync.pushFailed": "git push \u6267\u884c\u5931\u8d25\u3002",
  "chat.gitSync.stepFailedSummary": "{stepId} \u6267\u884c\u5931\u8d25\uff1a{message}",
  "chat.gitSync.completedPrefix": "Git \u540c\u6b65\u5df2\u5b8c\u6210\u3002",
  "chat.gitSync.prereqApproveAddBeforeCommit": "\u8bf7\u5148\u6279\u51c6 Add\uff0c\u518d\u6267\u884c Commit\u3002",
  "chat.gitSync.prereqApproveCommitBeforePush": "\u8bf7\u5148\u6279\u51c6 Commit\uff0c\u518d\u6267\u884c Push\u3002",
  "chat.gitSync.detailRepo": "\u4ed3\u5e93\uff1a{repo}",
  "chat.gitSync.detailBranch": "\u5206\u652f\uff1a{branch}",
  "chat.gitSync.detailUpstream": "\u4e0a\u6e38\uff1a{upstream}",
  "chat.gitSync.detailStepsHeader": "\u6b65\u9aa4\uff1a",
  "chat.gitSync.detailCommitMessage": "\u63d0\u4ea4\u4fe1\u606f\uff1a{message}",
  "chat.gitSync.detailPushWarning": "\u8b66\u544a\uff1agit push \u4f1a\u4fee\u6539\u8fdc\u7a0b\u4ed3\u5e93\u72b6\u6001\u3002",
  "chat.gitSync.runAllApprovalQuestion": "\u786e\u8ba4\u6267\u884c Git \u540c\u6b65\u64cd\u4f5c\u8ba1\u5212\uff1f",
  "chat.gitSync.approvePushLabel": "\u6279\u51c6\u5e76 Push",
  "chat.gitSync.approveRunAllLabel": "\u6279\u51c6\u5e76\u5168\u90e8\u6267\u884c",
  "chat.gitSync.rejectLabel": "\u62d2\u7edd",
  "chat.gitSync.detailCommand": "\u547d\u4ee4\uff1a{command}",
  "chat.gitSync.stepApprovalQuestion": "\u786e\u8ba4\u6267\u884c Git \u540c\u6b65\u6b65\u9aa4\uff1a{stepId}\uff1f",
  "chat.gitSync.approveStepLabel": "\u6279\u51c6 {stepId}",
  "chat.gitSync.cardTitle": "Git \u540c\u6b65",
  "chat.gitSync.cancelRequestedMilestone": "\u5df2\u8bf7\u6c42\u53d6\u6d88 Git \u540c\u6b65\u4efb\u52a1\u3002",
  "chat.gitSync.cancelledWhileWaitingApprovalMilestone":
    "Git \u540c\u6b65\u4efb\u52a1\u5728\u7b49\u5f85\u5ba1\u6279\u65f6\u5df2\u53d6\u6d88\u3002",
  "chat.gitSync.proposalReadyTitle": "Git \u540c\u6b65\u65b9\u6848\u5df2\u5c31\u7eea\u3002",
  "chat.gitSync.summaryBranchUpstream": "\u5206\u652f\uff1a{branch}  \u4e0a\u6e38\uff1a{upstream}",
  "chat.gitSync.summaryAheadBehind": "\u9886\u5148/\u843d\u540e\uff1a{ahead}/{behind}",
  "chat.gitSync.summaryChanges":
    "\u53d8\u66f4\uff1a\u5df2\u6682\u5b58={staged} \u672a\u6682\u5b58={unstaged} \u672a\u8ddf\u8e2a={untracked}",
  "chat.gitSync.summaryDiffStat": "diffStat\uff1a{diffStat}",
  "chat.gitSync.summaryCommit": "commit\uff1a{message}",
  "chat.gitSync.summaryPlannedSteps": "\u8ba1\u5212\u6b65\u9aa4\uff1a",
  "chat.gitSync.summaryNote": "\u5907\u6ce8\uff1a{note}",
  "chat.gitSync.placeholderDetached": "(\u5206\u79bb HEAD)",
  "chat.gitSync.placeholderNone": "(\u65e0)",
  "chat.gitSync.placeholderNoDiffStat": "(\u65e0 diff \u7edf\u8ba1)",
  "chat.task.waitingApproval.gitSyncPlanReady":
    "Git \u540c\u6b65\u65b9\u6848\u5df2\u5c31\u7eea\uff0c\u6b63\u5728\u7b49\u5f85\u672c\u5730\u6279\u51c6 add/commit/push \u64cd\u4f5c\u3002",
  "chat.task.waitingApproval.diffProposalReady":
    "Diff \u65b9\u6848\u5df2\u5c31\u7eea\uff0c\u6b63\u5728\u7b49\u5f85\u672c\u5730\u6279\u51c6\u5e94\u7528\u3002",
  "chat.task.waitingApproval.commandProposalReady":
    "\u547d\u4ee4\u65b9\u6848\u5df2\u5c31\u7eea\uff0c\u6b63\u5728\u7b49\u5f85\u672c\u5730\u6279\u51c6\u6267\u884c\u3002",
  "chat.task.attachment.commandProposalTitle": "\u547d\u4ee4\u65b9\u6848",
  "chat.task.attachment.validationLogsTitle": "\u9a8c\u8bc1\u65e5\u5fd7",
  "chat.task.attachment.searchResultsTitle": "\u641c\u7d22\u7ed3\u679c",
  "chat.task.render.commandLine": "\u547d\u4ee4\uff1a{command}",
  "chat.task.render.cwdLine": "\u5de5\u4f5c\u76ee\u5f55\uff1a{cwd}",
  "chat.remote.processing": "\u6b63\u5728\u5904\u7406\u4f01\u4e1a\u5fae\u4fe1\u547d\u4ee4...",
  "chat.remote.unknownCommand": "\u672a\u77e5\u547d\u4ee4",
  "chat.remoteResult.taskIdLine": "\u4efb\u52a1ID={taskId}",
  "chat.remoteResult.intentLine": "\u610f\u56fe={intent}",
  "chat.remoteResult.summaryLine": "\u6458\u8981={summary}",
  "chat.remoteResult.diffLine":
    "Diff={count} \u4e2a\u6587\u4ef6 (+{additions} -{deletions})",
  "chat.remoteResult.commandLine": "\u547d\u4ee4={command}",
  "chat.remoteResult.statusProposalReadyLine": "\u72b6\u6001=\u65b9\u6848\u5df2\u5c31\u7eea",
  "chat.remoteResult.branchLine": "\u5206\u652f={branch}",
  "chat.remoteResult.upstreamLine": "\u4e0a\u6e38={upstream}",
  "chat.remoteResult.changesLine": "\u53d8\u66f4={changes}",
  "chat.remoteResult.stepsLine": "\u6b65\u9aa4={steps}",
  "chat.remoteResult.finalSummaryLine": "\u603b\u7ed3={summary}",
  "chat.remoteResult.nextWaitingApprovalLine":
    "\u4e0b\u4e00\u6b65=\u8bf7\u5728 {machineId} \u4e0a\u6253\u5f00 VS Code \u5e76\u5b8c\u6210\u672c\u5730\u5ba1\u6279",
  "chat.remoteResult.none": "\u65e0",
  "chat.remoteResult.intentKind.help": "\u5e2e\u52a9",
  "chat.remoteResult.intentKind.status": "\u72b6\u6001",
  "chat.remoteResult.intentKind.explain": "\u89e3\u91ca",
  "chat.remoteResult.intentKind.change": "\u4fee\u6539",
  "chat.remoteResult.intentKind.run": "\u6267\u884c",
  "chat.remoteResult.intentKind.gitSync": "Git \u540c\u6b65",
  "chat.remoteResult.intentKind.diagnose": "\u8bca\u65ad",
  "chat.remoteResult.intentKind.search": "\u641c\u7d22",
  "chat.remoteResult.intentKind.review": "\u5ba1\u67e5",

  "taskRunner.help.lineIntro": "\u81ea\u7136\u8bed\u8a00\u4efb\u52a1\u7c7b\u578b\uff1a",
  "taskRunner.help.lineExplain": "- explain\uff08\u89e3\u91ca\uff09",
  "taskRunner.help.lineChange": "- change\uff08\u4fee\u6539\uff09",
  "taskRunner.help.lineDiagnose": "- diagnose\uff08\u8bca\u65ad\uff09",
  "taskRunner.help.lineRun": "- run\uff08\u4ec5\u751f\u6210\u65b9\u6848\uff0c\u9700\u672c\u5730\u6279\u51c6\uff09",
  "taskRunner.help.lineGitSync":
    "- git_sync\uff08status + add/commit/push \u65b9\u6848\uff0c\u9700\u672c\u5730\u6279\u51c6\uff09",
  "taskRunner.help.lineSearch": "- search\uff08\u641c\u7d22\uff09",
  "taskRunner.help.lineReview": "- review\uff08\u5ba1\u67e5\uff09",
  "taskRunner.help.summary": "\u5e2e\u52a9\u4fe1\u606f\u5df2\u51c6\u5907\u5b8c\u6210\u3002",
  "taskRunner.help.details": "\u53ef\u4f7f\u7528 @dev <\u81ea\u7136\u8bed\u8a00> \u6216\u76f4\u63a5\u5728 chat \u8f93\u5165\u3002",
  "taskRunner.status.summary": "\u5de5\u4f5c\u533a\u72b6\u6001\u5df2\u6536\u96c6\u3002",
  "taskRunner.status.fieldWorkspace": "\u5de5\u4f5c\u533a",
  "taskRunner.status.fieldPlatform": "\u5e73\u53f0",
  "taskRunner.status.fieldNode": "Node",
  "taskRunner.status.fieldGitBranch": "Git \u5206\u652f",
  "taskRunner.status.fieldGitChanged": "Git \u53d8\u66f4\u6570",
  "taskRunner.status.valueNotOpen": "\u672a\u6253\u5f00",
  "taskRunner.search.noMatches": "\u672a\u627e\u5230\u5339\u914d\u9879\u3002",
  "taskRunner.search.summary": "\u641c\u7d22\u5b8c\u6210\uff1a{count} \u6761\u7ed3\u679c\u3002",
  "taskRunner.review.summaryReady": "\u5ba1\u67e5\u6458\u8981\u5df2\u51c6\u5907\u5b8c\u6210\u3002",
  "taskRunner.run.summaryReady": "\u547d\u4ee4\u65b9\u6848\u5df2\u5c31\u7eea\uff1a{command}",
  "taskRunner.run.waitingApproval": "\u6b63\u5728\u7b49\u5f85\u672c\u5730\u6279\u51c6\u6267\u884c\u8be5\u547d\u4ee4\u3002",
  "taskRunner.change.workspaceRequired":
    "\u5f53\u524d\u672a\u6253\u5f00\u5de5\u4f5c\u533a\u3002\u8bf7\u5148\u6253\u5f00\u5de5\u4f5c\u533a\u518d\u751f\u6210 diff \u65b9\u6848\u3002",
  "taskRunner.change.strictRetryFailed": "\u4e25\u683c\u91cd\u8bd5\u5931\u8d25\uff1a{reason}",
  "taskRunner.change.completionFallbackFailed": "completion \u56de\u9000\u5931\u8d25\uff1a{reason}",
  "taskRunner.change.diffGenerationFailed": "Diff \u751f\u6210\u5931\u8d25\uff1a{reasons}",
  "taskRunner.fallback.planTitle": "\u65e0\u6cd5\u751f\u6210\u5b89\u5168\u53ef\u6267\u884c\u7684\u65b9\u6848\u3002",
  "taskRunner.fallback.reason": "\u539f\u56e0\uff1a{reason}",
  "taskRunner.fallback.suggest":
    "\u5efa\u8bae\u4e0b\u4e00\u6b65\uff1a\u660e\u786e\u6307\u5b9a\u6587\u4ef6\u548c\u671f\u671b\u8f93\u51fa\uff0c\u518d\u91cd\u8bd5\u3002",
  "taskRunner.explain.timeoutReturnedReview":
    "Codex \u8d85\u65f6\uff0c\u5df2\u6539\u4e3a\u8fd4\u56de\u672c\u5730\u5ba1\u67e5\u6458\u8981\u3002",
  "taskRunner.explain.timeoutReviewSummary":
    "Codex \u8d85\u65f6\uff1b\u5df2\u8fd4\u56de\u672c\u5730\u5ba1\u67e5\u6458\u8981\u3002",
  "taskRunner.explain.timeout": "Codex \u8bf7\u6c42\u8d85\u65f6\u3002",
  "taskRunner.explain.reason": "\u539f\u56e0\uff1a{reason}",
  "taskRunner.explain.suggest":
    "\u5efa\u8bae\u7f29\u5c0f\u8bf7\u6c42\u8303\u56f4\uff0c\u6216\u6307\u5b9a\u66f4\u5177\u4f53\u7684\u6587\u4ef6\u3002",
  "taskRunner.explain.timeoutSummary": "Codex \u8d85\u65f6\u3002",
  "taskRunner.review.workspaceRequired":
    "\u5f53\u524d\u672a\u6253\u5f00\u5de5\u4f5c\u533a\u3002\u8bf7\u5148\u6253\u5f00\u5de5\u4f5c\u533a\u518d\u5ba1\u67e5\u672c\u5730 diff\u3002",
  "taskRunner.review.unableReadDiffStat": "\u65e0\u6cd5\u8bfb\u53d6 git diff --stat \u8f93\u51fa\u3002",
  "taskRunner.review.noLocalDiff": "\u672a\u53d1\u73b0\u672c\u5730 diff\u3002",
  "taskRunner.search.pathMatchPreview": "\u8def\u5f84\u5339\u914d",
  "taskRunner.diff.error.noValidDiffInCompletion":
    "model completion \u672a\u8fd4\u56de\u6709\u6548\u7684 unified diff",
  "taskRunner.diff.generatedByCompletionFallback":
    "\u7531 completion \u56de\u9000\u65b9\u6848\u751f\u6210\u7684 patch",
  "taskRunner.diff.error.invalidUnifiedDiff":
    "Diff \u65b9\u6848\u4e0d\u662f\u6709\u6548\u7684 unified diff \u683c\u5f0f\u3002",
  "taskRunner.diff.filesSummary":
    "\u6587\u4ef6\uff1a{count}\uff0c+{additions}\uff0c-{deletions}",
  "taskRunner.diff.summaryReady":
    "Diff \u65b9\u6848\u5df2\u5c31\u7eea\uff1a{count} \u4e2a\u6587\u4ef6\uff0c+{additions}\uff0c-{deletions}\u3002",

  "taskRunner.gitSync.disabledText": "codexbridge.git.enable \u5df2\u7981\u7528 Git \u540c\u6b65\u529f\u80fd\u3002",
  "taskRunner.gitSync.disabledSummary": "Git \u540c\u6b65\u5df2\u88ab\u914d\u7f6e\u7981\u7528\u3002",
  "taskRunner.gitSync.disabledDetails":
    "\u5c06 codexbridge.git.enable \u8bbe\u4e3a true \u540e\u53ef\u542f\u7528 Git \u540c\u6b65\u89c4\u5212\u3002",
  "taskRunner.gitSync.workspaceRequired":
    "\u5f53\u524d\u672a\u6253\u5f00\u5de5\u4f5c\u533a\u3002\u8bf7\u5148\u6253\u5f00\u5de5\u4f5c\u533a\u518d\u6267\u884c Git \u540c\u6b65\u3002",
  "taskRunner.gitSync.notRepository": "\u5f53\u524d\u5de5\u4f5c\u533a\u4e0d\u662f Git \u4ed3\u5e93\u3002",
  "taskRunner.gitSync.readOnlyDisabledLine1":
    "codexbridge.git.autoRunReadOnly=false\uff0c\u53ef\u8bfb Git \u81ea\u52a8\u6267\u884c\u5df2\u5173\u95ed\u3002",
  "taskRunner.gitSync.readOnlyDisabledLine2":
    "\u542f\u7528\u540e\u624d\u80fd\u5728 git_sync \u89c4\u5212\u65f6\u81ea\u52a8\u6536\u96c6 status/diff \u5143\u6570\u636e\u3002",
  "taskRunner.gitSync.readOnlyDisabledSummary": "Git \u53ef\u8bfb\u81ea\u52a8\u6267\u884c\u5df2\u7981\u7528\u3002",
  "taskRunner.gitSync.readOnlyDisabledDetails":
    "\u8bf7\u542f\u7528 codexbridge.git.autoRunReadOnly \u540e\u518d\u8bd5\u3002",
  "taskRunner.gitSync.noteNoLocalChangesForCommit": "\u672a\u68c0\u6d4b\u5230\u53ef\u7528\u4e8e commit \u7684\u672c\u5730\u53d8\u66f4\u3002",
  "taskRunner.gitSync.actionTitleApproveAddR1": "\u6279\u51c6 Add\uff08R1\uff09",
  "taskRunner.gitSync.actionTitleApproveCommitR1": "\u6279\u51c6 Commit\uff08R1\uff09",
  "taskRunner.gitSync.notePushOnlyUncommittedChanges":
    "\u672c\u5730\u53d8\u66f4\u5c1a\u672a\u63d0\u4ea4\uff0cpush-only \u6a21\u5f0f\u65e0\u6cd5\u540c\u6b65\u5de5\u4f5c\u533a\u53d8\u66f4\u3002",
  "taskRunner.gitSync.noteNoLocalCommitsAhead":
    "\u672c\u5730\u6ca1\u6709\u8d85\u524d\u4e0a\u6e38\u7684 commit\uff0c\u65e0\u9700 push\u3002",
  "taskRunner.gitSync.noteNoUpstreamConfigured":
    "\u672a\u914d\u7f6e upstream\uff0cpush \u65b9\u6848\u4f1a\u4f7f\u7528 -u \u8bbe\u7f6e upstream\u3002",
  "taskRunner.gitSync.actionTitleApprovePushR2": "\u6279\u51c6 Push\uff08R2\uff09",
  "taskRunner.gitSync.noActionsRequiredTitle": "\u65e0\u9700\u6267\u884c Git \u540c\u6b65\u64cd\u4f5c\u3002",
  "taskRunner.gitSync.noActionsRequiredSummary": "\u65e0\u9700\u6267\u884c Git \u540c\u6b65\u64cd\u4f5c\u3002",
  "taskRunner.gitSync.detailBranch": "\u5206\u652f={branch}",
  "taskRunner.gitSync.detailUpstream": "\u4e0a\u6e38={upstream}",
  "taskRunner.gitSync.detailAheadBehind": "\u9886\u5148={ahead} \u843d\u540e={behind}",
  "taskRunner.gitSync.detailChangeCounts":
    "\u5df2\u6682\u5b58={staged} \u672a\u6682\u5b58={unstaged} \u672a\u8ddf\u8e2a={untracked}",
  "taskRunner.gitSync.detailDiffStat": "diffStat={diffStat}",
  "taskRunner.gitSync.detailMode": "\u6a21\u5f0f={mode}",
  "taskRunner.gitSync.detailNote": "\u5907\u6ce8={note}",
  "taskRunner.gitSync.detailAction": "\u64cd\u4f5c={cmd}",
  "taskRunner.gitSync.summaryProposalReady": "Git \u540c\u6b65\u65b9\u6848\u5df2\u5c31\u7eea\uff1a{count} \u4e2a\u64cd\u4f5c\u3002",

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
