import * as vscode from "vscode";
import { NavigatorController } from "../application/NavigatorController";
import type { WebviewToExtension } from "../shared/messages";

export class NavigatorViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "aiPairNavigator.sidebar";

  private view?: vscode.WebviewView;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly viewDisposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: NavigatorController
  ) {
    this.disposables.push(
      this.controller.onDidChangeState(() => {
        void this.postViewModel();
      })
    );
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    this.clearViewDisposables();
    this.viewDisposables.push(
      webviewView.webview.onDidReceiveMessage(async (message: WebviewToExtension) => {
        switch (message.type) {
          case "ready":
            await this.postViewModel();
            return;
          case "connect":
            await this.controller.connectCopilot();
            return;
          case "createConversationStream":
            await this.controller.createConversationStream();
            return;
          case "selectConversationStream":
            await this.controller.selectConversationStream(message.id);
            return;
          case "ask":
            await this.controller.askForGuidanceWithCurrentContext(message.text);
            return;
          case "askContext":
            await this.controller.askForGuidance(undefined, "context");
            return;
          case "setMode":
            await this.controller.setMode(message.mode);
            return;
          case "toggleAutoPause":
            this.controller.toggleAutoPause();
            return;
          case "navigate":
            this.controller.navigate(message.screen);
            return;
          case "navigateBack":
            this.controller.navigateBack();
            return;
          case "openAdviceDetail":
            this.controller.selectConversation(message.id);
            return;
          case "deepDive":
            await this.controller.deepDiveSelectedAdvice();
            return;
          case "saveKnowledge":
            await this.controller.saveKnowledge(message.id);
            return;
          case "selectKnowledge":
            this.controller.selectKnowledge(message.id);
            return;
          case "updateKnowledge":
            if (this.isCompleteKnowledgeMessage(message)) {
              await this.controller.updateKnowledge({
                id: message.id,
                title: message.title,
                summary: message.summary,
                body: message.body,
                tags: message.tags,
                status: message.status
              });
            }
            return;
          case "toggleKnowledgeStatus":
            await this.controller.toggleKnowledgeStatus(message.id);
            return;
          case "deleteKnowledge":
            await this.controller.deleteKnowledge(message.id);
            return;
          case "saveSettings":
            if (this.isCompletePayload(message.payload)) {
              await this.controller.saveSettings(message.payload);
            }
            return;
          case "resetSettings":
            await this.controller.resetSettings();
            return;
          case "searchKnowledge":
            this.controller.searchKnowledge(message.query);
            return;
          case "filterKnowledge":
            this.controller.filterKnowledge(message.filter);
            return;
          case "exportKnowledge":
            await this.controller.exportKnowledge();
            return;
          case "resetKnowledge":
            await this.controller.resetKnowledge();
            return;
          default:
            return;
        }
      })
    );

    webviewView.webview.html = this.buildShell(webviewView.webview);
  }

  private async postViewModel(): Promise<void> {
    if (!this.view) return;
    const payload = this.controller.getViewModel();
    await this.view.webview.postMessage({ type: "updateViewModel", payload });
  }

  public dispose(): void {
    this.clearViewDisposables();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private buildShell(webview: vscode.Webview): string {
    const nonce = getNonce();

    const cssFiles = [
      "common.css",
      "s01-connection.css",
      "s02-main.css",
      "s03-advice-detail.css",
      "s04-conversation.css",
      "s05-knowledge.css",
      "s06-settings.css",
      "s08-history.css",
      "s07-error.css"
    ];

    const cssLinks = cssFiles
      .map((file) => {
        const uri = webview.asWebviewUri(
          vscode.Uri.joinPath(this.extensionUri, "src", "views", "css", file)
        );
        return `<link rel="stylesheet" href="${uri}" />`;
      })
      .join("\n    ");

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview", "main.js")
    );
    const iconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "icon.png")
    );

    return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}';" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
    ${cssLinks}
    <title>NaviCom</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">window.__ICON_URI__ = "${iconUri}";</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private isCompletePayload(payload: unknown): payload is {
    defaultMode: "manual" | "always";
    requestIntervalSec: number;
    idleDelaySec: number;
    excludeGlobs: string;
  } {
    if (typeof payload !== "object" || payload === null) return false;
    const p = payload as Record<string, unknown>;
    return (
      (p.defaultMode === "manual" || p.defaultMode === "always") &&
      typeof p.requestIntervalSec === "number" &&
      typeof p.idleDelaySec === "number" &&
      typeof p.excludeGlobs === "string"
    );
  }

  private isCompleteKnowledgeMessage(
    message: unknown
  ): message is Extract<WebviewToExtension, { type: "updateKnowledge" }> {
    if (typeof message !== "object" || message === null) return false;
    const p = message as Record<string, unknown>;
    return (
      p.type === "updateKnowledge" &&
      typeof p.id === "string" &&
      typeof p.title === "string" &&
      typeof p.summary === "string" &&
      typeof p.body === "string" &&
      typeof p.tags === "string" &&
      (p.status === "active" || p.status === "disabled")
    );
  }

  private clearViewDisposables(): void {
    while (this.viewDisposables.length > 0) {
      this.viewDisposables.pop()?.dispose();
    }
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
