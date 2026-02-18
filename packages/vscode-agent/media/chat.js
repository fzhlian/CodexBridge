const vscode = acquireVsCodeApi();

const state = {
  threadId: "default",
  messages: [],
  context: {}
};

const elements = {
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  sendBtn: document.getElementById("send-btn"),
  clearBtn: document.getElementById("clear-btn"),
  runTestBtn: document.getElementById("run-test-btn"),
  toast: document.getElementById("toast"),
  includeActiveFile: document.getElementById("ctx-active-file"),
  includeSelection: document.getElementById("ctx-selection"),
  includeWorkspaceSummary: document.getElementById("ctx-workspace-summary"),
  filesInput: document.getElementById("ctx-files")
};

const messageNodeById = new Map();

elements.sendBtn.addEventListener("click", () => {
  sendCurrentMessage();
});

elements.input.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    sendCurrentMessage();
  }
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
  const message = event.data;
  handleExtMessage(message);
});

post({ type: "ui_ready", version: 1 });
post({ type: "request_state", threadId: state.threadId });

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
  header.textContent = `${message.author || message.role} · ${formatTime(message.createdAt)}`;
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
      title.textContent = attachment.title || `Diff (${attachment.files?.length || 0} files)`;
      item.appendChild(title);

      const actions = document.createElement("div");
      actions.className = "inline-actions";

      const viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.textContent = "View Diff";
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
      applyBtn.textContent = "Apply Diff";
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
      summary.textContent = attachment.title || "Logs";
      item.appendChild(summary);
      const pre = document.createElement("pre");
      pre.textContent = attachment.text || "";
      item.appendChild(pre);
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
      summary.textContent = attachment.title || "Status";
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

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "";
  }
  return date.toLocaleTimeString();
}
