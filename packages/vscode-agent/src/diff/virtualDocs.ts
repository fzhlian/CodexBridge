import * as vscode from "vscode";

export const CODEXBRIDGE_DIFF_SCHEME = "codexbridge";

type DiffSide = "before" | "after";

export class VirtualDiffDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly docs = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.docs.get(uri.toString()) ?? "";
  }

  setContent(uri: vscode.Uri, content: string): void {
    this.docs.set(uri.toString(), content);
    this.emitter.fire(uri);
  }

  deleteByDiffId(diffId: string): void {
    const encoded = encodeURIComponent(diffId);
    for (const key of [...this.docs.keys()]) {
      if (key.includes(`/diff/${encoded}/`)) {
        this.docs.delete(key);
      }
    }
  }

  createUri(diffId: string, side: DiffSide, filePath: string): vscode.Uri {
    const encodedDiffId = encodeURIComponent(diffId);
    const encodedPath = encodeURIComponent(normalizeFilePath(filePath));
    return vscode.Uri.parse(`${CODEXBRIDGE_DIFF_SCHEME}:/diff/${encodedDiffId}/${side}/${encodedPath}`);
  }
}

function normalizeFilePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}
