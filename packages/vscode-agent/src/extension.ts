import * as vscode from "vscode";
import { RelayAgent } from "./agent.js";

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
      version: context.extension.packageJSON.version
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

