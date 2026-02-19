const vscode = acquireVsCodeApi();

const STATUS_ORDER = [
  "planning",
  "proposalReady",
  "waitingApproval",
  "executing",
  "completed",
  "failed"
];

const UI_STRINGS = {
  "zh-CN": {
    appTitle: "CodexBridge 聊天",
    runTest: "运行测试",
    clear: "清空",
    send: "发送",
    inputPlaceholder: "输入消息，支持 /plan /patch /test",
    inputHint: "回车发送，Shift+回车换行",
    contextActiveFile: "当前文件",
    contextSelection: "选中内容",
    contextWorkspaceSummary: "工作区摘要",
    contextFilesPlaceholder: "附加文件（逗号分隔）",
    conversationStatusTitle: "对话状态",
    conversationStatusCurrent: (label) => `当前状态：${label}`,
    stageLabels: {
      planning: "🟡规划中",
      proposalReady: "🟢 已生成方案",
      waitingApproval: "🔵 等待确认",
      executing: "⚙ 执行中",
      completed: "✅ 已完成",
      failed: "❌ 失败"
    },
    diffTitle: (count) => `Diff（${count} 个文件）`,
    viewDiff: "查看 Diff",
    applyDiff: "应用 Diff",
    logs: "日志",
    commandProposal: "命令方案",
    runCommand: "运行命令",
    status: "状态",
    retryTask: "重试任务",
    cancelTask: "取消任务",
    taskHeader: (shortTaskId, intent) => `任务 ${shortTaskId} · ${intent}`,
    taskProposalLine: (type) => `方案：${type}`,
    taskEndLine: (status) => `结束：${status}`,
    taskStateLabels: {
      RECEIVED: "已接收",
      ROUTED: "已路由",
      CONTEXT_COLLECTED: "上下文已收集",
      PROPOSING: "规划中",
      PROPOSAL_READY: "已生成方案",
      WAITING_APPROVAL: "等待确认",
      EXECUTING: "执行中",
      COMPLETED: "已完成",
      FAILED: "失败",
      REJECTED: "已拒绝"
    },
    proposalTypeLabels: {
      plan: "计划",
      diff: "diff",
      command: "命令",
      answer: "回答",
      search_results: "搜索结果"
    },
    endStatusLabels: {
      ok: "成功",
      error: "失败",
      rejected: "拒绝"
    },
    intentLabels: {
      help: "帮助",
      status: "状态",
      explain: "解释",
      change: "修改",
      run: "执行",
      diagnose: "诊断",
      search: "搜索",
      review: "审查",
      task: "任务"
    },
    authorYou: "你",
    authorAssistant: "助手",
    authorTool: "工具",
    authorSystem: "系统",
    authorRemoteSuffix: "企业微信",
    fallbackRolePrefix: "角色"
  },
  en: {
    appTitle: "CodexBridge Chat",
    runTest: "Run Test",
    clear: "Clear",
    send: "Send",
    inputPlaceholder: "Message, or /plan /patch /test",
    inputHint: "Enter to send, Shift+Enter for newline",
    contextActiveFile: "Active File",
    contextSelection: "Selection",
    contextWorkspaceSummary: "Workspace Summary",
    contextFilesPlaceholder: "extra files (comma separated)",
    conversationStatusTitle: "Conversation Status",
    conversationStatusCurrent: (label) => `Current: ${label}`,
    stageLabels: {
      planning: "🟡 Planning",
      proposalReady: "🟢 Proposal Ready",
      waitingApproval: "🔵 Waiting Approval",
      executing: "⚙ Executing",
      completed: "✅ Completed",
      failed: "❌ Failed"
    },
    diffTitle: (count) => `Diff (${count} files)`,
    viewDiff: "View Diff",
    applyDiff: "Apply Diff",
    logs: "Logs",
    commandProposal: "Command Proposal",
    runCommand: "Run Command",
    status: "Status",
    retryTask: "Retry Task",
    cancelTask: "Cancel Task",
    taskHeader: (shortTaskId, intent) => `Task ${shortTaskId} · ${intent}`,
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
  sendBtn: document.getElementById("send-btn"),
  clearBtn: document.getElementById("clear-btn"),
  runTestBtn: document.getElementById("run-test-btn"),
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

let currentConversationStatus = "planning";
let isInputComposing = false;

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

elements.runTestBtn.addEventListener("click", () => {
  post({
    type: "run_test",
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
  elements.runTestBtn.textContent = ui.runTest;
  elements.clearBtn.textContent = ui.clear;
  elements.sendBtn.textContent = ui.send;
  elements.input.placeholder = ui.inputPlaceholder;
  elements.composerHint.textContent = ui.inputHint;
  elements.activeFileLabel.textContent = ui.contextActiveFile;
  elements.selectionLabel.textContent = ui.contextSelection;
  elements.workspaceSummaryLabel.textContent = ui.contextWorkspaceSummary;
  elements.filesInput.placeholder = ui.contextFilesPlaceholder;
  elements.statusTitle.textContent = ui.conversationStatusTitle;
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
    return;
  }
  if (message.type === "stream_start") {
    markStreaming(message.messageId, true);
    return;
  }
  if (message.type === "stream_chunk") {
    appendChunk(message.messageId, String(message.chunk || ""));
    return;
  }
  if (message.type === "stream_end") {
    markStreaming(message.messageId, false);
    return;
  }
  if (message.type === "task_start") {
    if (message.threadId !== state.threadId) {
      return;
    }
    renderTaskStart(message);
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
    updateConversationStatus("proposalReady");
    return;
  }
  if (message.type === "task_end") {
    if (message.threadId !== state.threadId) {
      return;
    }
    appendTaskState(message.taskId, ui.taskEndLine(formatTaskEndStatus(message.status)));
    markTaskCompleted(message.taskId, message.status);
    updateConversationStatus(mapTaskEndToConversationStatus(message.status));
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
    textNode.textContent = message.text || "";
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
  header.textContent = `${resolveMessageAuthor(message)} · ${formatTime(message.createdAt)}`;
  node.appendChild(header);

  const text = document.createElement("div");
  text.className = "msg-text";
  text.textContent = message.text || "";
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

function appendChunk(messageId, chunk) {
  const node = messageNodeById.get(messageId);
  if (!node) {
    return;
  }
  const textNode = node.querySelector(".msg-text");
  if (!textNode) {
    return;
  }
  textNode.textContent = (textNode.textContent || "") + chunk;
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
  text.textContent = message.intent?.summary || "";
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
  stream.textContent = (stream.textContent || "") + chunk;
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
    return;
  }
  const cancelBtn = node.querySelector('button[data-action="cancel-task"]');
  if (cancelBtn) {
    cancelBtn.disabled = true;
  }
  if (status) {
    node.dataset.taskStatus = status;
  }
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
  if (event.defaultPrevented || event.isComposing || isInputComposing) {
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

function resolveLocale() {
  const fromHtml = normalizeLocaleCandidate(document.documentElement.lang);
  if (fromHtml) {
    return fromHtml;
  }
  return normalizeLocaleCandidate(String(navigator.language || "en")) || "en";
}

function normalizeLocaleCandidate(raw) {
  if (!raw) {
    return undefined;
  }
  return String(raw).toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
