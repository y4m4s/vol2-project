import * as vscode from "vscode";
import { NavigatorController } from "../application/NavigatorController";
import { parseWebviewMessage } from "../shared/messages";

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
      webviewView.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
        const message = parseWebviewMessage(rawMessage);
        if (!message) {
          await this.postOperationError("Webview から不正な操作データを受信しました。入力内容を確認してください。");
          return;
        }
        try {
        switch (message.type) {
          case "ready":
            await this.postViewModel();
            return;
          case "connect":
            await this.controller.connectCopilot(message.providerId);
            return;
          case "createConversationStream":
            await this.controller.createConversationStream();
            return;
          case "selectConversationStream":
            await this.controller.selectConversationStream(message.id);
            return;
          case "deleteConversationStream":
            await this.controller.deleteConversationStream(message.id);
            return;
          case "ask":
            await this.controller.askForGuidanceWithCurrentContext(message.text, message.additionalContext);
            return;
          case "cancelGuidanceRequest":
            this.controller.cancelGuidanceRequest();
            return;
          case "setMode":
            await this.controller.setMode(message.mode, message.additionalContext);
            return;
          case "setAssistanceDepth":
            await this.controller.setAssistanceDepth(message.assistanceDepth);
            return;
          case "toggleAutoPause":
            this.controller.toggleAutoPause();
            return;
          case "setComposerActive":
            this.controller.setComposerActive(message.active);
            return;
          case "navigate":
            this.controller.navigate(message.screen);
            return;
          case "navigateBack":
            this.controller.navigateBack();
            return;
          case "saveKnowledge":
            await this.controller.saveKnowledge(message.id);
            return;
          case "rateAdvice":
            await this.controller.rateAdvice(message.id, message.rating);
            return;
          case "submitBadFeedback":
            await this.controller.submitBadFeedback(message.reasons, message.comment);
            return;
          case "cancelBadFeedback":
            this.controller.cancelBadFeedback();
            return;
          case "selectKnowledge":
            this.controller.selectKnowledge(message.id);
            return;
          case "updateKnowledge":
            await this.controller.updateKnowledge({
              id: message.id,
              title: message.title,
              summary: message.summary,
              body: message.body
            });
            return;
          case "deleteKnowledge":
            await this.controller.deleteKnowledge(message.id);
            return;
          case "saveSettings":
            await this.controller.saveSettings(message.payload);
            return;
          case "refreshLmStudioServerStatus":
            await this.controller.refreshLmStudioServerStatus();
            return;
          case "startLmStudioServer":
            await this.controller.startLmStudioServer();
            return;
          case "stopLmStudioServer":
            await this.controller.stopLmStudioServer();
            return;
          case "useLmStudioRunningPort":
            await this.controller.useLmStudioRunningPort();
            return;
          case "restartLmStudioOnConfiguredPort":
            await this.controller.restartLmStudioOnConfiguredPort();
            return;
          case "refreshLmStudioModels":
            await this.controller.refreshLmStudioModels();
            return;
          case "setOrcaRouterApiKey":
            await this.controller.setOrcaRouterApiKey(message.apiKey);
            return;
          case "deleteOrcaRouterApiKey":
            await this.controller.deleteOrcaRouterApiKey();
            return;
          case "refreshOrcaRouterModels":
            await this.controller.refreshOrcaRouterModels();
            return;
          case "refreshRequestPlan":
            await this.controller.refreshCurrentRequestPlan();
            return;
          case "openReferencedFile":
            await this.controller.openReferencedFile(message.path, message.line);
            return;
          case "resetSettings":
            await this.controller.resetSettings();
            return;
          case "searchKnowledge":
            this.controller.searchKnowledge(message.query);
            return;
          case "setAdditionalContext":
            this.controller.setAdditionalContext(message.additionalContext);
            return;
          default:
            return;
        }
        } catch (error) {
          console.error(`NaviCom webview operation failed: ${message.type}`, error);
          await this.postOperationError("操作を完了できませんでした。データは変更されていない可能性があります。再試行してください。");
          await this.postViewModel().catch(() => undefined);
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

  private async postOperationError(message: string): Promise<void> {
    await this.view?.webview.postMessage({ type: "operationError", message });
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
      "s04-conversation.css",
      "s05-knowledge.css",
      "s06-settings.css",
      "s08-history.css",
      "s09-feedback-form.css",
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
    const materialSymbolsFontUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "material-symbols-outlined.woff2")
    );

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview", "main.js")
    );
    const iconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "icon.png")
    );
    const providerLogoUris = JSON.stringify({
      copilotBlack: webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, "media", "github-copilot-icon-black.svg")
      ).toString(),
      copilotWhite: webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, "media", "github-copilot-icon-white.svg")
      ).toString(),
      lmStudio: webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, "media", "lmstudio-icon-color.svg")
      ).toString()
    });

    return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}';" />
    <style>
      @font-face {
        font-family: "Material Symbols Outlined";
        font-style: normal;
        font-weight: 100 700;
        src: url("${materialSymbolsFontUri}") format("woff2");
      }
      .material-symbols-outlined {
        font-family: "Material Symbols Outlined";
        font-weight: normal;
        font-style: normal;
        font-size: 24px;
        line-height: 1;
        letter-spacing: normal;
        text-transform: none;
        display: inline-block;
        white-space: nowrap;
        word-wrap: normal;
        direction: ltr;
        font-feature-settings: "liga";
        -webkit-font-feature-settings: "liga";
        -webkit-font-smoothing: antialiased;
      }
    </style>
    ${cssLinks}
    <title>NaviCom</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">window.__ICON_URI__ = "${iconUri}"; window.__PROVIDER_LOGO_URIS__ = ${providerLogoUris};</script>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
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
