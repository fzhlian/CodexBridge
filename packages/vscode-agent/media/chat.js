const vscode = acquireVsCodeApi();

const STATUS_ORDER = [
  "planning",
  "proposalReady",
  "waitingApproval",
  "executing",
  "completed",
  "failed"
];
const WAIT_NOTICE_DELAY_MS = 350;

const UI_STRINGS = {
  "zh-CN": {
    appTitle: "CodexBridge \u804a\u5929",
    clear: "\u6e05\u7a7a",
    send: "\u53d1\u9001",
    inputPlaceholder: "\u8f93\u5165\u6d88\u606f\uff0c\u652f\u6301 /plan /patch /test",
    inputHint: "Enter \u53d1\u9001\uff0cShift+Enter \u6362\u884c",
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
      completed: "\u5df2\u5b8c\u6210",
      failed: "\u5931\u8d25"
    },
    diffTitle: (count) => `Diff\uff08${count} \u4e2a\u6587\u4ef6\uff09`,
    viewDiff: "\u67e5\u770b Diff",
    applyDiff: "\u5e94\u7528 Diff",
    logs: "\u65e5\u5fd7",
    commandProposal: "\u547d\u4ee4\u65b9\u6848",
    runCommand: "\u8fd0\u884c\u547d\u4ee4",
    status: "\u72b6\u6001",
    gitSyncTitle: "Git Sync",
    gitSyncChanges: "\u53d8\u66f4",
    gitSyncCommitMessage: "\u5efa\u8bae commit message",
    gitSyncSteps: "\u8ba1\u5212\u6b65\u9aa4",
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
    statusValues: {
      pending: "pending",
      completed: "completed",
      failed: "failed",
      skipped: "skipped"
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
      COMPLETED: "\u5df2\u5b8c\u6210",
      FAILED: "\u5931\u8d25",
      REJECTED: "\u5df2\u62d2\u7edd"
    },
    proposalTypeLabels: {
      plan: "\u8ba1\u5212",
      diff: "diff",
      command: "\u547d\u4ee4",
      git_sync_plan: "Git Sync",
      answer: "\u56de\u7b54",
      search_results: "\u641c\u7d22\u7ed3\u679c"
    },
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
    authorRemoteSuffix: "\u4f01\u4e1a\u5fae\u4fe1",
    fallbackRolePrefix: "\u89d2\u8272"
  },
  en: {
    appTitle: "CodexBridge Chat",
    clear: "Clear",
    send: "Send",
    inputPlaceholder: "Message, or /plan /patch /test",
    inputHint: "Enter to send, Shift+Enter for newline",
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
      completed: "Completed",
      failed: "Failed"
    },
    diffTitle: (count) => `Diff (${count} files)`,
    viewDiff: "View Diff",
    applyDiff: "Apply Diff",
    logs: "Logs",
    commandProposal: "Command Proposal",
    runCommand: "Run Command",
    status: "Status",
    gitSyncTitle: "Git Sync",
    gitSyncChanges: "Changes",
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
    authorRemoteSuffix: "WeCom",
    fallbackRolePrefix: "Role"
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
  statusTitle: document.getElementById("conversation-status-title"),
  statusCurrent: document.getElementById("conversation-status-current"),
  statusTrack: document.getElementById("conversation-status-track"),
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  composerHint: document.getElementById("composer-hint"),
  waitIndicator: document.getElementById("wait-indicator"),
  sendBtn: document.getElementById("send-btn"),
  clearBtn: document.getElementById("clear-btn"),
  toast: document.getElementById("toast"),
  includeActiveFile: document.getElementById("ctx-active-file"),
  includeSelection: document.getElementById("ctx-selection"),
  includeWorkspaceSummary: document.getElementById("ctx-workspace-summary"),
  activeFileLabel: document.getElementById("ctx-active-file-label"),
  selectionLabel: document.getElementById("ctx-selection-label"),
  workspaceSummaryLabel: document.getElementById("ctx-workspace-summary-label"),
  filesInput: document.getElementById("ctx-files")
};

const messageNodeById = new Map();
const taskNodeById = new Map();
const statusChipByKey = new Map();
const taskStateById = new Map();

let currentConversationStatus = "planning";
let isInputComposing = false;
let pendingAssistantPlaceholders = 0;
const waitingAssistantMessageIds = new Set();
let waitNoticeTimerId = 0;
let waitNoticeVisible = false;

applyLocalization();
initializeConversationStatus();

elements.sendBtn.addEventListener("click", () => {
  sendCurrentMessage();
});

elements.input.addEventListener("compositionstart", () => {
  isInputComposing = true;
});

elements.input.addEventListener("compositionend", () => {
  isInputComposing = false;
});

elements.input.addEventListener("keydown", (event) => {
  if (!shouldSendOnEnter(event)) {
    return;
  }
  event.preventDefault();
  sendCurrentMessage();
});

elements.clearBtn.addEventListener("click", () => {
  post({
    type: "clear_thread",
    threadId: state.threadId
  });
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
  elements.clearBtn.textContent = ui.clear;
  elements.sendBtn.textContent = ui.send;
  elements.input.placeholder = ui.inputPlaceholder;
  elements.composerHint.textContent = ui.inputHint;
  elements.activeFileLabel.textContent = ui.contextActiveFile;
  elements.selectionLabel.textContent = ui.contextSelection;
  elements.workspaceSummaryLabel.textContent = ui.contextWorkspaceSummary;
  elements.filesInput.placeholder = ui.contextFilesPlaceholder;
  elements.statusTitle.textContent = ui.conversationStatusTitle;
  renderWaitIndicator();
}

function initializeConversationStatus() {
  elements.statusTrack.innerHTML = "";
  statusChipByKey.clear();
  for (const key of STATUS_ORDER) {
    const chip = document.createElement("div");
    chip.className = "status-chip";
    chip.dataset.statusKey = key;
    chip.textContent = ui.stageLabels[key] || key;
    elements.statusTrack.appendChild(chip);
    statusChipByKey.set(key, chip);
  }
  updateConversationStatus("planning");
}

function updateConversationStatus(statusKey) {
  if (!STATUS_ORDER.includes(statusKey)) {
    return;
  }
  currentConversationStatus = statusKey;
  const currentIndex = STATUS_ORDER.indexOf(statusKey);
  for (const [key, chip] of statusChipByKey.entries()) {
    const index = STATUS_ORDER.indexOf(key);
    chip.classList.toggle("active", index === currentIndex);
    chip.classList.toggle("done", index < currentIndex);
    chip.classList.toggle("failed", key === "failed" && statusKey === "failed");
  }
  elements.statusCurrent.textContent = ui.conversationStatusCurrent(ui.stageLabels[statusKey] || statusKey);
}

function resetConversationStatus() {
  updateConversationStatus("planning");
}

function sendCurrentMessage() {
  const text = elements.input.value.trim();
  if (!text) {
    return;
  }
  pendingAssistantPlaceholders += 1;
  ensureWaitNoticeScheduled();
  post({
    type: "send_message",
    threadId: state.threadId,
    text,
    context: buildContextRequest()
  });
  elements.input.value = "";
}

function handleExtMessage(message) {
  if (!message || typeof message.type !== "string") {
    return;
  }
  if (message.type === "state") {
    resetWaitNoticeTracking();
    state.threadId = message.threadId || "default";
    state.messages = Array.isArray(message.state?.messages) ? message.state.messages : [];
    state.context = message.state?.context || {};
    applyContextFromState();
    renderAllMessages();
    return;
  }
  if (message.type === "append_message") {
    if (message.threadId !== state.threadId) {
      return;
    }
    registerAssistantPlaceholder(message.message);
    state.messages.push(message.message);
    renderAppendedMessage(message.message);
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
    return;
  }
  if (message.type === "stream_start") {
    markStreaming(message.messageId, true);
    return;
  }
  if (message.type === "stream_chunk") {
    resolveWaitForMessage(message.messageId);
    appendChunk(message.messageId, String(message.chunk || ""));
    return;
  }
  if (message.type === "stream_end") {
    markStreaming(message.messageId, false);
    resolveWaitForMessage(message.messageId);
    return;
  }
  if (message.type === "task_start") {
    if (message.threadId !== state.threadId) {
      return;
    }
    renderTaskStart(message);
    taskStateById.set(message.taskId, "planning");
    refreshGitSyncCardsForTask(message.taskId);
    updateConversationStatus("planning");
    return;
  }
  if (message.type === "task_state") {
    if (message.threadId !== state.threadId) {
      return;
    }
    appendTaskState(message.taskId, formatTaskStateLine(message.state, message.message));
    const mapped = mapTaskStateToConversationStatus(message.state);
    if (mapped) {
      taskStateById.set(message.taskId, mapped);
      refreshGitSyncCardsForTask(message.taskId);
      updateConversationStatus(mapped);
    }
    if (isTerminalTaskState(message.state)) {
      markTaskCompleted(message.taskId);
    }
    return;
  }
  if (message.type === "task_stream_chunk") {
    if (message.threadId !== state.threadId) {
      return;
    }
    appendTaskStream(message.taskId, String(message.chunk || ""));
    return;
  }
  if (message.type === "task_proposal") {
    if (message.threadId !== state.threadId) {
      return;
    }
    appendTaskState(message.taskId, ui.taskProposalLine(formatProposalType(message.result?.proposal?.type)));
    taskStateById.set(message.taskId, "proposalReady");
    refreshGitSyncCardsForTask(message.taskId);
    updateConversationStatus("proposalReady");
    return;
  }
  if (message.type === "task_end") {
    if (message.threadId !== state.threadId) {
      return;
    }
    appendTaskState(message.taskId, ui.taskEndLine(formatTaskEndStatus(message.status)));
    markTaskCompleted(message.taskId, message.status);
    const mapped = mapTaskEndToConversationStatus(message.status);
    taskStateById.set(message.taskId, mapped);
    refreshGitSyncCardsForTask(message.taskId);
    updateConversationStatus(mapped);
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
  elements.messages.innerHTML = "";
  messageNodeById.clear();
  taskNodeById.clear();
  taskStateById.clear();
  resetConversationStatus();
  for (const message of state.messages) {
    renderAppendedMessage(message);
  }
}

function renderAppendedMessage(message) {
  const node = createMessageNode(message);
  messageNodeById.set(message.id, node);
  elements.messages.appendChild(node);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function updateRenderedMessage(message) {
  const node = messageNodeById.get(message.id);
  if (!node) {
    renderAppendedMessage(message);
    return;
  }
  const textNode = node.querySelector(".msg-text");
  if (textNode) {
    textNode.textContent = normalizeDisplayText(message.text);
  }
  const attachmentNode = node.querySelector(".attachments");
  if (attachmentNode) {
    attachmentNode.innerHTML = "";
    renderAttachments(attachmentNode, message.attachments || []);
  }
}

function createMessageNode(message) {
  const node = document.createElement("article");
  node.className = `message role-${message.role}`;
  node.dataset.messageId = message.id;

  const header = document.createElement("div");
  header.className = "msg-header";
  header.textContent = `${resolveMessageAuthor(message)} - ${formatTime(message.createdAt)}`;
  node.appendChild(header);

  const text = document.createElement("div");
  text.className = "msg-text";
  text.textContent = normalizeDisplayText(message.text);
  node.appendChild(text);

  const attachments = document.createElement("div");
  attachments.className = "attachments";
  renderAttachments(attachments, message.attachments || []);
  node.appendChild(attachments);

  return node;
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
  subtitle.textContent = `branch: ${attachment.branch || "(detached)"}  upstream: ${attachment.upstream || "(none)"}  ahead/behind: ${attachment.ahead}/${attachment.behind}`;
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
    return "(no diff stat)";
  }
  const lines = text.split("\n").slice(0, 8);
  return lines.join("\n");
}

function buildGitSyncSummary(attachment) {
  const lines = [
    `${ui.gitSyncTitle}`,
    `branch: ${attachment.branch || "(detached)"}`,
    `upstream: ${attachment.upstream || "(none)"}`,
    `ahead/behind: ${attachment.ahead}/${attachment.behind}`,
    `changes: staged=${attachment.staged} unstaged=${attachment.unstaged} untracked=${attachment.untracked}`,
    attachment.commitMessage ? `commit: ${attachment.commitMessage}` : "",
    "steps:",
    ...(attachment.steps || []).map((step) => `- ${step.cmd} [${step.status}]`)
  ].filter(Boolean);
  return lines.join("\n");
}

function appendChunk(messageId, chunk) {
  const node = messageNodeById.get(messageId);
  if (!node) {
    return;
  }
  const textNode = node.querySelector(".msg-text");
  if (!textNode) {
    return;
  }
  textNode.textContent = normalizeDisplayText((textNode.textContent || "") + chunk);
}

function markStreaming(messageId, active) {
  const node = messageNodeById.get(messageId);
  if (!node) {
    return;
  }
  if (active) {
    node.classList.add("streaming");
  } else {
    node.classList.remove("streaming");
  }
}

function renderTaskStart(message) {
  if (taskNodeById.has(message.taskId)) {
    return;
  }
  const node = document.createElement("article");
  node.className = "message role-system task-progress";
  node.dataset.taskId = message.taskId;

  const header = document.createElement("div");
  header.className = "msg-header";
  const shortTaskId = String(message.taskId || "").slice(0, 8);
  const intentLabel = localizeIntent(message.intent?.kind || "task");
  header.textContent = ui.taskHeader(shortTaskId, intentLabel);
  node.appendChild(header);

  const text = document.createElement("div");
  text.className = "msg-text";
  text.textContent = normalizeDisplayText(message.intent?.summary || "");
  node.appendChild(text);

  const actions = document.createElement("div");
  actions.className = "inline-actions";

  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.textContent = ui.retryTask;
  retryBtn.dataset.action = "retry-task";
  retryBtn.addEventListener("click", () => {
    post({
      type: "retry_task",
      threadId: state.threadId,
      taskId: message.taskId
    });
  });
  actions.appendChild(retryBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = ui.cancelTask;
  cancelBtn.dataset.action = "cancel-task";
  cancelBtn.addEventListener("click", () => {
    post({
      type: "cancel_task",
      threadId: state.threadId,
      taskId: message.taskId
    });
  });
  actions.appendChild(cancelBtn);
  node.appendChild(actions);

  const lines = document.createElement("pre");
  lines.className = "task-lines";
  lines.textContent = "";
  node.appendChild(lines);

  const stream = document.createElement("pre");
  stream.className = "task-stream";
  stream.textContent = "";
  node.appendChild(stream);

  taskNodeById.set(message.taskId, node);
  elements.messages.appendChild(node);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function appendTaskState(taskId, line) {
  const node = ensureTaskNode(taskId);
  if (!node) {
    return;
  }
  const lines = node.querySelector(".task-lines");
  if (!lines) {
    return;
  }
  const nextLine = `[${new Date().toLocaleTimeString()}] ${line}`;
  lines.textContent = lines.textContent ? `${lines.textContent}\n${nextLine}` : nextLine;
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function appendTaskStream(taskId, chunk) {
  const node = ensureTaskNode(taskId);
  if (!node) {
    return;
  }
  const stream = node.querySelector(".task-stream");
  if (!stream) {
    return;
  }
  stream.textContent = normalizeDisplayText((stream.textContent || "") + chunk);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function ensureTaskNode(taskId) {
  let node = taskNodeById.get(taskId);
  if (node) {
    return node;
  }
  renderTaskStart({
    taskId,
    intent: { kind: "task", summary: "" }
  });
  node = taskNodeById.get(taskId);
  return node;
}

function markTaskCompleted(taskId, status) {
  const node = taskNodeById.get(taskId);
  if (!node) {
    refreshGitSyncCardsForTask(taskId);
    return;
  }
  const cancelBtn = node.querySelector('button[data-action="cancel-task"]');
  if (cancelBtn) {
    cancelBtn.disabled = true;
  }
  if (status) {
    node.dataset.taskStatus = status;
  }
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
  elements.waitIndicator.textContent = waitNoticeVisible ? ui.waitNotice : "";
  elements.waitIndicator.classList.toggle("hidden", !waitNoticeVisible);
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
    return `${message.author || "WeCom"} (${ui.authorRemoteSuffix})`;
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
  return ui.proposalTypeLabels[type] || type || "unknown";
}

function formatTaskEndStatus(status) {
  return ui.endStatusLabels[status] || status || "unknown";
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

