document.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Enter' || event.isComposing) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) {
      return;
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      event.stopImmediatePropagation();

      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      target.value = `${target.value.slice(0, start)}\n${target.value.slice(end)}`;
      target.selectionStart = start + 1;
      target.selectionEnd = start + 1;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    }
  },
  true,
);
const vscode = acquireVsCodeApi();

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Enter" || !event.altKey || event.isComposing) {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) {
      return;
    }
    // Let Alt+Enter insert a newline and bypass Enter-to-send handlers.
    event.stopImmediatePropagation();
  },
  true
);

const INPUT_MAX_HEIGHT = 240;
const WAIT_NOTICE_DELAY_MS = 350;
const VIRTUAL_OVERSCAN_PX = 540;
const VIRTUAL_MIN_MESSAGE_HEIGHT = 84;
const VIRTUAL_MIN_TASK_HEIGHT = 140;
const QUEUE_PREVIEW_MAX_CHARS = 140;
const LOCAL_TASK_REPLAY_STEP_MS = 320;

const UI_STRINGS = {
  "zh-CN": {
    appTitle: "CodexBridge",
    titleSubtitle: "\u5de5\u4f5c\u533a\u7f16\u7801\u52a9\u624b",
    clear: "\u6e05\u7a7a",
    toggleContextShow: "\u663e\u793a\u4e0a\u4e0b\u6587",
    toggleContextHide: "\u9690\u85cf\u4e0a\u4e0b\u6587",
    send: "\u53d1\u9001",
    inputPlaceholder: "\u8bf7\u5411 CodexBridge \u63d0\u95ee\uff0c\u652f\u6301 /plan /patch /test",
    inputHint: "Enter \u53d1\u9001\uff0cAlt+Enter \u6362\u884c\uff0c\u53ef\u7528\u5feb\u6377\u6307\u4ee4",
    waitNotice: "\u6d88\u606f\u5df2\u53d1\u9001\uff0c\u6b63\u5728\u5904\u7406\uff0c\u8bf7\u7a0d\u5019...",
    contextActiveFile: "\u5f53\u524d\u6587\u4ef6",
    contextSelection: "\u9009\u4e2d\u5185\u5bb9",
    contextWorkspaceSummary: "\u5de5\u4f5c\u533a\u6458\u8981",
    contextFilesPlaceholder: "\u989d\u5916\u6587\u4ef6\uff08\u9017\u53f7\u5206\u9694\uff09",
    conversationStatusTitle: "\u5bf9\u8bdd\u72b6\u6001",
    conversationStatusCurrent: (label) => `\u5f53\u524d\u72b6\u6001\uff1a${label}`,
    stageLabels: {
      planning: "\u89c4\u5212\u4e2d",
      proposalReady: "\u65b9\u6848\u5df2\u751f\u6210",
      waitingApproval: "\u7b49\u5f85\u786e\u8ba4",
      executing: "\u6267\u884c\u4e2d",
      verifying: "\u9a8c\u8bc1\u4e2d",
      completed: "\u5df2\u5b8c\u6210",
      failed: "\u5931\u8d25"
    },
    commandSectionTask: "\u4efb\u52a1",
    commandSectionAssistant: "\u52a9\u624b",
    commandSectionSummary: "\u603b\u7ed3",
    commandSummaryTaskLabel: "\u4efb\u52a1",
    commandSummaryStatusLabel: "\u72b6\u6001",
    commandSummaryTextLabel: "\u7ed3\u679c",
    commandSummaryEmpty: "\u6682\u65e0\u603b\u7ed3\u3002",
    diffTitle: (count) => `Diff\uff08${count} \u4e2a\u6587\u4ef6\uff09`,
    viewDiff: "\u67e5\u770b Diff",
    applyDiff: "\u5e94\u7528 Diff",
    logs: "\u65e5\u5fd7",
    commandProposal: "\u547d\u4ee4\u65b9\u6848",
    runCommand: "\u8fd0\u884c\u547d\u4ee4",
    status: "\u72b6\u6001",
    gitSyncTitle: "Git \u540c\u6b65",
    gitSyncBranchLabel: "\u5206\u652f",
    gitSyncUpstreamLabel: "\u4e0a\u6e38",
    gitSyncAheadBehindLabel: "\u9886\u5148/\u843d\u540e",
    gitSyncChangesLabel: "\u53d8\u66f4",
    gitSyncStagedLabel: "\u5df2\u6682\u5b58",
    gitSyncUnstagedLabel: "\u672a\u6682\u5b58",
    gitSyncUntrackedLabel: "\u672a\u8ddf\u8e2a",
    gitSyncDetached: "(\u5206\u79bb HEAD)",
    gitSyncNone: "(\u65e0)",
    gitSyncNoDiffStat: "(\u65e0 diff \u7edf\u8ba1)",
    gitSyncChanges: "\u53d8\u66f4",
    gitSyncCommitLabel: "\u63d0\u4ea4",
    gitSyncCommitMessage: "\u5efa\u8bae\u63d0\u4ea4\u4fe1\u606f",
    gitSyncSteps: "\u8ba1\u5212\u6b65\u9aa4",
    gitSyncStatusLabels: {
      planning: "\ud83d\udfe1 \u89c4\u5212\u4e2d",
      proposalReady: "\ud83d\udfe0 \u65b9\u6848\u5df2\u5c31\u7eea",
      waitingApproval: "\ud83d\udd12 \u7b49\u5f85\u5ba1\u6279",
      executing: "\u2699\ufe0f \u6267\u884c\u4e2d",
      completed: "\u2705 \u5df2\u5b8c\u6210",
      failed: "\u274c \u5931\u8d25"
    },
    approveRunAll: "\u6279\u51c6\u5e76\u5168\u90e8\u6267\u884c",
    approvePushPrimary: "\u6279\u51c6\u5e76 Push",
    approveAdd: "\u6279\u51c6 Add",
    approveCommit: "\u6279\u51c6 Commit",
    approvePush: "\u6279\u51c6 Push",
    copySummary: "\u590d\u5236\u6458\u8981",
    showFullLogs: "\u663e\u793a\u5b8c\u6574\u65e5\u5fd7",
    copyCode: "\u590d\u5236\u4ee3\u7801",
    copyMessage: "\u590d\u5236\u6d88\u606f",
    copyTaskCard: "\u590d\u5236\u4efb\u52a1\u5361",
    genericCopy: "\u590d\u5236",
    collapseCode: "\u6298\u53e0",
    expandCode: "\u5c55\u5f00",
    queueNotice: (count) => `\u961f\u5217\u4e2d\u5f85\u53d1\u9001\uff1a${count}`,
    queuedToast: (count) => `\u6d88\u606f\u5df2\u5165\u961f\uff0c\u524d\u65b9\u8fd8\u6709 ${count} \u6761`,
    queueTitle: (count) => `\u5f85\u53d1\u9001\u961f\u5217\uff08${count}\uff09`,
    queueClear: "\u6e05\u7a7a\u961f\u5217",
    queueItemIndex: (index) => `#${index}`,
    queueCancel: "\u53d6\u6d88",
    queueClearedToast: (count) => `\u5df2\u6e05\u7a7a ${count} \u6761\u5f85\u53d1\u9001\u6d88\u606f`,
    queueItemCanceledToast: (index) => `\u5df2\u53d6\u6d88\u7b2c ${index} \u6761\u5f85\u53d1\u9001\u6d88\u606f`,
    devReplayShortcut: "/dev \u56de\u653e",
    devReplayToast: "\u5df2\u542f\u52a8 task_* \u4e8b\u4ef6\u672c\u5730\u56de\u653e",
    statusValues: {
      pending: "\u5f85\u6267\u884c",
      completed: "\u5df2\u5b8c\u6210",
      failed: "\u5931\u8d25",
      skipped: "\u5df2\u8df3\u8fc7"
    },
    retryTask: "\u91cd\u8bd5\u4efb\u52a1",
    cancelTask: "\u53d6\u6d88\u4efb\u52a1",
    taskHeader: (shortTaskId, intent) => `\u4efb\u52a1 ${shortTaskId} - ${intent}`,
    taskProposalLine: (type) => `\u65b9\u6848\uff1a${type}`,
    taskEndLine: (status) => `\u7ed3\u675f\uff1a${status}`,
    taskStateLabels: {
      RECEIVED: "\u5df2\u63a5\u6536",
      ROUTED: "\u5df2\u8def\u7531",
      CONTEXT_COLLECTED: "\u4e0a\u4e0b\u6587\u5df2\u6536\u96c6",
      PROPOSING: "\u89c4\u5212\u4e2d",
      PROPOSAL_READY: "\u65b9\u6848\u5df2\u751f\u6210",
      WAITING_APPROVAL: "\u7b49\u5f85\u786e\u8ba4",
      EXECUTING: "\u6267\u884c\u4e2d",
      VERIFYING: "\u9a8c\u8bc1\u4e2d",
      COMPLETED: "\u5df2\u5b8c\u6210",
      FAILED: "\u5931\u8d25",
      REJECTED: "\u5df2\u62d2\u7edd"
    },
    proposalTypeLabels: {
      plan: "\u8ba1\u5212",
      diff: "\u5dee\u5f02",
      command: "\u547d\u4ee4",
      git_sync_plan: "Git \u540c\u6b65",
      answer: "\u56de\u7b54",
      search_results: "\u641c\u7d22\u7ed3\u679c"
    },
    taskProposalTitle: "\u65b9\u6848",
    taskProposalFiles: (count) => `\u53d8\u66f4\u6587\u4ef6\uff1a${count}`,
    taskProposalCwd: (cwd) => `\u5de5\u4f5c\u76ee\u5f55\uff1a${cwd}`,
    taskProposalDiffId: (diffId) => `diffId\uff1a${diffId}`,
    taskProposalNotesTitle: "\u5907\u6ce8",
    taskProposalSearchTitle: "\u641c\u7d22\u7ed3\u679c",
    taskProposalGitSyncHint: "\u8be6\u7ec6\u6b65\u9aa4\u8bf7\u5728\u4e0b\u65b9 Git \u540c\u6b65\u5361\u7247\u64cd\u4f5c",
    endStatusLabels: {
      ok: "\u6210\u529f",
      error: "\u5931\u8d25",
      rejected: "\u62d2\u7edd"
    },
    intentLabels: {
      help: "\u5e2e\u52a9",
      status: "\u72b6\u6001",
      explain: "\u89e3\u91ca",
      change: "\u4fee\u6539",
      run: "\u6267\u884c",
      git_sync: "Git \u540c\u6b65",
      diagnose: "\u8bca\u65ad",
      search: "\u641c\u7d22",
      review: "\u5ba1\u67e5",
      task: "\u4efb\u52a1"
    },
    authorYou: "\u4f60",
    authorAssistant: "\u52a9\u624b",
    authorTool: "\u5de5\u5177",
    authorSystem: "\u7cfb\u7edf",
    authorRemote: "\u4f01\u4e1a\u5fae\u4fe1",
    authorRemoteSuffix: "\u4f01\u4e1a\u5fae\u4fe1",
    fallbackRolePrefix: "\u89d2\u8272",
    errorLabel: "\u9519\u8bef",
    unknownLabel: "\u672a\u77e5"
  },
  en: {
    appTitle: "CodexBridge",
    titleSubtitle: "Workspace coding assistant",
    clear: "Clear",
    toggleContextShow: "Show Context",
    toggleContextHide: "Hide Context",
    send: "Send",
    inputPlaceholder: "Ask CodexBridge, or use /plan /patch /test",
    inputHint: "Enter to send, Alt+Enter for newline, use slash shortcuts below",
    waitNotice: "Message sent. Processing, please wait...",
    contextActiveFile: "Active File",
    contextSelection: "Selection",
    contextWorkspaceSummary: "Workspace Summary",
    contextFilesPlaceholder: "extra files (comma separated)",
    conversationStatusTitle: "Conversation Status",
    conversationStatusCurrent: (label) => `Current: ${label}`,
    stageLabels: {
      planning: "Planning",
      proposalReady: "Proposal Ready",
      waitingApproval: "Waiting Approval",
      executing: "Executing",
      verifying: "Verifying",
      completed: "Completed",
      failed: "Failed"
    },
    commandSectionTask: "Task",
    commandSectionAssistant: "Assistant",
    commandSectionSummary: "Summary",
    commandSummaryTaskLabel: "Task",
    commandSummaryStatusLabel: "Status",
    commandSummaryTextLabel: "Result",
    commandSummaryEmpty: "No summary yet.",
    diffTitle: (count) => `Diff (${count} files)`,
    viewDiff: "View Diff",
    applyDiff: "Apply Diff",
    logs: "Logs",
    commandProposal: "Command Proposal",
    runCommand: "Run Command",
    status: "Status",
    gitSyncTitle: "Git Sync",
    gitSyncBranchLabel: "branch",
    gitSyncUpstreamLabel: "upstream",
    gitSyncAheadBehindLabel: "ahead/behind",
    gitSyncChangesLabel: "changes",
    gitSyncStagedLabel: "staged",
    gitSyncUnstagedLabel: "unstaged",
    gitSyncUntrackedLabel: "untracked",
    gitSyncDetached: "(detached)",
    gitSyncNone: "(none)",
    gitSyncNoDiffStat: "(no diff stat)",
    gitSyncChanges: "Changes",
    gitSyncCommitLabel: "commit",
    gitSyncCommitMessage: "Proposed commit message",
    gitSyncSteps: "Planned steps",
    gitSyncStatusLabels: {
      planning: "\ud83d\udfe1 Planning",
      proposalReady: "\ud83d\udfe0 Proposal ready",
      waitingApproval: "\ud83d\udd12 Waiting approval",
      executing: "\u2699\ufe0f Executing",
      completed: "\u2705 Completed",
      failed: "\u274c Failed"
    },
    approveRunAll: "Approve & Run All",
    approvePushPrimary: "Approve & Push",
    approveAdd: "Approve Add",
    approveCommit: "Approve Commit",
    approvePush: "Approve Push",
    copySummary: "Copy summary",
    showFullLogs: "Show full logs",
    copyCode: "Copy code",
    copyMessage: "Copy message",
    copyTaskCard: "Copy task card",
    genericCopy: "Copy",
    collapseCode: "Collapse",
    expandCode: "Expand",
    queueNotice: (count) => `Queued: ${count}`,
    queuedToast: (count) => `Message queued (${count} ahead).`,
    queueTitle: (count) => `Queued Messages (${count})`,
    queueClear: "Clear Queue",
    queueItemIndex: (index) => `#${index}`,
    queueCancel: "Cancel",
    queueClearedToast: (count) => `Cleared ${count} queued message(s).`,
    queueItemCanceledToast: (index) => `Canceled queued message #${index}.`,
    devReplayShortcut: "/dev replay",
    devReplayToast: "Started local task_* replay.",
    statusValues: {
      pending: "pending",
      completed: "completed",
      failed: "failed",
      skipped: "skipped"
    },
    retryTask: "Retry Task",
    cancelTask: "Cancel Task",
    taskHeader: (shortTaskId, intent) => `Task ${shortTaskId} - ${intent}`,
    taskProposalLine: (type) => `proposal: ${type}`,
    taskEndLine: (status) => `end: ${status}`,
    taskStateLabels: {
      RECEIVED: "Received",
      ROUTED: "Routed",
      CONTEXT_COLLECTED: "Context Collected",
      PROPOSING: "Planning",
      PROPOSAL_READY: "Proposal Ready",
      WAITING_APPROVAL: "Waiting Approval",
      EXECUTING: "Executing",
      VERIFYING: "Verifying",
      COMPLETED: "Completed",
      FAILED: "Failed",
      REJECTED: "Rejected"
    },
    proposalTypeLabels: {
      plan: "plan",
      diff: "diff",
      command: "command",
      git_sync_plan: "git sync",
      answer: "answer",
      search_results: "search results"
    },
    taskProposalTitle: "Proposal",
    taskProposalFiles: (count) => `Changed files: ${count}`,
    taskProposalCwd: (cwd) => `cwd: ${cwd}`,
    taskProposalDiffId: (diffId) => `diffId: ${diffId}`,
    taskProposalNotesTitle: "Notes",
    taskProposalSearchTitle: "Search results",
    taskProposalGitSyncHint: "Use the Git Sync card below for approvals and execution.",
    endStatusLabels: {
      ok: "ok",
      error: "error",
      rejected: "rejected"
    },
    intentLabels: {
      help: "help",
      status: "status",
      explain: "explain",
      change: "change",
      run: "run",
      git_sync: "git sync",
      diagnose: "diagnose",
      search: "search",
      review: "review",
      task: "task"
    },
    authorYou: "You",
    authorAssistant: "Assistant",
    authorTool: "Tool",
    authorSystem: "System",
    authorRemote: "WeCom",
    authorRemoteSuffix: "WeCom",
    fallbackRolePrefix: "Role",
    errorLabel: "error",
    unknownLabel: "unknown"
  }
};

const locale = resolveLocale();
const ui = UI_STRINGS[locale] ?? UI_STRINGS.en;

const state = {
  threadId: "default",
  messages: [],
  context: {}
};

const elements = {
  titleText: document.getElementById("title-text"),
  titleSubtitle: document.getElementById("title-subtitle"),
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  devReplayShortcut: document.getElementById("shortcut-dev-replay"),
  composerHint: document.getElementById("composer-hint"),
  waitIndicator: document.getElementById("wait-indicator"),
  queuePanel: document.getElementById("queue-panel"),
  queueTitle: document.getElementById("queue-title"),
  queueList: document.getElementById("queue-list"),
  queueClearBtn: document.getElementById("queue-clear-btn"),
  sendBtn: document.getElementById("send-btn"),
  clearBtn: document.getElementById("clear-btn"),
  toggleContextBtn: document.getElementById("toggle-context-btn"),
  contextPanel: document.getElementById("context-panel"),
  toast: document.getElementById("toast"),
  includeActiveFile: document.getElementById("ctx-active-file"),
  includeSelection: document.getElementById("ctx-selection"),
  includeWorkspaceSummary: document.getElementById("ctx-workspace-summary"),
  activeFileLabel: document.getElementById("ctx-active-file-label"),
  selectionLabel: document.getElementById("ctx-selection-label"),
  workspaceSummaryLabel: document.getElementById("ctx-workspace-summary-label"),
  filesInput: document.getElementById("ctx-files")
};

const shortcutButtons = Array.from(document.querySelectorAll(".shortcut-btn"));
const messageById = new Map();
const messageNodeById = new Map();
const streamingMessageIds = new Set();
const taskModelById = new Map();
const taskNodeById = new Map();
const taskStateById = new Map();
const taskMessageIdByTaskId = new Map();
const messageTaskIdsByMessageId = new Map();
const pendingTaskBindingQueue = [];
const activeTaskIds = new Set();
const outboundMessageQueue = [];
const timelineOrder = [];
const timelineItemByKey = new Map();
const timelineHeightByKey = new Map();
const timelineVisibleKeys = [];

let isInputComposing = false;
let isContextPanelCollapsed = false;
let pendingAssistantPlaceholders = 0;
const waitingAssistantMessageIds = new Set();
let waitNoticeTimerId = 0;
let waitNoticeVisible = false;
let timelineTopSpacer;
let timelineWindow;
let timelineBottomSpacer;
let virtualRenderRaf = 0;
let forceStickToBottom = false;
let timelineDirty = true;
let lastVirtualStart = -1;
let lastVirtualEnd = -1;
let queueItemSeq = 0;
let localDemoSeq = 0;
let taskStartSequence = 0;

applyLocalization();
setContextPanelCollapsed(false);
autoResizeInput();
updateSendButtonState();
initializeVirtualTimeline();

elements.sendBtn.addEventListener("click", () => {
  sendCurrentMessage();
});

elements.toggleContextBtn.addEventListener("click", () => {
  setContextPanelCollapsed(!isContextPanelCollapsed);
});

for (const button of shortcutButtons) {
  button.addEventListener("click", () => {
    insertSlashShortcut(button.dataset.slash || "");
  });
}

elements.input.addEventListener("compositionstart", () => {
  isInputComposing = true;
});

elements.input.addEventListener("compositionend", () => {
  isInputComposing = false;
});

elements.input.addEventListener("input", () => {
  autoResizeInput();
  updateSendButtonState();
});

elements.input.addEventListener("keydown", (event) => {
  if (!shouldSendOnEnter(event)) {
    return;
  }
  event.preventDefault();
  sendCurrentMessage();
});

elements.clearBtn.addEventListener("click", () => {
  clearQueuedMessages(false);
  post({
    type: "clear_thread",
    threadId: state.threadId
  });
});

elements.queueClearBtn?.addEventListener("click", () => {
  clearQueuedMessages(true);
});

for (const node of [
  elements.includeActiveFile,
  elements.includeSelection,
  elements.includeWorkspaceSummary
]) {
  node.addEventListener("change", syncContextToExtension);
}

elements.filesInput.addEventListener("change", syncContextToExtension);
elements.filesInput.addEventListener("blur", syncContextToExtension);
elements.messages.addEventListener("scroll", () => {
  scheduleVirtualRender();
});
window.addEventListener("resize", () => {
  scheduleVirtualRender();
});

window.addEventListener("message", (event) => {
  handleExtMessage(event.data);
});

post({ type: "ui_ready", version: 1 });
post({ type: "request_state", threadId: state.threadId });

function applyLocalization() {
  document.documentElement.lang = locale;
  document.title = ui.appTitle;
  elements.titleText.textContent = ui.appTitle;
  elements.titleSubtitle.textContent = ui.titleSubtitle || "";
  elements.clearBtn.textContent = ui.clear;
  elements.sendBtn.textContent = ui.send;
  elements.input.placeholder = ui.inputPlaceholder;
  elements.composerHint.textContent = ui.inputHint;
  elements.activeFileLabel.textContent = ui.contextActiveFile;
  elements.selectionLabel.textContent = ui.contextSelection;
  elements.workspaceSummaryLabel.textContent = ui.contextWorkspaceSummary;
  elements.filesInput.placeholder = ui.contextFilesPlaceholder;
  elements.toggleContextBtn.textContent = isContextPanelCollapsed
    ? ui.toggleContextShow
    : ui.toggleContextHide;
  if (elements.devReplayShortcut) {
    elements.devReplayShortcut.textContent = ui.devReplayShortcut;
  }
  if (elements.queueClearBtn) {
    elements.queueClearBtn.textContent = ui.queueClear;
  }
  renderQueuePanel();
  renderWaitIndicator();
}

function setContextPanelCollapsed(collapsed) {
  isContextPanelCollapsed = Boolean(collapsed);
  elements.contextPanel.classList.toggle("is-collapsed", isContextPanelCollapsed);
  elements.toggleContextBtn.setAttribute("aria-expanded", String(!isContextPanelCollapsed));
  elements.toggleContextBtn.textContent = isContextPanelCollapsed
    ? ui.toggleContextShow
    : ui.toggleContextHide;
}

function initializeVirtualTimeline() {
  elements.messages.innerHTML = "";

  timelineTopSpacer = document.createElement("div");
  timelineTopSpacer.className = "timeline-spacer timeline-spacer-top";

  timelineWindow = document.createElement("div");
  timelineWindow.className = "timeline-window";

  timelineBottomSpacer = document.createElement("div");
  timelineBottomSpacer.className = "timeline-spacer timeline-spacer-bottom";

  elements.messages.appendChild(timelineTopSpacer);
  elements.messages.appendChild(timelineWindow);
  elements.messages.appendChild(timelineBottomSpacer);
}

function getMessageKey(messageId) {
  return `m:${messageId}`;
}

function getTaskKey(taskId) {
  return `t:${taskId}`;
}

function removeFromArray(array, value) {
  const index = array.indexOf(value);
  if (index >= 0) {
    array.splice(index, 1);
    return true;
  }
  return false;
}

function removeTimelineItem(key) {
  removeFromArray(timelineOrder, key);
  removeFromArray(timelineVisibleKeys, key);
  timelineItemByKey.delete(key);
  timelineHeightByKey.delete(key);
  timelineDirty = true;
}

function clearTaskMessageBindings() {
  taskMessageIdByTaskId.clear();
  messageTaskIdsByMessageId.clear();
  pendingTaskBindingQueue.length = 0;
}

function getBoundTaskIdsForMessage(messageId) {
  const id = String(messageId || "");
  if (!id) {
    return [];
  }
  const taskIds = messageTaskIdsByMessageId.get(id);
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return [];
  }
  return taskIds
    .filter((taskId) => taskModelById.has(taskId))
    .sort((left, right) => {
      const leftOrder = taskModelById.get(left)?.startOrder || 0;
      const rightOrder = taskModelById.get(right)?.startOrder || 0;
      return leftOrder - rightOrder;
    });
}

function queuePendingTaskBinding(taskId) {
  const id = String(taskId || "");
  if (!id || pendingTaskBindingQueue.includes(id)) {
    return;
  }
  pendingTaskBindingQueue.push(id);
}

function dequeuePendingTaskBinding(taskId) {
  const id = String(taskId || "");
  if (!id) {
    return;
  }
  removeFromArray(pendingTaskBindingQueue, id);
}

function bindTaskToMessage(taskId, messageId) {
  const id = String(taskId || "");
  const msgId = String(messageId || "");
  if (!id || !msgId) {
    return false;
  }

  const message = messageById.get(msgId);
  if (!message || message.role !== "assistant") {
    return false;
  }

  const previousMessageId = taskMessageIdByTaskId.get(id);
  if (previousMessageId && previousMessageId !== msgId) {
    const previousTaskIds = messageTaskIdsByMessageId.get(previousMessageId);
    if (Array.isArray(previousTaskIds)) {
      removeFromArray(previousTaskIds, id);
      if (previousTaskIds.length === 0) {
        messageTaskIdsByMessageId.delete(previousMessageId);
      }
    }
  }

  taskMessageIdByTaskId.set(id, msgId);
  const taskIds = messageTaskIdsByMessageId.get(msgId) || [];
  if (!taskIds.includes(id)) {
    taskIds.push(id);
  }
  messageTaskIdsByMessageId.set(msgId, taskIds);
  dequeuePendingTaskBinding(id);

  removeTimelineItem(getTaskKey(id));
  upsertTimelineItem(getMessageKey(msgId), {
    kind: "message",
    id: msgId
  });
  taskNodeById.delete(id);
  scheduleVirtualRender({ stickToBottom: isTimelineNearBottom() });
  return true;
}

function bindPendingTaskToMessage(messageId) {
  const msgId = String(messageId || "");
  if (!msgId) {
    return;
  }
  const message = messageById.get(msgId);
  if (!message || message.role !== "assistant") {
    return;
  }
  while (pendingTaskBindingQueue.length > 0) {
    const taskId = pendingTaskBindingQueue.shift();
    if (!taskId) {
      continue;
    }
    if (!taskModelById.has(taskId) || taskMessageIdByTaskId.has(taskId)) {
      continue;
    }
    bindTaskToMessage(taskId, msgId);
    return;
  }
}

function shouldRenderStandaloneTask(taskId) {
  const id = String(taskId || "");
  if (!id) {
    return false;
  }
  const messageId = taskMessageIdByTaskId.get(id);
  if (!messageId) {
    return true;
  }
  return !messageById.has(messageId);
}

function upsertTimelineItem(key, item) {
  if (!timelineItemByKey.has(key)) {
    timelineOrder.push(key);
  }
  timelineItemByKey.set(key, item);
  if (!timelineHeightByKey.has(key)) {
    timelineHeightByKey.set(key, item.kind === "task" ? VIRTUAL_MIN_TASK_HEIGHT : VIRTUAL_MIN_MESSAGE_HEIGHT);
  }
  timelineDirty = true;
}

function clearVirtualTimelineData() {
  timelineOrder.length = 0;
  timelineVisibleKeys.length = 0;
  timelineItemByKey.clear();
  timelineHeightByKey.clear();
  messageNodeById.clear();
  taskNodeById.clear();
  if (timelineWindow) {
    timelineWindow.innerHTML = "";
  }
  if (timelineTopSpacer) {
    timelineTopSpacer.style.height = "0px";
  }
  if (timelineBottomSpacer) {
    timelineBottomSpacer.style.height = "0px";
  }
  lastVirtualStart = -1;
  lastVirtualEnd = -1;
  timelineDirty = true;
}

function isTimelineNearBottom() {
  const threshold = 64;
  const distance = elements.messages.scrollHeight - (elements.messages.scrollTop + elements.messages.clientHeight);
  return distance <= threshold;
}

function scheduleVirtualRender(options = {}) {
  if (options.stickToBottom) {
    forceStickToBottom = true;
  }
  if (virtualRenderRaf) {
    return;
  }
  virtualRenderRaf = requestAnimationFrame(() => {
    virtualRenderRaf = 0;
    renderVirtualTimeline();
  });
}

function renderVirtualTimeline() {
  if (!timelineWindow || !timelineTopSpacer || !timelineBottomSpacer) {
    return;
  }

  const count = timelineOrder.length;
  if (count === 0) {
    timelineWindow.innerHTML = "";
    timelineTopSpacer.style.height = "0px";
    timelineBottomSpacer.style.height = "0px";
    timelineVisibleKeys.length = 0;
    messageNodeById.clear();
    taskNodeById.clear();
    lastVirtualStart = -1;
    lastVirtualEnd = -1;
    return;
  }

  const heights = timelineOrder.map((key) => timelineHeightByKey.get(key) || VIRTUAL_MIN_MESSAGE_HEIGHT);
  const prefix = [0];
  for (const value of heights) {
    prefix.push(prefix[prefix.length - 1] + value);
  }
  const totalHeight = prefix[prefix.length - 1];
  const viewportHeight = Math.max(1, elements.messages.clientHeight);
  const scrollTop = elements.messages.scrollTop;
  const startY = Math.max(0, scrollTop - VIRTUAL_OVERSCAN_PX);
  const endY = scrollTop + viewportHeight + VIRTUAL_OVERSCAN_PX;

  let startIndex = binarySearchPrefix(prefix, startY);
  let endIndex = binarySearchPrefix(prefix, endY);
  endIndex = Math.min(count, Math.max(endIndex + 1, startIndex + 1));

  if (timelineDirty || startIndex !== lastVirtualStart || endIndex !== lastVirtualEnd) {
    renderVirtualRange(startIndex, endIndex);
    lastVirtualStart = startIndex;
    lastVirtualEnd = endIndex;
    timelineDirty = false;
  }

  const topHeight = prefix[startIndex];
  const bottomHeight = Math.max(0, totalHeight - prefix[endIndex]);
  timelineTopSpacer.style.height = `${topHeight}px`;
  timelineBottomSpacer.style.height = `${bottomHeight}px`;

  measureVisibleTimelineHeights();

  if (forceStickToBottom) {
    forceStickToBottom = false;
    elements.messages.scrollTop = elements.messages.scrollHeight;
    scheduleVirtualRender();
  }
}

function renderVirtualRange(startIndex, endIndex) {
  const fragment = document.createDocumentFragment();
  messageNodeById.clear();
  taskNodeById.clear();
  timelineVisibleKeys.length = 0;

  for (let index = startIndex; index < endIndex; index += 1) {
    const key = timelineOrder[index];
    const item = timelineItemByKey.get(key);
    if (!item) {
      continue;
    }
    let node;
    if (item.kind === "message") {
      const message = messageById.get(item.id);
      if (!message) {
        continue;
      }
      const taskIds = getBoundTaskIdsForMessage(item.id);
      if (taskIds.length > 0) {
        const taskModels = taskIds
          .map((taskId) => taskModelById.get(taskId))
          .filter(Boolean);
        if (taskModels.length > 0) {
          const combined = createCommandMessageNode(message, taskModels);
          node = combined.node;
          for (const [taskId, taskNode] of combined.taskNodesById.entries()) {
            taskNodeById.set(taskId, taskNode);
          }
        } else {
          node = createMessageNode(message);
        }
      } else {
        node = createMessageNode(message);
      }
      messageNodeById.set(item.id, node);
    } else {
      const model = taskModelById.get(item.id);
      if (!model) {
        continue;
      }
      if (!shouldRenderStandaloneTask(item.id)) {
        continue;
      }
      node = createTaskNode(model);
      taskNodeById.set(item.id, node);
    }
    node.dataset.timelineKey = key;
    fragment.appendChild(node);
    timelineVisibleKeys.push(key);
  }
  timelineWindow.replaceChildren(fragment);
}

function measureVisibleTimelineHeights() {
  let changed = false;
  for (const key of timelineVisibleKeys) {
    const node = timelineWindow.querySelector(`[data-timeline-key="${key}"]`);
    if (!node) {
      continue;
    }
    const fallback = key.startsWith("t:") ? VIRTUAL_MIN_TASK_HEIGHT : VIRTUAL_MIN_MESSAGE_HEIGHT;
    const next = Math.max(fallback, Math.ceil(node.getBoundingClientRect().height));
    const prev = timelineHeightByKey.get(key) || fallback;
    if (Math.abs(next - prev) > 1) {
      timelineHeightByKey.set(key, next);
      changed = true;
    }
  }
  if (changed) {
    scheduleVirtualRender();
  }
}

function binarySearchPrefix(prefix, target) {
  let low = 0;
  let high = prefix.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (prefix[mid] <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return Math.max(0, low - 1);
}

function autoResizeInput() {
  elements.input.style.height = "auto";
  const nextHeight = Math.min(INPUT_MAX_HEIGHT, Math.max(72, elements.input.scrollHeight));
  elements.input.style.height = `${nextHeight}px`;
  elements.input.style.overflowY = elements.input.scrollHeight > INPUT_MAX_HEIGHT ? "auto" : "hidden";
}

function updateSendButtonState() {
  elements.sendBtn.disabled = !elements.input.value.trim();
}

function syncContextToExtension() {
  state.context = buildContextRequest();
}

function insertSlashShortcut(shortcut) {
  const value = String(shortcut || "").trim();
  if (!value) {
    return;
  }
  const prefix = elements.input.value.slice(0, elements.input.selectionStart ?? elements.input.value.length);
  const suffix = elements.input.value.slice(elements.input.selectionEnd ?? elements.input.value.length);
  const left = prefix && !/\s$/.test(prefix) ? `${prefix} ` : prefix;
  const right = suffix && !/^\s/.test(suffix) ? ` ${suffix}` : suffix;
  const insertion = `${value} `;
  elements.input.value = `${left}${insertion}${right}`;
  const caret = left.length + insertion.length;
  elements.input.focus();
  elements.input.setSelectionRange(caret, caret);
  autoResizeInput();
  updateSendButtonState();
}

function sendCurrentMessage() {
  const text = elements.input.value.trim();
  if (!text) {
    return;
  }
  if (tryHandleLocalClientCommand(text)) {
    elements.input.value = "";
    autoResizeInput();
    updateSendButtonState();
    return;
  }
  queueOutgoingMessage({
    threadId: state.threadId,
    text,
    context: buildContextRequest()
  });
  elements.input.value = "";
  autoResizeInput();
  updateSendButtonState();
}

function tryHandleLocalClientCommand(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (
    normalized === "/dev replay"
    || normalized === "/dev replay-task"
    || normalized === "/replay task"
    || normalized === "/task replay"
  ) {
    runLocalTaskEventReplay();
    showToast("info", ui.devReplayToast);
    return true;
  }
  return false;
}

function runLocalTaskEventReplay() {
  const threadId = state.threadId;
  const base = Date.now();
  const diffTaskId = `demo_diff_${base.toString(36)}`;
  const cmdTaskId = `demo_cmd_${(base + 1).toString(36)}`;
  const diffId = `demo_diffid_${(base + 2).toString(36)}`;

  appendLocalReplayMessage("user", "Local replay: validate normal message rendering.");
  appendLocalReplayMessage("assistant", "Running task_* replay with diff and command proposals...");

  const events = [
    { at: 0, payload: { type: "task_start", threadId, taskId: diffTaskId, intent: { kind: "change", summary: "Update workspace files", confidence: 1 } } },
    { at: 1, payload: { type: "task_state", threadId, taskId: diffTaskId, state: "ROUTED", message: "Intent routed to change flow" } },
    { at: 2, payload: { type: "task_state", threadId, taskId: diffTaskId, state: "PROPOSING", message: "Building diff proposal" } },
    { at: 3, payload: { type: "task_stream_chunk", threadId, taskId: diffTaskId, messageId: `demo_stream_${base.toString(36)}`, chunk: "Scanning files...\n" } },
    { at: 4, payload: { type: "task_stream_chunk", threadId, taskId: diffTaskId, messageId: `demo_stream_${base.toString(36)}`, chunk: "Preparing patch preview...\n" } },
    {
      at: 5,
      payload: {
        type: "task_proposal",
        threadId,
        taskId: diffTaskId,
        result: {
          taskId: diffTaskId,
          intent: { kind: "change", summary: "Update workspace files", confidence: 1 },
          proposal: {
            type: "diff",
            diffId,
            unifiedDiff: "diff --git a/demo.txt b/demo.txt\n--- a/demo.txt\n+++ b/demo.txt\n@@ -1 +1,2 @@\n-old line\n+old line\n+new line",
            files: [{ path: "demo.txt", additions: 2, deletions: 1 }]
          },
          requires: { mode: "local_approval", action: "apply_diff" },
          summary: "Diff proposal is ready."
        }
      }
    },
    { at: 6, payload: { type: "task_state", threadId, taskId: diffTaskId, state: "WAITING_APPROVAL", message: "Waiting local approval for apply diff" } },
    { at: 7, payload: { type: "task_end", threadId, taskId: diffTaskId, status: "ok" } },
    { at: 9, payload: { type: "task_start", threadId, taskId: cmdTaskId, intent: { kind: "run", summary: "Run verification command", confidence: 1 } } },
    { at: 10, payload: { type: "task_state", threadId, taskId: cmdTaskId, state: "PROPOSING", message: "Building command proposal" } },
    {
      at: 11,
      payload: {
        type: "task_proposal",
        threadId,
        taskId: cmdTaskId,
        result: {
          taskId: cmdTaskId,
          intent: { kind: "run", summary: "Run verification command", confidence: 1 },
          proposal: {
            type: "command",
            cmd: "pnpm -r run lint",
            cwd: ".",
            reason: "Verify project quality gates."
          },
          requires: { mode: "local_approval", action: "run_command" },
          summary: "Command proposal is ready."
        }
      }
    },
    { at: 12, payload: { type: "task_state", threadId, taskId: cmdTaskId, state: "WAITING_APPROVAL", message: "Waiting local approval for command execution" } },
    { at: 13, payload: { type: "task_end", threadId, taskId: cmdTaskId, status: "ok" } }
  ];

  for (const event of events) {
    const delay = Math.max(0, Number(event.at) * LOCAL_TASK_REPLAY_STEP_MS);
    setTimeout(() => {
      handleExtMessage(event.payload);
    }, delay);
  }
}

function appendLocalReplayMessage(role, text) {
  localDemoSeq += 1;
  handleExtMessage({
    type: "append_message",
    threadId: state.threadId,
    message: {
      id: `local_demo_msg_${localDemoSeq.toString(36)}`,
      role,
      createdAt: new Date().toISOString(),
      text
    }
  });
}

function queueOutgoingMessage(message) {
  if (!message || typeof message.text !== "string" || !message.text.trim()) {
    return;
  }
  const queuedAhead = outboundMessageQueue.length;
  const processingAhead = isChatBusy() ? 1 : 0;
  const shouldToastQueued = isChatBusy() || outboundMessageQueue.length > 0;
  outboundMessageQueue.push({
    id: createQueueItemId(),
    enqueuedAt: Date.now(),
    threadId: message.threadId || state.threadId,
    text: message.text,
    context: message.context || {}
  });
  renderQueuePanel();
  if (shouldToastQueued) {
    const ahead = queuedAhead + processingAhead;
    showToast(
      "info",
      typeof ui.queuedToast === "function"
        ? ui.queuedToast(ahead)
        : ui.queuedToast
    );
  }
  flushQueuedMessages();
}

function flushQueuedMessages() {
  if (outboundMessageQueue.length <= 0) {
    renderQueuePanel();
    renderWaitIndicator();
    return;
  }
  if (isChatBusy()) {
    renderQueuePanel();
    renderWaitIndicator();
    return;
  }
  const next = outboundMessageQueue.shift();
  renderQueuePanel();
  if (!next) {
    renderWaitIndicator();
    return;
  }
  pendingAssistantPlaceholders += 1;
  ensureWaitNoticeScheduled();
  post({
    type: "send_message",
    threadId: next.threadId || state.threadId,
    text: next.text,
    context: next.context || {}
  });
  renderWaitIndicator();
}

function clearQueuedMessages(showFeedback = false) {
  if (outboundMessageQueue.length <= 0) {
    return;
  }
  const count = outboundMessageQueue.length;
  outboundMessageQueue.splice(0, outboundMessageQueue.length);
  renderQueuePanel();
  renderWaitIndicator();
  if (showFeedback) {
    showToast(
      "info",
      typeof ui.queueClearedToast === "function"
        ? ui.queueClearedToast(count)
        : ui.queueClearedToast
    );
  }
}

function isChatBusy() {
  return getPendingWaitCount() > 0 || streamingMessageIds.size > 0 || activeTaskIds.size > 0;
}

function createQueueItemId() {
  queueItemSeq += 1;
  return `queued_${Date.now().toString(36)}_${queueItemSeq.toString(36)}`;
}

function renderQueuePanel() {
  if (!elements.queuePanel || !elements.queueList || !elements.queueTitle) {
    return;
  }
  const count = outboundMessageQueue.length;
  if (count <= 0) {
    elements.queuePanel.classList.add("hidden");
    elements.queueTitle.textContent = "";
    elements.queueList.innerHTML = "";
    return;
  }

  elements.queuePanel.classList.remove("hidden");
  elements.queueTitle.textContent = typeof ui.queueTitle === "function"
    ? ui.queueTitle(count)
    : ui.queueTitle;
  elements.queueList.innerHTML = "";

  for (let index = 0; index < outboundMessageQueue.length; index += 1) {
    const item = outboundMessageQueue[index];
    const li = document.createElement("li");
    li.className = "queue-item";
    li.dataset.queueId = item.id;

    const idx = document.createElement("span");
    idx.className = "queue-item-index";
    idx.textContent = typeof ui.queueItemIndex === "function"
      ? ui.queueItemIndex(index + 1)
      : `#${index + 1}`;
    li.appendChild(idx);

    const text = document.createElement("div");
    text.className = "queue-item-text";
    text.textContent = summarizeQueuedMessageText(item.text);
    li.appendChild(text);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "queue-item-cancel";
    cancelBtn.textContent = ui.queueCancel;
    cancelBtn.addEventListener("click", () => {
      cancelQueuedMessage(item.id);
    });
    li.appendChild(cancelBtn);

    elements.queueList.appendChild(li);
  }
}

function cancelQueuedMessage(queueId) {
  const index = outboundMessageQueue.findIndex((item) => item.id === queueId);
  if (index < 0) {
    return;
  }
  outboundMessageQueue.splice(index, 1);
  renderQueuePanel();
  renderWaitIndicator();
  showToast(
    "info",
    typeof ui.queueItemCanceledToast === "function"
      ? ui.queueItemCanceledToast(index + 1)
      : ui.queueItemCanceledToast
  );
  flushQueuedMessages();
}

function summarizeQueuedMessageText(text) {
  const compact = normalizeDisplayText(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (compact.length <= QUEUE_PREVIEW_MAX_CHARS) {
    return compact;
  }
  return `${compact.slice(0, QUEUE_PREVIEW_MAX_CHARS - 1)}...`;
}

function handleExtMessage(message) {
  if (!message || typeof message.type !== "string") {
    return;
  }
  if (message.type === "state") {
    resetWaitNoticeTracking();
    activeTaskIds.clear();
    state.threadId = message.threadId || "default";
    state.messages = Array.isArray(message.state?.messages) ? message.state.messages : [];
    state.context = message.state?.context || {};
    applyContextFromState();
    renderAllMessages();
    flushQueuedMessages();
    return;
  }
  if (message.type === "append_message") {
    if (message.threadId !== state.threadId) {
      return;
    }
    const stickToBottom = isTimelineNearBottom();
    registerAssistantPlaceholder(message.message);
    state.messages.push(message.message);
    renderAppendedMessage(message.message, { stickToBottom });
    return;
  }
  if (message.type === "update_message") {
    if (message.threadId !== state.threadId) {
      return;
    }
    const idx = state.messages.findIndex((item) => item.id === message.messageId);
    if (idx < 0) {
      return;
    }
    state.messages[idx] = { ...state.messages[idx], ...message.patch };
    updateRenderedMessage(state.messages[idx]);
    resolveWaitForMessage(message.messageId);
    flushQueuedMessages();
    return;
  }
  if (message.type === "stream_start") {
    markStreaming(message.messageId, true);
    bindPendingTaskToMessage(message.messageId);
    flushQueuedMessages();
    return;
  }
  if (message.type === "stream_chunk") {
    resolveWaitForMessage(message.messageId);
    appendChunk(message.messageId, String(message.chunk || ""));
    flushQueuedMessages();
    return;
  }
  if (message.type === "stream_end") {
    markStreaming(message.messageId, false);
    resolveWaitForMessage(message.messageId);
    flushQueuedMessages();
    return;
  }
  if (message.type === "task_start") {
    if (message.threadId !== state.threadId) {
      return;
    }
    activeTaskIds.add(String(message.taskId || ""));
    renderTaskStart(message);
    setTaskStatus(message.taskId, "planning");
    flushQueuedMessages();
    return;
  }
  if (message.type === "task_state") {
    if (message.threadId !== state.threadId) {
      return;
    }
    const taskId = String(message.taskId || "");
    if (isTerminalTaskState(message.state)) {
      activeTaskIds.delete(taskId);
    } else if (taskId) {
      activeTaskIds.add(taskId);
    }
    appendTaskState(message.taskId, formatTaskStateLine(message.state, message.message));
    const mapped = mapTaskStateToConversationStatus(message.state);
    if (mapped) {
      setTaskStatus(message.taskId, mapped);
    }
    if (isTerminalTaskState(message.state)) {
      markTaskCompleted(message.taskId);
    }
    flushQueuedMessages();
    return;
  }
  if (message.type === "task_stream_chunk") {
    if (message.threadId !== state.threadId) {
      return;
    }
    bindTaskToMessage(message.taskId, message.messageId);
    appendTaskStream(message.taskId, String(message.chunk || ""));
    flushQueuedMessages();
    return;
  }
  if (message.type === "task_proposal") {
    if (message.threadId !== state.threadId) {
      return;
    }
    setTaskProposal(message.taskId, message.result);
    appendTaskState(message.taskId, ui.taskProposalLine(formatProposalType(message.result?.proposal?.type)));
    setTaskStatus(message.taskId, "proposalReady");
    flushQueuedMessages();
    return;
  }
  if (message.type === "task_end") {
    if (message.threadId !== state.threadId) {
      return;
    }
    activeTaskIds.delete(String(message.taskId || ""));
    dequeuePendingTaskBinding(message.taskId);
    appendTaskState(message.taskId, ui.taskEndLine(formatTaskEndStatus(message.status)));
    const mapped = mapTaskEndToConversationStatus(message.status);
    setTaskStatus(message.taskId, mapped);
    markTaskCompleted(message.taskId);
    flushQueuedMessages();
    return;
  }
  if (message.type === "toast") {
    showToast(message.level || "info", message.message || "");
    return;
  }
  if (message.type === "action_result" && message.message) {
    showToast(message.ok ? "info" : "warn", message.message);
  }
}

function renderAllMessages() {
  clearVirtualTimelineData();
  messageById.clear();
  taskModelById.clear();
  taskStateById.clear();
  streamingMessageIds.clear();
  clearTaskMessageBindings();
  taskStartSequence = 0;
  for (const message of state.messages) {
    messageById.set(message.id, message);
    upsertTimelineItem(getMessageKey(message.id), {
      kind: "message",
      id: message.id
    });
  }
  scheduleVirtualRender({ stickToBottom: true });
}

function renderAppendedMessage(message, options = {}) {
  messageById.set(message.id, message);
  upsertTimelineItem(getMessageKey(message.id), {
    kind: "message",
    id: message.id
  });
  scheduleVirtualRender({ stickToBottom: Boolean(options.stickToBottom) });
}

function updateRenderedMessage(message) {
  const merged = {
    ...(messageById.get(message.id) || {}),
    ...message
  };
  messageById.set(message.id, merged);
  upsertTimelineItem(getMessageKey(message.id), {
    kind: "message",
    id: message.id
  });

  const node = messageNodeById.get(message.id);
  if (node) {
    const body = node.querySelector(".msg-text");
    if (body) {
      renderMessageBody(body, merged.text);
    }
    const attachmentNode = node.querySelector(".attachments");
    if (attachmentNode) {
      attachmentNode.innerHTML = "";
      renderAttachments(attachmentNode, merged.attachments || []);
    }
    node.classList.toggle("streaming", streamingMessageIds.has(message.id));
    refreshCommandSummaryForMessage(message.id);
    scheduleVirtualRender();
    return;
  }
  scheduleVirtualRender();
}

function createMessageNode(message, options = {}) {
  const embedded = Boolean(options.embedded);
  const node = document.createElement("article");
  node.className = `message role-${message.role}`;
  if (embedded) {
    node.classList.add("message-embedded");
  }
  node.dataset.messageId = message.id;
  if (!embedded) {
    node.classList.toggle("streaming", streamingMessageIds.has(message.id));
  }

  const header = document.createElement("div");
  header.className = "msg-header";
  const author = document.createElement("span");
  author.className = "msg-author";
  author.textContent = resolveMessageAuthor(message);
  header.appendChild(author);

  const separator = document.createElement("span");
  separator.className = "msg-separator";
  separator.textContent = " - ";
  header.appendChild(separator);

  const time = document.createElement("time");
  time.className = "msg-time";
  time.textContent = formatTime(message.createdAt);
  header.appendChild(time);

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "mini-copy-btn msg-copy-btn";
  copyBtn.textContent = ui.genericCopy;
  copyBtn.title = ui.copyMessage;
  copyBtn.setAttribute("aria-label", ui.copyMessage);
  copyBtn.addEventListener("click", () => {
    const current = messageById.get(message.id) || message;
    post({
      type: "copy_to_clipboard",
      text: buildMessageCopyText(current)
    });
  });
  header.appendChild(copyBtn);
  node.appendChild(header);

  const text = document.createElement("div");
  text.className = "msg-text";
  renderMessageBody(text, message.text);
  node.appendChild(text);

  const attachments = document.createElement("div");
  attachments.className = "attachments";
  renderAttachments(attachments, message.attachments || []);
  node.appendChild(attachments);

  return node;
}

function createCommandMessageNode(message, taskModels) {
  const node = document.createElement("article");
  node.className = `message command-card role-${message.role}`;
  node.dataset.messageId = message.id;
  node.classList.toggle("streaming", streamingMessageIds.has(message.id));

  const taskNodesById = new Map();
  const taskStack = document.createElement("div");
  taskStack.className = "command-task-stack";
  for (const model of taskModels) {
    const taskNode = createTaskNode(model, { embedded: true });
    taskStack.appendChild(taskNode);
    taskNodesById.set(model.taskId, taskNode);
  }
  node.appendChild(
    createCommandSection(
      ui.commandSectionTask,
      taskStack,
      "command-section-task"
    )
  );

  const summaryNode = document.createElement("pre");
  summaryNode.className = "command-summary";
  summaryNode.textContent = buildCommandSummaryText(message, taskModels);
  node.appendChild(
    createCommandSection(
      ui.commandSectionSummary,
      summaryNode,
      "command-section-summary"
    )
  );

  const assistantNode = createMessageNode(message, { embedded: true });
  assistantNode.classList.add("command-assistant");
  node.appendChild(
    createCommandSection(
      ui.commandSectionAssistant,
      assistantNode,
      "command-section-assistant"
    )
  );

  return {
    node,
    taskNodesById
  };
}

function createCommandSection(titleText, bodyNode, className = "") {
  const section = document.createElement("section");
  section.className = `command-section${className ? ` ${className}` : ""}`;
  const title = document.createElement("div");
  title.className = "command-section-title";
  title.textContent = titleText;
  section.appendChild(title);
  section.appendChild(bodyNode);
  return section;
}

function getTaskModelsForMessage(messageId) {
  const taskIds = getBoundTaskIdsForMessage(messageId);
  if (taskIds.length <= 0) {
    return [];
  }
  return taskIds
    .map((taskId) => taskModelById.get(taskId))
    .filter(Boolean);
}

function refreshCommandSummaryForMessage(messageId) {
  const id = String(messageId || "");
  if (!id) {
    return;
  }
  const node = messageNodeById.get(id);
  if (!node || !node.classList.contains("command-card")) {
    return;
  }
  const summaryNode = node.querySelector(".command-summary");
  if (!summaryNode) {
    return;
  }
  const message = messageById.get(id);
  if (!message) {
    return;
  }
  summaryNode.textContent = buildCommandSummaryText(message, getTaskModelsForMessage(id));
}

function buildCommandSummaryText(message, taskModels) {
  const lines = [];
  const latestTask = Array.isArray(taskModels) && taskModels.length > 0
    ? taskModels[taskModels.length - 1]
    : undefined;
  const taskSummary = firstMeaningfulLine(
    latestTask?.summary || latestTask?.proposal?.summary || ""
  );
  if (taskSummary) {
    lines.push(`${ui.commandSummaryTaskLabel}: ${taskSummary}`);
  }
  if (latestTask?.statusKey) {
    const statusLabel = ui.stageLabels?.[latestTask.statusKey] || latestTask.statusKey;
    lines.push(`${ui.commandSummaryStatusLabel}: ${statusLabel}`);
  }
  const resultLine = firstMeaningfulLine(message?.text)
    || firstMeaningfulLine(latestTask?.streamText || "")
    || firstMeaningfulLine(
      Array.isArray(latestTask?.lines) && latestTask.lines.length > 0
        ? latestTask.lines[latestTask.lines.length - 1]
        : ""
    );
  if (resultLine) {
    lines.push(`${ui.commandSummaryTextLabel}: ${resultLine}`);
  }
  if (lines.length <= 0) {
    return ui.commandSummaryEmpty || "";
  }
  return lines.join("\n");
}

function firstMeaningfulLine(text) {
  const normalized = normalizeDisplayText(text || "");
  if (!normalized) {
    return "";
  }
  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (lines.length <= 0) {
    return "";
  }
  const first = lines[0];
  return first.length > 220 ? `${first.slice(0, 217)}...` : first;
}

function renderMessageBody(root, value) {
  const text = normalizeDisplayText(value);
  if (!looksLikeMarkdown(text)) {
    root.classList.remove("is-markdown");
    root.textContent = text;
    return;
  }
  root.classList.add("is-markdown");
  const blocks = parseMarkdownBlocks(text);
  const fragment = document.createDocumentFragment();
  for (const block of blocks) {
    const node = renderMarkdownBlock(block);
    if (node) {
      fragment.appendChild(node);
    }
  }
  root.replaceChildren(fragment);
}

function looksLikeMarkdown(text) {
  if (!text) {
    return false;
  }
  return /```/.test(text)
    || /^#{1,6}\s+/m.test(text)
    || /^>\s+/m.test(text)
    || /^(\s*[-*+]\s+|\s*\d+\.\s+)/m.test(text)
    || /\[[^\]]+\]\(https?:\/\/[^\s)]+\)/.test(text)
    || /`[^`\n]+`/.test(text);
}

function parseMarkdownBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const fenceMatch = line.match(/^```([A-Za-z0-9_+.\-#]*)\s*$/);

    if (fenceMatch) {
      const lang = fenceMatch[1] || "";
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && /^```/.test(lines[index])) {
        index += 1;
      }
      blocks.push({
        type: "code",
        lang,
        text: codeLines.join("\n")
      });
      continue;
    }

    if (!trimmed) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2]
      });
      index += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, "").trim());
        index += 1;
      }
      blocks.push({
        type: "ul",
        items
      });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, "").trim());
        index += 1;
      }
      blocks.push({
        type: "ol",
        items
      });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({
        type: "quote",
        text: quoteLines.join("\n")
      });
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !isMarkdownStartLine(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    if (paragraphLines.length > 0) {
      blocks.push({
        type: "paragraph",
        text: paragraphLines.join("\n")
      });
      continue;
    }

    index += 1;
  }

  return blocks;
}

function isMarkdownStartLine(line) {
  return /^```/.test(line)
    || /^(#{1,6})\s+/.test(line)
    || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+\.\s+/.test(line)
    || /^\s*>\s?/.test(line);
}

function renderMarkdownBlock(block) {
  if (!block || typeof block.type !== "string") {
    return undefined;
  }

  if (block.type === "code") {
    return createCodeBlockNode(block.lang, block.text);
  }

  if (block.type === "heading") {
    const level = Math.max(1, Math.min(6, Number(block.level) || 1));
    const node = document.createElement(`h${level}`);
    node.className = `md-heading md-h${level}`;
    appendInlineMarkdown(node, block.text || "");
    return node;
  }

  if (block.type === "ul" || block.type === "ol") {
    const node = document.createElement(block.type === "ul" ? "ul" : "ol");
    node.className = `md-list ${block.type === "ul" ? "md-ul" : "md-ol"}`;
    for (const item of block.items || []) {
      const li = document.createElement("li");
      appendInlineMarkdown(li, item || "");
      node.appendChild(li);
    }
    return node;
  }

  if (block.type === "quote") {
    const node = document.createElement("blockquote");
    node.className = "md-quote";
    appendInlineMarkdown(node, block.text || "");
    return node;
  }

  if (block.type === "paragraph") {
    const node = document.createElement("div");
    node.className = "md-paragraph";
    appendInlineMarkdown(node, block.text || "");
    return node;
  }

  return undefined;
}

function appendInlineMarkdown(root, text) {
  const pattern = /(`[^`\n]+`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s]+)/g;
  let cursor = 0;
  let match = pattern.exec(text);

  while (match) {
    if (match.index > cursor) {
      root.appendChild(document.createTextNode(text.slice(cursor, match.index)));
    }

    if (match[1]) {
      const code = document.createElement("code");
      code.className = "md-inline-code";
      code.textContent = match[1].slice(1, -1);
      root.appendChild(code);
    } else {
      const label = match[3] || match[5] || "";
      const href = match[4] || match[5] || "";
      if (/^https?:\/\//i.test(href)) {
        const link = document.createElement("a");
        link.className = "md-link";
        link.href = href;
        link.target = "_blank";
        link.rel = "noreferrer noopener";
        link.textContent = label;
        root.appendChild(link);
      } else {
        root.appendChild(document.createTextNode(match[0]));
      }
    }

    cursor = pattern.lastIndex;
    match = pattern.exec(text);
  }

  if (cursor < text.length) {
    root.appendChild(document.createTextNode(text.slice(cursor)));
  }
}

function createCodeBlockNode(lang, text) {
  const wrapper = document.createElement("div");
  wrapper.className = "md-code-block";

  const header = document.createElement("div");
  header.className = "md-code-header";

  const langTag = document.createElement("span");
  langTag.className = "md-code-lang";
  langTag.textContent = lang || "";
  header.appendChild(langTag);

  const actions = document.createElement("div");
  actions.className = "md-code-actions";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "md-code-btn";
  copyBtn.textContent = ui.copyCode;
  copyBtn.addEventListener("click", () => {
    post({
      type: "copy_to_clipboard",
      text
    });
  });
  actions.appendChild(copyBtn);

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "md-code-btn";
  toggleBtn.textContent = ui.collapseCode;
  actions.appendChild(toggleBtn);
  header.appendChild(actions);
  wrapper.appendChild(header);

  const pre = document.createElement("pre");
  pre.className = "md-code-pre";
  const code = document.createElement("code");
  code.className = "md-code";
  code.textContent = text;
  pre.appendChild(code);
  wrapper.appendChild(pre);

  toggleBtn.addEventListener("click", () => {
    const collapsed = wrapper.classList.toggle("is-collapsed");
    pre.hidden = collapsed;
    toggleBtn.textContent = collapsed
      ? ui.expandCode
      : ui.collapseCode;
    scheduleVirtualRender();
  });

  return wrapper;
}

function renderAttachments(root, attachments) {
  for (const attachment of attachments) {
    if (!attachment || typeof attachment.type !== "string") {
      continue;
    }
    if (attachment.type === "diff") {
      const item = document.createElement("div");
      item.className = "attachment diff";
      const title = document.createElement("div");
      title.className = "attachment-title";
      title.textContent = attachment.title || ui.diffTitle(attachment.files?.length || 0);
      item.appendChild(title);

      const actions = document.createElement("div");
      actions.className = "inline-actions";

      const viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.textContent = ui.viewDiff;
      viewBtn.addEventListener("click", () => {
        post({
          type: "view_diff",
          threadId: state.threadId,
          diffId: attachment.diffId
        });
      });
      actions.appendChild(viewBtn);

      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.textContent = ui.applyDiff;
      applyBtn.addEventListener("click", () => {
        post({
          type: "apply_diff",
          threadId: state.threadId,
          diffId: attachment.diffId
        });
      });
      actions.appendChild(applyBtn);
      item.appendChild(actions);
      root.appendChild(item);
      continue;
    }

    if (attachment.type === "git_sync_action_card") {
      root.appendChild(buildGitSyncActionCard(attachment));
      continue;
    }

    if (attachment.type === "logs") {
      const item = document.createElement("details");
      item.className = "attachment logs";
      const summary = document.createElement("summary");
      summary.textContent = attachment.title || ui.logs;
      item.appendChild(summary);
      const pre = document.createElement("pre");
      pre.textContent = attachment.text || "";
      item.appendChild(pre);
      root.appendChild(item);
      continue;
    }

    if (attachment.type === "command") {
      const item = document.createElement("div");
      item.className = "attachment command";
      const title = document.createElement("div");
      title.className = "attachment-title";
      title.textContent = attachment.title || ui.commandProposal;
      item.appendChild(title);
      const cmd = document.createElement("pre");
      cmd.textContent = attachment.cmd || "";
      item.appendChild(cmd);
      if (attachment.reason) {
        const reason = document.createElement("div");
        reason.className = "attachment-reason";
        reason.textContent = attachment.reason;
        item.appendChild(reason);
      }
      const actions = document.createElement("div");
      actions.className = "inline-actions";
      const runBtn = document.createElement("button");
      runBtn.type = "button";
      runBtn.textContent = ui.runCommand;
      runBtn.addEventListener("click", () => {
        post({
          type: "run_command",
          threadId: state.threadId,
          cmd: attachment.cmd,
          cwd: attachment.cwd
        });
      });
      actions.appendChild(runBtn);
      item.appendChild(actions);
      root.appendChild(item);
      continue;
    }

    if (attachment.type === "error") {
      const item = document.createElement("div");
      item.className = "attachment error";
      item.textContent = `${attachment.code}: ${attachment.message}`;
      root.appendChild(item);
      continue;
    }

    if (attachment.type === "status") {
      const item = document.createElement("details");
      item.className = "attachment status";
      const summary = document.createElement("summary");
      summary.textContent = attachment.title || ui.status;
      item.appendChild(summary);
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(attachment.json ?? {}, null, 2);
      item.appendChild(pre);
      root.appendChild(item);
    }
  }
}

function buildGitSyncActionCard(attachment) {
  const item = document.createElement("div");
  item.className = "attachment git-sync-card";
  item.dataset.gitSyncTaskId = attachment.taskId;

  const header = document.createElement("div");
  header.className = "git-sync-header";
  const title = document.createElement("div");
  title.className = "git-sync-title";
  title.textContent = attachment.title || ui.gitSyncTitle;
  header.appendChild(title);
  const subtitle = document.createElement("div");
  subtitle.className = "git-sync-subtitle";
  subtitle.textContent = formatGitSyncBranchUpstreamLine(
    attachment.branch,
    attachment.upstream,
    attachment.ahead,
    attachment.behind
  );
  header.appendChild(subtitle);
  item.appendChild(header);

  const statusStrip = document.createElement("div");
  statusStrip.className = "git-sync-status-strip";
  statusStrip.dataset.gitSyncStatus = "proposalReady";
  item.appendChild(statusStrip);

  const changes = document.createElement("div");
  changes.className = "git-sync-section";
  const changesTitle = document.createElement("div");
  changesTitle.className = "git-sync-section-title";
  changesTitle.textContent = `${ui.gitSyncChanges}:`;
  changes.appendChild(changesTitle);
  const changesPre = document.createElement("pre");
  changesPre.className = "git-sync-diff-stat";
  changesPre.textContent = summarizeGitSyncDiffStat(attachment.diffStat);
  changes.appendChild(changesPre);
  item.appendChild(changes);

  if (attachment.commitMessage) {
    const commitWrap = document.createElement("div");
    commitWrap.className = "git-sync-section";
    const commitTitle = document.createElement("div");
    commitTitle.className = "git-sync-section-title";
    commitTitle.textContent = `${ui.gitSyncCommitMessage}:`;
    commitWrap.appendChild(commitTitle);
    const commitValue = document.createElement("code");
    commitValue.className = "git-sync-commit-message";
    commitValue.textContent = attachment.commitMessage;
    commitWrap.appendChild(commitValue);
    item.appendChild(commitWrap);
  }

  const stepsWrap = document.createElement("div");
  stepsWrap.className = "git-sync-section";
  const stepsTitle = document.createElement("div");
  stepsTitle.className = "git-sync-section-title";
  stepsTitle.textContent = `${ui.gitSyncSteps}:`;
  stepsWrap.appendChild(stepsTitle);
  const stepsList = document.createElement("ul");
  stepsList.className = "git-sync-steps";
  for (const step of attachment.steps || []) {
    const li = document.createElement("li");
    li.className = "git-sync-step";
    li.dataset.stepId = step.id;
    li.dataset.stepStatus = step.status || "pending";
    const cmd = document.createElement("code");
    cmd.className = "git-sync-step-cmd";
    cmd.textContent = step.cmd;
    li.appendChild(cmd);
    const badge = document.createElement("span");
    badge.className = "git-sync-step-status";
    badge.textContent = ui.statusValues[step.status] || step.status;
    li.appendChild(badge);
    stepsList.appendChild(li);
  }
  stepsWrap.appendChild(stepsList);
  item.appendChild(stepsWrap);

  const actions = document.createElement("div");
  actions.className = "git-sync-actions";
  const primaryBtn = document.createElement("button");
  primaryBtn.type = "button";
  primaryBtn.className = "git-sync-primary";
  primaryBtn.dataset.gitAction = attachment.primaryAction === "push" ? "push" : "run_all";
  primaryBtn.textContent = attachment.primaryAction === "push" ? ui.approvePushPrimary : ui.approveRunAll;
  primaryBtn.addEventListener("click", () => {
    post({
      type: "git_sync_action",
      threadId: state.threadId,
      taskId: attachment.taskId,
      action: primaryBtn.dataset.gitAction
    });
  });
  actions.appendChild(primaryBtn);

  appendGitSyncStepButton(actions, attachment, "add", ui.approveAdd);
  appendGitSyncStepButton(actions, attachment, "commit", ui.approveCommit);
  const onlyPushPlan = (attachment.primaryAction === "push")
    && Array.isArray(attachment.steps)
    && attachment.steps.length === 1
    && attachment.steps[0]?.id === "push";
  if (!onlyPushPlan) {
    appendGitSyncStepButton(actions, attachment, "push", ui.approvePush);
  }

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.dataset.gitAction = "copy_summary";
  copyBtn.textContent = ui.copySummary;
  copyBtn.addEventListener("click", () => {
    post({
      type: "copy_to_clipboard",
      text: buildGitSyncSummary(attachment)
    });
  });
  actions.appendChild(copyBtn);
  item.appendChild(actions);

  const stepLogs = Array.isArray(attachment.stepLogs) ? attachment.stepLogs : [];
  if (stepLogs.length > 0) {
    const logsPanel = document.createElement("details");
    logsPanel.className = "git-sync-logs";
    const summary = document.createElement("summary");
    summary.textContent = ui.showFullLogs;
    logsPanel.appendChild(summary);
    const pre = document.createElement("pre");
    pre.textContent = stepLogs
      .map((entry) => `[${entry.stepId}]\n${entry.text}`)
      .join("\n\n");
    logsPanel.appendChild(pre);
    item.appendChild(logsPanel);
  }

  updateGitSyncCardState(item);
  return item;
}

function appendGitSyncStepButton(root, attachment, stepId, label) {
  if (!Array.isArray(attachment.steps) || !attachment.steps.some((step) => step.id === stepId)) {
    return;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.gitAction = stepId;
  button.textContent = label;
  button.addEventListener("click", () => {
    post({
      type: "git_sync_action",
      threadId: state.threadId,
      taskId: attachment.taskId,
      action: stepId
    });
  });
  root.appendChild(button);
}

function setTaskStatus(taskId, statusKey) {
  if (!statusKey) {
    return;
  }
  taskStateById.set(taskId, statusKey);
  const model = ensureTaskModel(taskId);
  if (model) {
    model.statusKey = statusKey;
  }
  const taskNode = taskNodeById.get(taskId);
  if (taskNode) {
    taskNode.dataset.taskStatus = statusKey;
    const statusBadge = taskNode.querySelector(".task-status");
    if (statusBadge) {
      statusBadge.dataset.status = statusKey;
      statusBadge.textContent = ui.stageLabels[statusKey] || statusKey;
    }
  }
  const messageId = taskMessageIdByTaskId.get(String(taskId || ""));
  if (messageId) {
    refreshCommandSummaryForMessage(messageId);
  }
  timelineDirty = true;
  scheduleVirtualRender();
  refreshGitSyncCardsForTask(taskId);
}

function refreshGitSyncCardsForTask(taskId) {
  const cards = document.querySelectorAll(`[data-git-sync-task-id="${taskId}"]`);
  for (const card of cards) {
    updateGitSyncCardState(card);
  }
}

function updateGitSyncCardState(card) {
  const taskId = card.dataset.gitSyncTaskId;
  if (!taskId) {
    return;
  }
  const status = taskStateById.get(taskId) || "proposalReady";
  const statusStrip = card.querySelector(".git-sync-status-strip");
  if (statusStrip) {
    statusStrip.dataset.gitSyncStatus = status;
    statusStrip.textContent = ui.gitSyncStatusLabels[status] || status;
  }

  const isTerminal = status === "completed" || status === "failed";
  const stepState = {
    add: getGitSyncStepState(card, "add"),
    commit: getGitSyncStepState(card, "commit"),
    push: getGitSyncStepState(card, "push")
  };
  const hasStep = {
    add: stepState.add !== "skipped",
    commit: stepState.commit !== "skipped",
    push: stepState.push !== "skipped"
  };
  const hasPending = ["add", "commit", "push"].some((stepId) => {
    const value = stepState[stepId];
    return value === "pending";
  });

  const buttons = card.querySelectorAll("button[data-git-action]");
  for (const button of buttons) {
    const action = button.dataset.gitAction;
    if (!action || action === "copy_summary") {
      button.disabled = false;
      continue;
    }
    if (isTerminal) {
      button.disabled = true;
      continue;
    }
    if (action === "run_all") {
      button.disabled = !hasPending;
      continue;
    }
    if (action === "add") {
      button.disabled = !hasStep.add || stepState.add !== "pending";
      continue;
    }
    if (action === "commit") {
      const addReady = !hasStep.add || stepState.add === "completed";
      button.disabled = !hasStep.commit || stepState.commit !== "pending" || !addReady;
      continue;
    }
    if (action === "push") {
      const commitReady = !hasStep.commit || stepState.commit === "completed";
      button.disabled = !hasStep.push || stepState.push !== "pending" || !commitReady;
      continue;
    }
  }
}

function getGitSyncStepState(card, stepId) {
  const node = card.querySelector(`.git-sync-step[data-step-id="${stepId}"]`);
  if (!node) {
    return "skipped";
  }
  return node.dataset.stepStatus || "pending";
}

function summarizeGitSyncDiffStat(diffStat) {
  const text = normalizeDisplayText(diffStat || "").trim();
  if (!text) {
    return ui.gitSyncNoDiffStat;
  }
  const lines = text.split("\n").slice(0, 8);
  return lines.join("\n");
}

function buildGitSyncSummary(attachment) {
  const lines = [
    `${ui.gitSyncTitle}`,
    `${ui.gitSyncBranchLabel}: ${resolveGitSyncBranch(attachment.branch)}`,
    `${ui.gitSyncUpstreamLabel}: ${resolveGitSyncUpstream(attachment.upstream)}`,
    `${ui.gitSyncAheadBehindLabel}: ${attachment.ahead}/${attachment.behind}`,
    formatGitSyncChangesLine(attachment.staged, attachment.unstaged, attachment.untracked),
    attachment.commitMessage ? `${ui.gitSyncCommitLabel}: ${attachment.commitMessage}` : "",
    `${ui.gitSyncSteps}:`,
    ...(attachment.steps || []).map((step) => `- ${step.cmd} [${step.status}]`)
  ].filter(Boolean);
  return lines.join("\n");
}

function resolveGitSyncBranch(branch) {
  return branch || ui.gitSyncDetached;
}

function resolveGitSyncUpstream(upstream) {
  return upstream || ui.gitSyncNone;
}

function formatGitSyncBranchUpstreamLine(branch, upstream, ahead, behind) {
  return [
    `${ui.gitSyncBranchLabel}: ${resolveGitSyncBranch(branch)}`,
    `${ui.gitSyncUpstreamLabel}: ${resolveGitSyncUpstream(upstream)}`,
    `${ui.gitSyncAheadBehindLabel}: ${ahead}/${behind}`
  ].join("  ");
}

function formatGitSyncChangesLine(staged, unstaged, untracked) {
  return `${ui.gitSyncChangesLabel}: ${ui.gitSyncStagedLabel}=${staged} ${ui.gitSyncUnstagedLabel}=${unstaged} ${ui.gitSyncUntrackedLabel}=${untracked}`;
}

function buildMessageCopyText(message) {
  const current = message || {};
  const lines = [
    `${resolveMessageAuthor(current)} ${formatTime(current.createdAt)}`
  ];
  const text = normalizeDisplayText(current.text || "").trim();
  if (text) {
    lines.push(text);
  }
  const attachments = Array.isArray(current.attachments) ? current.attachments : [];
  for (const attachment of attachments) {
    const summarized = summarizeAttachmentForCopy(attachment);
    if (!summarized) {
      continue;
    }
    lines.push(summarized);
  }
  return lines.join("\n\n").trim();
}

function summarizeAttachmentForCopy(attachment) {
  if (!attachment || typeof attachment.type !== "string") {
    return "";
  }
  if (attachment.type === "command") {
    return [
      attachment.title || ui.commandProposal,
      attachment.cmd || "",
      attachment.cwd && typeof ui.taskProposalCwd === "function"
        ? ui.taskProposalCwd(attachment.cwd)
        : "",
      attachment.reason || ""
    ].filter(Boolean).join("\n");
  }
  if (attachment.type === "diff") {
    const title = attachment.title || ui.diffTitle?.(attachment.files?.length || 0) || "";
    const files = Array.isArray(attachment.files)
      ? attachment.files.map((file) => `${file.path} (+${file.additions} -${file.deletions})`)
      : [];
    return [title, ...files].join("\n");
  }
  if (attachment.type === "git_sync_action_card") {
    return buildGitSyncSummary(attachment);
  }
  if (attachment.type === "logs") {
    return [
      attachment.title || ui.logs,
      normalizeDisplayText(attachment.text || "")
    ].filter(Boolean).join("\n");
  }
  if (attachment.type === "status") {
    return [
      attachment.title || ui.status,
      JSON.stringify(attachment.json ?? {}, null, 2)
    ].join("\n");
  }
  if (attachment.type === "error") {
    return `${attachment.code || ui.errorLabel}: ${attachment.message || ""}`.trim();
  }
  return "";
}

function appendChunk(messageId, chunk) {
  const current = messageById.get(messageId);
  if (!current) {
    return;
  }
  const next = {
    ...current,
    text: normalizeDisplayText(`${current.text || ""}${chunk}`)
  };
  messageById.set(messageId, next);
  const index = state.messages.findIndex((item) => item.id === messageId);
  if (index >= 0) {
    state.messages[index] = {
      ...state.messages[index],
      text: next.text
    };
  }
  const node = messageNodeById.get(messageId);
  if (node) {
    const textNode = node.querySelector(".msg-text");
    if (textNode) {
      renderMessageBody(textNode, next.text);
    }
    refreshCommandSummaryForMessage(messageId);
  }
  timelineDirty = true;
  scheduleVirtualRender();
}

function markStreaming(messageId, active) {
  if (active) {
    streamingMessageIds.add(messageId);
  } else {
    streamingMessageIds.delete(messageId);
  }
  const node = messageNodeById.get(messageId);
  if (!node) {
    timelineDirty = true;
    scheduleVirtualRender();
    return;
  }
  node.classList.toggle("streaming", active);
  scheduleVirtualRender();
}

function renderTaskStart(message) {
  const taskId = String(message.taskId || "");
  if (!taskId) {
    return;
  }
  const existing = taskModelById.get(taskId);
  const model = existing || {
    taskId,
    intentKind: "task",
    summary: "",
    statusKey: "planning",
    lines: [],
    streamText: "",
    proposal: undefined,
    cancelDisabled: false,
    startOrder: ++taskStartSequence
  };
  if (!Number.isFinite(model.startOrder)) {
    model.startOrder = ++taskStartSequence;
  }
  model.intentKind = message.intent?.kind || model.intentKind || "task";
  model.summary = normalizeDisplayText(message.intent?.summary || model.summary || "");
  model.statusKey = taskStateById.get(taskId) || model.statusKey || "planning";

  taskModelById.set(taskId, model);
  queuePendingTaskBinding(taskId);
  if (shouldRenderStandaloneTask(taskId)) {
    upsertTimelineItem(getTaskKey(taskId), {
      kind: "task",
      id: taskId
    });
  } else {
    removeTimelineItem(getTaskKey(taskId));
  }
  scheduleVirtualRender({ stickToBottom: isTimelineNearBottom() || !existing });
}

function appendTaskState(taskId, line) {
  const model = ensureTaskModel(taskId);
  if (!model) {
    return;
  }
  const nextLine = `[${new Date().toLocaleTimeString()}] ${line}`;
  model.lines.push(nextLine);
  const messageId = taskMessageIdByTaskId.get(String(taskId || ""));
  if (messageId) {
    refreshCommandSummaryForMessage(messageId);
  }
  timelineDirty = true;
  scheduleVirtualRender({ stickToBottom: isTimelineNearBottom() });
}

function appendTaskStream(taskId, chunk) {
  const model = ensureTaskModel(taskId);
  if (!model) {
    return;
  }
  model.streamText = normalizeDisplayText(`${model.streamText || ""}${chunk}`);
  timelineDirty = true;
  scheduleVirtualRender({ stickToBottom: isTimelineNearBottom() });
}

function setTaskProposal(taskId, result) {
  const model = ensureTaskModel(taskId);
  if (!model) {
    return;
  }
  model.proposal = normalizeTaskProposal(result);
  if (model.proposal?.summary) {
    model.summary = model.proposal.summary;
  }
  const messageId = taskMessageIdByTaskId.get(String(taskId || ""));
  if (messageId) {
    refreshCommandSummaryForMessage(messageId);
  }
  timelineDirty = true;
  scheduleVirtualRender({ stickToBottom: isTimelineNearBottom() });
}

function normalizeTaskProposal(result) {
  const proposal = result?.proposal;
  if (!proposal || typeof proposal.type !== "string") {
    return undefined;
  }

  if (proposal.type === "diff") {
    return {
      type: "diff",
      summary: normalizeDisplayText(result?.summary || ""),
      diffId: typeof proposal.diffId === "string" ? proposal.diffId : "",
      files: Array.isArray(proposal.files) ? proposal.files : [],
      unifiedDiff: normalizeDisplayText(proposal.unifiedDiff || "")
    };
  }

  if (proposal.type === "command") {
    return {
      type: "command",
      summary: normalizeDisplayText(result?.summary || ""),
      cmd: normalizeDisplayText(proposal.cmd || ""),
      cwd: typeof proposal.cwd === "string" ? proposal.cwd : "",
      reason: normalizeDisplayText(proposal.reason || "")
    };
  }

  if (proposal.type === "git_sync_plan") {
    return {
      type: "git_sync_plan",
      summary: normalizeDisplayText(result?.summary || ""),
      branch: proposal.branch || "",
      upstream: proposal.upstream || "",
      ahead: Number.isFinite(proposal.ahead) ? proposal.ahead : 0,
      behind: Number.isFinite(proposal.behind) ? proposal.behind : 0,
      staged: Number.isFinite(proposal.staged) ? proposal.staged : 0,
      unstaged: Number.isFinite(proposal.unstaged) ? proposal.unstaged : 0,
      untracked: Number.isFinite(proposal.untracked) ? proposal.untracked : 0,
      actions: Array.isArray(proposal.actions) ? proposal.actions : [],
      notes: Array.isArray(proposal.notes) ? proposal.notes : []
    };
  }

  if (proposal.type === "search_results") {
    return {
      type: "search_results",
      summary: normalizeDisplayText(result?.summary || ""),
      items: Array.isArray(proposal.items) ? proposal.items : []
    };
  }

  return {
    type: proposal.type,
    summary: normalizeDisplayText(result?.summary || result?.details || "")
  };
}

function ensureTaskModel(taskId) {
  const id = String(taskId || "");
  if (!id) {
    return undefined;
  }
  let model = taskModelById.get(id);
  if (model) {
    return model;
  }
  model = {
    taskId: id,
    intentKind: "task",
    summary: "",
    statusKey: taskStateById.get(id) || "planning",
    lines: [],
    streamText: "",
    proposal: undefined,
    cancelDisabled: false,
    startOrder: ++taskStartSequence
  };
  taskModelById.set(id, model);
  if (shouldRenderStandaloneTask(id)) {
    upsertTimelineItem(getTaskKey(id), {
      kind: "task",
      id
    });
  }
  return model;
}

function createTaskNode(model, options = {}) {
  const embedded = Boolean(options.embedded);
  const node = document.createElement("article");
  node.className = `task-card${embedded ? " task-card-embedded" : ""}`;
  node.dataset.taskId = model.taskId;
  node.dataset.taskStatus = model.statusKey;

  const header = document.createElement("div");
  header.className = "task-header";

  const headerText = document.createElement("div");
  headerText.className = "task-header-text";

  const shortTaskId = String(model.taskId || "").slice(0, 8);
  const intentLabel = localizeIntent(model.intentKind || "task");

  const title = document.createElement("div");
  title.className = "task-title";
  title.textContent = ui.taskHeader(shortTaskId, intentLabel);
  headerText.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.className = "task-subtitle";
  subtitle.textContent = model.summary || "";
  headerText.appendChild(subtitle);
  header.appendChild(headerText);

  const status = document.createElement("div");
  status.className = "task-status";
  status.dataset.status = model.statusKey || "planning";
  status.textContent = ui.stageLabels[model.statusKey] || model.statusKey || "planning";
  header.appendChild(status);
  node.appendChild(header);

  const actions = document.createElement("div");
  actions.className = "task-actions";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "mini-copy-btn";
  copyBtn.textContent = ui.genericCopy;
  copyBtn.title = ui.copyTaskCard;
  copyBtn.setAttribute("aria-label", ui.copyTaskCard);
  copyBtn.addEventListener("click", () => {
    const current = taskModelById.get(model.taskId) || model;
    post({
      type: "copy_to_clipboard",
      text: buildTaskCopyText(current)
    });
  });
  actions.appendChild(copyBtn);

  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.textContent = ui.retryTask;
  retryBtn.dataset.action = "retry-task";
  retryBtn.addEventListener("click", () => {
    post({
      type: "retry_task",
      threadId: state.threadId,
      taskId: model.taskId
    });
  });
  actions.appendChild(retryBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = ui.cancelTask;
  cancelBtn.dataset.action = "cancel-task";
  cancelBtn.disabled = Boolean(model.cancelDisabled);
  cancelBtn.addEventListener("click", () => {
    post({
      type: "cancel_task",
      threadId: state.threadId,
      taskId: model.taskId
    });
  });
  actions.appendChild(cancelBtn);
  node.appendChild(actions);

  const proposalNode = createTaskProposalNode(model);
  if (proposalNode) {
    node.appendChild(proposalNode);
  }

  const lines = document.createElement("pre");
  lines.className = `task-lines${model.lines.length > 0 ? "" : " is-empty"}`;
  lines.textContent = model.lines.join("\n");
  node.appendChild(lines);

  const stream = document.createElement("pre");
  stream.className = `task-stream${model.streamText ? "" : " is-empty"}`;
  stream.textContent = model.streamText || "";
  node.appendChild(stream);

  return node;
}

function createTaskProposalNode(model) {
  const proposal = model?.proposal;
  if (!proposal || typeof proposal.type !== "string") {
    return undefined;
  }

  const node = document.createElement("section");
  node.className = "task-proposal";
  node.dataset.proposalType = proposal.type;

  const title = document.createElement("div");
  title.className = "task-proposal-title";
  title.textContent = `${ui.taskProposalTitle}: ${formatProposalType(proposal.type)}`;
  node.appendChild(title);

  const body = document.createElement("div");
  body.className = "task-proposal-body";
  if (proposal.summary) {
    const summary = document.createElement("div");
    summary.className = "task-proposal-summary";
    summary.textContent = proposal.summary;
    body.appendChild(summary);
  }

  const actions = document.createElement("div");
  actions.className = "task-proposal-actions";
  let hasActions = false;
  const terminal = isTerminalTaskStatusKey(model.statusKey);

  if (proposal.type === "diff") {
    const fileCount = Array.isArray(proposal.files) ? proposal.files.length : 0;
    if (fileCount > 0) {
      const meta = document.createElement("div");
      meta.className = "task-proposal-meta";
      meta.textContent = typeof ui.taskProposalFiles === "function"
        ? ui.taskProposalFiles(fileCount)
        : "";
      body.appendChild(meta);

      const fileList = document.createElement("ul");
      fileList.className = "task-proposal-list";
      for (const file of proposal.files.slice(0, 10)) {
        const item = document.createElement("li");
        item.textContent = `${file.path} (+${file.additions} -${file.deletions})`;
        fileList.appendChild(item);
      }
      body.appendChild(fileList);
    }

    if (proposal.diffId) {
      const viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.dataset.proposalAction = "view_diff";
      viewBtn.textContent = ui.viewDiff;
      viewBtn.addEventListener("click", () => {
        post({
          type: "view_diff",
          threadId: state.threadId,
          diffId: proposal.diffId
        });
      });
      actions.appendChild(viewBtn);
      hasActions = true;

      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.dataset.proposalAction = "apply_diff";
      applyBtn.textContent = ui.applyDiff;
      applyBtn.disabled = terminal;
      applyBtn.addEventListener("click", () => {
        post({
          type: "apply_diff",
          threadId: state.threadId,
          diffId: proposal.diffId
        });
      });
      actions.appendChild(applyBtn);
      hasActions = true;
    } else if (proposal.unifiedDiff) {
      const pre = document.createElement("pre");
      pre.className = "task-proposal-pre";
      pre.textContent = proposal.unifiedDiff;
      body.appendChild(pre);
    }
  } else if (proposal.type === "command") {
    const cmd = document.createElement("pre");
    cmd.className = "task-proposal-pre";
    cmd.textContent = proposal.cmd || "";
    body.appendChild(cmd);
    if (proposal.cwd) {
      const cwd = document.createElement("div");
      cwd.className = "task-proposal-meta";
      cwd.textContent = typeof ui.taskProposalCwd === "function"
        ? ui.taskProposalCwd(proposal.cwd)
        : "";
      body.appendChild(cwd);
    }
    if (proposal.reason) {
      const reason = document.createElement("div");
      reason.className = "task-proposal-meta";
      reason.textContent = proposal.reason;
      body.appendChild(reason);
    }
    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.dataset.proposalAction = "run_command";
    runBtn.textContent = ui.runCommand;
    runBtn.disabled = terminal;
    runBtn.addEventListener("click", () => {
      post({
        type: "run_command",
        threadId: state.threadId,
        cmd: proposal.cmd,
        cwd: proposal.cwd || undefined
      });
    });
    actions.appendChild(runBtn);
    hasActions = true;
  } else if (proposal.type === "git_sync_plan") {
    const summaryLines = [
      formatGitSyncBranchUpstreamLine(
        proposal.branch,
        proposal.upstream,
        proposal.ahead,
        proposal.behind
      ),
      formatGitSyncChangesLine(proposal.staged, proposal.unstaged, proposal.untracked)
    ];
    const summary = document.createElement("div");
    summary.className = "task-proposal-meta";
    summary.textContent = summaryLines.join("\n");
    body.appendChild(summary);

    if (Array.isArray(proposal.actions) && proposal.actions.length > 0) {
      const steps = document.createElement("ul");
      steps.className = "task-proposal-list";
      for (const action of proposal.actions) {
        const item = document.createElement("li");
        item.textContent = action?.cmd || "";
        steps.appendChild(item);
      }
      body.appendChild(steps);
    }

    if (Array.isArray(proposal.notes) && proposal.notes.length > 0) {
      const notesTitle = document.createElement("div");
      notesTitle.className = "task-proposal-meta";
      notesTitle.textContent = ui.taskProposalNotesTitle;
      body.appendChild(notesTitle);
      const notesList = document.createElement("ul");
      notesList.className = "task-proposal-list";
      for (const note of proposal.notes) {
        const item = document.createElement("li");
        item.textContent = note;
        notesList.appendChild(item);
      }
      body.appendChild(notesList);
    }

    const hint = document.createElement("div");
    hint.className = "task-proposal-meta";
    hint.textContent = ui.taskProposalGitSyncHint;
    body.appendChild(hint);
  } else if (proposal.type === "search_results") {
    if (Array.isArray(proposal.items) && proposal.items.length > 0) {
      const titleRow = document.createElement("div");
      titleRow.className = "task-proposal-meta";
      titleRow.textContent = ui.taskProposalSearchTitle;
      body.appendChild(titleRow);
      const list = document.createElement("ul");
      list.className = "task-proposal-list";
      for (const item of proposal.items.slice(0, 12)) {
        const li = document.createElement("li");
        li.textContent = item.preview ? `${item.path} - ${item.preview}` : item.path;
        list.appendChild(li);
      }
      body.appendChild(list);
    }
  }

  node.appendChild(body);
  if (hasActions) {
    node.appendChild(actions);
  }
  return node;
}

function buildTaskCopyText(model) {
  if (!model) {
    return "";
  }
  const shortTaskId = String(model.taskId || "").slice(0, 8);
  const intentLabel = localizeIntent(model.intentKind || "task");
  const lines = [
    (typeof ui.taskHeader === "function" ? ui.taskHeader(shortTaskId, intentLabel) : ""),
    `${ui.status}: ${ui.stageLabels?.[model.statusKey] || model.statusKey || "planning"}`,
    normalizeDisplayText(model.summary || "")
  ].filter(Boolean);

  if (model.proposal) {
    lines.push(buildTaskProposalCopyText(model.proposal));
  }
  if (Array.isArray(model.lines) && model.lines.length > 0) {
    lines.push(model.lines.join("\n"));
  }
  if (model.streamText) {
    lines.push(model.streamText);
  }
  return lines.filter(Boolean).join("\n\n").trim();
}

function buildTaskProposalCopyText(proposal) {
  if (!proposal || typeof proposal.type !== "string") {
    return "";
  }
  const lines = [
    `${ui.taskProposalTitle}: ${formatProposalType(proposal.type)}`
  ];
  if (proposal.summary) {
    lines.push(proposal.summary);
  }
  if (proposal.type === "diff") {
    if (Array.isArray(proposal.files) && proposal.files.length > 0) {
      lines.push(...proposal.files.map((file) => `${file.path} (+${file.additions} -${file.deletions})`));
    } else if (proposal.unifiedDiff) {
      lines.push(proposal.unifiedDiff);
    }
    if (proposal.diffId) {
      lines.push(typeof ui.taskProposalDiffId === "function" ? ui.taskProposalDiffId(proposal.diffId) : proposal.diffId);
    }
  } else if (proposal.type === "command") {
    lines.push(proposal.cmd || "");
    if (proposal.cwd) {
      lines.push(typeof ui.taskProposalCwd === "function" ? ui.taskProposalCwd(proposal.cwd) : proposal.cwd);
    }
    if (proposal.reason) {
      lines.push(proposal.reason);
    }
  } else if (proposal.type === "git_sync_plan") {
    lines.push(
      formatGitSyncBranchUpstreamLine(
        proposal.branch,
        proposal.upstream,
        proposal.ahead,
        proposal.behind
      ),
      formatGitSyncChangesLine(proposal.staged, proposal.unstaged, proposal.untracked)
    );
    if (Array.isArray(proposal.actions) && proposal.actions.length > 0) {
      lines.push(...proposal.actions.map((action) => action?.cmd || ""));
    }
  } else if (proposal.type === "search_results") {
    if (Array.isArray(proposal.items)) {
      lines.push(...proposal.items.map((item) => item.preview ? `${item.path} - ${item.preview}` : item.path));
    }
  }
  return lines.filter(Boolean).join("\n");
}

function isTerminalTaskStatusKey(statusKey) {
  return statusKey === "completed" || statusKey === "failed";
}

function markTaskCompleted(taskId) {
  const model = ensureTaskModel(taskId);
  if (!model) {
    refreshGitSyncCardsForTask(taskId);
    return;
  }
  model.cancelDisabled = true;
  timelineDirty = true;
  scheduleVirtualRender();
  refreshGitSyncCardsForTask(taskId);
}

function getPendingWaitCount() {
  return pendingAssistantPlaceholders + waitingAssistantMessageIds.size;
}

function ensureWaitNoticeScheduled() {
  if (waitNoticeVisible || waitNoticeTimerId || getPendingWaitCount() <= 0) {
    return;
  }
  waitNoticeTimerId = setTimeout(() => {
    waitNoticeTimerId = 0;
    if (getPendingWaitCount() <= 0) {
      return;
    }
    waitNoticeVisible = true;
    renderWaitIndicator();
  }, WAIT_NOTICE_DELAY_MS);
}

function hideWaitNotice() {
  if (waitNoticeTimerId) {
    clearTimeout(waitNoticeTimerId);
    waitNoticeTimerId = 0;
  }
  if (!waitNoticeVisible) {
    return;
  }
  waitNoticeVisible = false;
  renderWaitIndicator();
}

function registerAssistantPlaceholder(message) {
  if (!message || message.role !== "assistant" || pendingAssistantPlaceholders <= 0) {
    return;
  }
  pendingAssistantPlaceholders = Math.max(0, pendingAssistantPlaceholders - 1);
  if (message.id) {
    waitingAssistantMessageIds.add(String(message.id));
  }
  ensureWaitNoticeScheduled();
}

function resolveWaitForMessage(messageId) {
  if (typeof messageId !== "string" || !waitingAssistantMessageIds.delete(messageId)) {
    return;
  }
  if (getPendingWaitCount() <= 0) {
    hideWaitNotice();
  }
}

function resetWaitNoticeTracking() {
  pendingAssistantPlaceholders = 0;
  waitingAssistantMessageIds.clear();
  hideWaitNotice();
}

function renderWaitIndicator() {
  if (!elements.waitIndicator) {
    return;
  }
  const lines = [];
  if (waitNoticeVisible) {
    lines.push(ui.waitNotice);
  }
  if (outboundMessageQueue.length > 0) {
    lines.push(formatQueueNotice(outboundMessageQueue.length));
  }
  elements.waitIndicator.textContent = lines.join("\n");
  elements.waitIndicator.classList.toggle("hidden", lines.length <= 0);
}

function formatQueueNotice(count) {
  if (typeof ui.queueNotice === "function") {
    return ui.queueNotice(count);
  }
  if (typeof ui.queueNotice === "string" && ui.queueNotice.trim()) {
    return ui.queueNotice;
  }
  return `${count}`;
}

function showToast(level, message) {
  elements.toast.textContent = message;
  elements.toast.className = `toast ${level}`;
  clearTimeout(showToast.timerId);
  showToast.timerId = setTimeout(() => {
    elements.toast.className = "toast hidden";
    elements.toast.textContent = "";
  }, 2500);
}
showToast.timerId = 0;

function post(payload) {
  vscode.postMessage(payload);
}

function buildContextRequest() {
  const files = String(elements.filesInput.value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
  return {
    includeActiveFile: Boolean(elements.includeActiveFile.checked),
    includeSelection: Boolean(elements.includeSelection.checked),
    includeWorkspaceSummary: Boolean(elements.includeWorkspaceSummary.checked),
    files
  };
}

function applyContextFromState() {
  const context = state.context || {};
  elements.includeActiveFile.checked = context.includeActiveFile !== false;
  elements.includeSelection.checked = Boolean(context.includeSelection);
  elements.includeWorkspaceSummary.checked = context.includeWorkspaceSummary !== false;
  elements.filesInput.value = Array.isArray(context.files) ? context.files.join(", ") : "";
}

function resolveMessageAuthor(message) {
  if (message.role === "remote") {
    return `${message.author || ui.authorRemote} (${ui.authorRemoteSuffix})`;
  }
  if (message.role === "user") {
    return ui.authorYou;
  }
  if (message.role === "assistant") {
    return ui.authorAssistant;
  }
  if (message.role === "tool") {
    return ui.authorTool;
  }
  if (message.role === "system") {
    return ui.authorSystem;
  }
  return message.author || `${ui.fallbackRolePrefix}: ${message.role}`;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "";
  }
  return date.toLocaleTimeString();
}

function localizeIntent(kind) {
  return ui.intentLabels[kind] || kind;
}

function formatProposalType(type) {
  return ui.proposalTypeLabels[type] || type || ui.unknownLabel;
}

function formatTaskEndStatus(status) {
  return ui.endStatusLabels[status] || status || ui.unknownLabel;
}

function formatTaskStateLine(stateValue, message) {
  const label = ui.taskStateLabels[stateValue] || stateValue;
  return message ? `${label} - ${message}` : label;
}

function mapTaskStateToConversationStatus(taskState) {
  switch (taskState) {
    case "RECEIVED":
    case "ROUTED":
    case "CONTEXT_COLLECTED":
    case "PROPOSING":
      return "planning";
    case "PROPOSAL_READY":
      return "proposalReady";
    case "WAITING_APPROVAL":
      return "waitingApproval";
    case "EXECUTING":
      return "executing";
    case "VERIFYING":
      return "verifying";
    case "COMPLETED":
      return "completed";
    case "FAILED":
    case "REJECTED":
      return "failed";
    default:
      return undefined;
  }
}

function mapTaskEndToConversationStatus(endStatus) {
  return endStatus === "ok" ? "completed" : "failed";
}

function isTerminalTaskState(taskState) {
  return taskState === "COMPLETED" || taskState === "FAILED" || taskState === "REJECTED";
}

function shouldSendOnEnter(event) {
  if (event.isComposing || isInputComposing) {
    return false;
  }
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }
  return event.key === "Enter"
    || event.code === "Enter"
    || event.code === "NumpadEnter"
    || event.keyCode === 13
    || event.which === 13;
}

function normalizeDisplayText(value) {
  const raw = typeof value === "string" ? value : "";
  if (!raw) {
    return "";
  }
  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u2028|\u2029/g, "\n");
  if (normalized.includes("\n")) {
    return normalized;
  }
  if (!/\\r\\n|\\r|\\n/.test(normalized)) {
    return normalized;
  }
  return normalized
    .replace(/\\r\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\n/g, "\n");
}

function resolveLocale() {
  const fromHtml = normalizeLocaleCandidate(document.documentElement.lang);
  if (fromHtml === "zh-CN") {
    return fromHtml;
  }
  const fromNavigator = normalizeLocaleCandidate(String(navigator.language || ""));
  if (fromNavigator) {
    return fromNavigator;
  }
  const fromLangList = Array.isArray(navigator.languages)
    ? navigator.languages.map((item) => normalizeLocaleCandidate(item)).find(Boolean)
    : undefined;
  if (fromLangList) {
    return fromLangList;
  }
  return fromHtml || "zh-CN";
}

function normalizeLocaleCandidate(raw) {
  if (!raw) {
    return undefined;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized || normalized.includes("{{")) {
    return undefined;
  }
  if (normalized.startsWith("zh")) {
    return "zh-CN";
  }
  if (normalized.startsWith("en")) {
    return "en";
  }
  return undefined;
}



