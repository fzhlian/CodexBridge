import * as vscode from "vscode";
import path from "node:path";
import { RelayAgent } from "./agent.js";
import type { RuntimeContextSnapshot } from "./context.js";
import type { CommandEnvelope } from "@codexbridge/shared";

let runningAgent: RelayAgent | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("CodexBridge");
  context.subscriptions.push(output);

  const start = vscode.commands.registerCommand("codexbridge.startAgent", () => {
    if (runningAgent) {
      vscode.window.showInformationMessage("CodexBridge agent is already running.");
      return;
    }

    const config = vscode.workspace.getConfiguration("codexbridge");
    const relayUrl = config.get<string>("relayUrl") ?? "ws://127.0.0.1:8787/agent";
    const machineId = config.get<string>("machineId") ?? `${process.env.COMPUTERNAME ?? "local-machine"}`;
    const reconnectMs = config.get<number>("reconnectMs") ?? 3000;
    const heartbeatMs = config.get<number>("heartbeatMs") ?? 10000;

    runningAgent = new RelayAgent({
      relayUrl,
      machineId,
      reconnectMs,
      heartbeatMs,
      version: context.extension.packageJSON.version,
      contextProvider: () => collectRuntimeContext(),
      confirmationProvider: (command, question) => confirmInVscode(command, question)
    });
    runningAgent.start();
    output.appendLine(`agent started: relayUrl=${relayUrl} machineId=${machineId}`);
    vscode.window.showInformationMessage("CodexBridge agent started.");
  });

  const stop = vscode.commands.registerCommand("codexbridge.stopAgent", () => {
    if (!runningAgent) {
      vscode.window.showInformationMessage("CodexBridge agent is not running.");
      return;
    }
    runningAgent.stop();
    runningAgent = undefined;
    output.appendLine("agent stopped");
    vscode.window.showInformationMessage("CodexBridge agent stopped.");
  });

  const status = vscode.commands.registerCommand("codexbridge.agentStatus", () => {
    const state = runningAgent ? "running" : "stopped";
    vscode.window.showInformationMessage(`CodexBridge agent status: ${state}`);
  });

  context.subscriptions.push(start, stop, status);

  const autostart = vscode.workspace
    .getConfiguration("codexbridge")
    .get<boolean>("autostart", false);
  if (autostart) {
    void vscode.commands.executeCommand("codexbridge.startAgent");
  }
}

export function deactivate(): void {
  if (runningAgent) {
    runningAgent.stop();
    runningAgent = undefined;
  }
}

function collectRuntimeContext(): RuntimeContextSnapshot | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const doc = editor.document;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
  const maxFileChars = Number(
    vscode.workspace.getConfiguration("codexbridge").get<number>("contextMaxFileChars", 12000)
  );
  const maxSelectionChars = Number(
    vscode.workspace.getConfiguration("codexbridge").get<number>("contextMaxSelectionChars", 6000)
  );

  let activeFilePath: string | undefined;
  if (workspaceFolder) {
    const root = workspaceFolder.uri.fsPath;
    const rel = path.relative(root, doc.uri.fsPath).replaceAll("\\", "/");
    if (rel && !rel.startsWith("..")) {
      activeFilePath = rel;
    }
  }

  const selectedText = editor.selection.isEmpty
    ? undefined
    : doc.getText(editor.selection).slice(0, maxSelectionChars);

  return {
    activeFilePath,
    activeFileContent: doc.getText().slice(0, maxFileChars),
    selectedText,
    languageId: doc.languageId
  };
}

async function confirmInVscode(
  command: CommandEnvelope,
  question: string
): Promise<boolean> {
  const yes = "Approve";
  const no = "Reject";
  const choice = await vscode.window.showWarningMessage(
    `[${command.kind}] ${question}`,
    { modal: true },
    yes,
    no
  );
  return choice === yes;
}
