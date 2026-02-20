--- a/chat.js
+++ b/chat.js
@@ -1,13 +1,6 @@
 const vscode = acquireVsCodeApi();
 
-const STATUS_ORDER = [
-  "planning",
-  "proposalReady",
-  "waitingApproval",
-  "executing",
-  "completed",
-  "failed"
-];
 const WAIT_NOTICE_DELAY_MS = 350;
@@
 const elements = {
   titleText: document.getElementById("title-text"),
-  statusTitle: document.getElementById("conversation-status-title"),
-  statusCurrent: document.getElementById("conversation-status-current"),
-  statusTrack: document.getElementById("conversation-status-track"),
   messages: document.getElementById("messages"),
   input: document.getElementById("input"),
   composerHint: document.getElementById("composer-hint"),
   waitIndicator: document.getElementById("wait-indicator"),
   sendBtn: document.getElementById("send-btn"),
   clearBtn: document.getElementById("clear-btn"),
-  runTestBtn: document.getElementById("run-test-btn"),
   toast: document.getElementById("toast"),
   includeActiveFile: document.getElementById("ctx-active-file"),
   includeSelection: document.getElementById("ctx-selection"),
   includeWorkspaceSummary: document.getElementById("ctx-workspace-summary"),
   filesInput: document.getElementById("ctx-files"),
   activeFileLabel: document.getElementById("ctx-active-file-label"),
   selectionLabel: document.getElementById("ctx-selection-label"),
   workspaceSummaryLabel: document.getElementById("ctx-workspace-summary-label")
 };
 
 const messageNodeById = new Map();
 const taskNodeById = new Map();
-const statusChipByKey = new Map();
-
-let currentConversationStatus = "planning";
+const taskModelById = new Map(); // taskId -> { statusKey, proposal }
 
 let isInputComposing = false;
 let pendingAssistantPlaceholders = 0;
 const waitingAssistantMessageIds = new Set();
@@
 applyLocalization();
-initializeConversationStatus();
@@
-elements.runTestBtn.addEventListener("click", () => {
-  post({
-    type: "run_test",
-    threadId: state.threadId
-  });
-});
-
 window.addEventListener("message", (event) => {
   handleExtMessage(event.data);
 });
@@
 function applyLocalization() {
   document.documentElement.lang = locale;
   document.title = ui.appTitle;
   elements.titleText.textContent = ui.appTitle;
-  elements.runTestBtn.textContent = ui.runTest;
   elements.clearBtn.textContent = ui.clear;
   elements.sendBtn.textContent = ui.send;
-  elements.input.placeholder = ui.inputPlaceholder;
+  elements.input.placeholder = "Ask CodexBridge…";
   elements.composerHint.textContent = ui.inputHint;
   elements.activeFileLabel.textContent = ui.contextActiveFile;
   elements.selectionLabel.textContent = ui.contextSelection;
   elements.workspaceSummaryLabel.textContent = ui.contextWorkspaceSummary;
   elements.filesInput.placeholder = ui.contextFilesPlaceholder;
-  elements.statusTitle.textContent = ui.conversationStatusTitle;
   renderWaitIndicator();
 }
 
-function initializeConversationStatus() {
-  elements.statusTrack.innerHTML = "";
-  statusChipByKey.clear();
-  for (const key of STATUS_ORDER) {
-    const chip = document.createElement("div");
-    chip.className = "status-chip";
-    chip.dataset.statusKey = key;
-    chip.textContent = ui.stageLabels[key] || key;
-    elements.statusTrack.appendChild(chip);
-    statusChipByKey.set(key, chip);
-  }
-  updateConversationStatus("planning");
-}
-
-function updateConversationStatus(statusKey) {
-  if (!STATUS_ORDER.includes(statusKey)) {
-    return;
-  }
-  currentConversationStatus = statusKey;
-  const currentIndex = STATUS_ORDER.indexOf(statusKey);
-  for (const [key, chip] of statusChipByKey.entries()) {
-    const index = STATUS_ORDER.indexOf(key);
-    chip.classList.toggle("active", index === currentIndex);
-    chip.classList.toggle("done", index < currentIndex);
-    chip.classList.toggle("failed", key === "failed" && statusKey === "failed");
-  }
-  elements.statusCurrent.textContent = ui.conversationStatusCurrent(ui.stageLabels[statusKey] || statusKey);
-}
-
-function resetConversationStatus() {
-  updateConversationStatus("planning");
-}
-
@@
 function renderAllMessages() {
   elements.messages.innerHTML = "";
   messageNodeById.clear();
   taskNodeById.clear();
-  resetConversationStatus();
   for (const message of state.messages) {
     renderAppendedMessage(message);
   }
   elements.messages.scrollTop = elements.messages.scrollHeight;
 }
@@
   if (message.type === "task_start") {
     if (message.threadId !== state.threadId) {
       return;
     }
-    renderTaskStart(message);
-    updateConversationStatus("planning");
+    renderTaskCard(message);
     return;
   }
   if (message.type === "task_state") {
     if (message.threadId !== state.threadId) {
       return;
     }
-    appendTaskState(message.taskId, formatTaskStateLine(message.state, message.message));
-    const mapped = mapTaskStateToConversationStatus(message.state);
-    if (mapped) {
-      updateConversationStatus(mapped);
-    }
+    updateTaskFromState(message.taskId, message.state, message.message);
     if (isTerminalTaskState(message.state)) {
       markTaskCompleted(message.taskId);
     }
     return;
   }
@@
   if (message.type === "task_proposal") {
     if (message.threadId !== state.threadId) {
       return;
     }
-    appendTaskState(message.taskId, ui.taskProposalLine(formatProposalType(message.result?.proposal?.type)));
-    updateConversationStatus("proposalReady");
+    renderTaskProposal(message.taskId, message.result);
     return;
   }
   if (message.type === "task_end") {
     if (message.threadId !== state.threadId) {
       return;
     }
-    appendTaskState(message.taskId, ui.taskEndLine(formatTaskEndStatus(message.status)));
     markTaskCompleted(message.taskId, message.status);
-    updateConversationStatus(mapTaskEndToConversationStatus(message.status));
+    finalizeTaskCard(message.taskId, message.status);
     return;
   }
@@
-function renderTaskStart(message) {
+function renderTaskCard(message) {
   if (taskNodeById.has(message.taskId)) {
     return;
   }
-  const node = document.createElement("article");
-  node.className = "message role-system task-progress";
-  node.dataset.taskId = message.taskId;
-
-  const header = document.createElement("div");
-  header.className = "msg-header";
-  const shortTaskId = String(message.taskId || "").slice(0, 8);
-  const intentLabel = localizeIntent(message.intent?.kind || "task");
-  header.textContent = ui.taskHeader(shortTaskId, intentLabel);
-  node.appendChild(header);
-
-  const text = document.createElement("div");
-  text.className = "msg-text";
-  text.textContent = normalizeDisplayText(message.intent?.summary || "");
-  node.appendChild(text);
-
-  const actions = document.createElement("div");
-  actions.className = "inline-actions";
-
-  const retryBtn = document.createElement("button");
-  retryBtn.type = "button";
-  retryBtn.textContent = ui.retryTask;
-  retryBtn.dataset.action = "retry-task";
-  retryBtn.addEventListener("click", () => {
-    post({
-      type: "retry_task",
-      threadId: state.threadId,
-      taskId: message.taskId
-    });
-  });
-  actions.appendChild(retryBtn);
-
-  const cancelBtn = document.createElement("button");
-  cancelBtn.type = "button";
-  cancelBtn.textContent = ui.cancelTask;
-  cancelBtn.dataset.action = "cancel-task";
-  cancelBtn.addEventListener("click", () => {
-    post({
-      type: "cancel_task",
-      threadId: state.threadId,
-      taskId: message.taskId
-    });
-  });
-  actions.appendChild(cancelBtn);
-  node.appendChild(actions);
-
-  const lines = document.createElement("pre");
-  lines.className = "task-lines";
-  lines.textContent = "";
-  node.appendChild(lines);
-
-  const stream = document.createElement("pre");
-  stream.className = "task-stream";
-  stream.textContent = "";
-  node.appendChild(stream);
-
-  taskNodeById.set(message.taskId, node);
-  elements.messages.appendChild(node);
+  const taskId = message.taskId;
+  const shortTaskId = String(taskId || "").slice(0, 8);
+  const intentKind = message.intent?.kind || "task";
+  const intentLabel = localizeIntent(intentKind);
+  const summary = normalizeDisplayText(message.intent?.summary || "");
+
+  taskModelById.set(taskId, { statusKey: "planning", proposal: undefined });
+
+  const card = document.createElement("article");
+  card.className = "task-card";
+  card.dataset.taskId = taskId;
+
+  const header = document.createElement("div");
+  header.className = "task-header";
+
+  const left = document.createElement("div");
+  const title = document.createElement("div");
+  title.className = "task-title";
+  title.textContent = `🔧 ${intentLabel} · ${shortTaskId}`;
+  left.appendChild(title);
+
+  const subtitle = document.createElement("div");
+  subtitle.className = "task-subtitle";
+  subtitle.textContent = summary;
+  left.appendChild(subtitle);
+
+  header.appendChild(left);
+
+  const status = document.createElement("div");
+  status.className = "task-status";
+  status.dataset.status = "planning";
+  status.textContent = `🟡 ${ui.stageLabels.planning || "Planning"}`;
+  header.appendChild(status);
+  card.appendChild(header);
+
+  const stream = document.createElement("pre");
+  stream.className = "task-stream";
+  stream.textContent = "";
+  card.appendChild(stream);
+
+  const proposal = document.createElement("div");
+  proposal.className = "task-proposal";
+  const proposalTitle = document.createElement("div");
+  proposalTitle.className = "task-proposal-title";
+  proposalTitle.textContent = "Proposal";
+  proposal.appendChild(proposalTitle);
+  const proposalBody = document.createElement("div");
+  proposalBody.className = "task-proposal-body";
+  proposalBody.textContent = "";
+  proposal.appendChild(proposalBody);
+  const proposalActions = document.createElement("div");
+  proposalActions.className = "task-actions";
+  proposal.appendChild(proposalActions);
+  card.appendChild(proposal);
+
+  const inlineActions = document.createElement("div");
+  inlineActions.className = "task-ac
