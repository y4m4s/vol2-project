import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { NavigatorController } from "../application/NavigatorController";
import { NavigatorViewModel } from "../shared/types";

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
        void this.refresh();
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
      webviewView.webview.onDidReceiveMessage(async (message: { type: string; screen?: string; text?: string }) => {
        switch (message.type) {
          case "connect":
            await this.controller.connectCopilot();
            return;
          case "ask":
          case "askContext":
            await this.controller.askForGuidance();
            return;
          case "refresh":
            await this.refresh();
            return;
          case "navigate":
            // s04/s05/s06 は未実装のため無視
            return;
          default:
            return;
        }
      })
    );

    webviewView.webview.html = this.render();
  }

  public async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    this.view.webview.html = this.render();
  }

  public dispose(): void {
    this.clearViewDisposables();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private render(): string {
    const model = this.controller.getViewModel();
    switch (model.screen) {
      case "main":  return this.loadScreen("s02-main", model);
      case "error": return this.loadScreen("s07-error", model);
      default:      return this.loadScreen("s01-connection", model);
    }
  }

  private loadScreen(screenName: string, model: NavigatorViewModel): string {
    const webview = this.view!.webview;

    const htmlPath = path.join(this.extensionUri.fsPath, "src", "views", "screens", `${screenName}.html`);
    let html = fs.readFileSync(htmlPath, "utf-8");

    const commonCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "src", "views", "css", "common.css")
    ).toString();

    const screenCssPath = vscode.Uri.joinPath(this.extensionUri, "src", "views", "css", `${screenName}.css`);
    const screenCssUri = fs.existsSync(screenCssPath.fsPath)
      ? webview.asWebviewUri(screenCssPath).toString()
      : commonCssUri;

    const vars: Record<string, string> = {
      commonCssUri,
      screenCssUri,
      ...this.getScreenVars(screenName, model),
    };

    return this.applyTemplate(html, vars);
  }

  private getScreenVars(screenName: string, model: NavigatorViewModel): Record<string, string> {
    switch (screenName) {
      case "s01-connection":
        return {
          connectDisabled: model.canConnect ? "" : " disabled",
          connectLabel: model.isBusy ? "接続中..." : "Copilotに接続",
        };

      case "s02-main": {
        const isConnected = model.connectionState === "connected";
        const chatAreaHtml = model.latestGuidance
          ? `<div style="white-space:pre-wrap;font-size:0.9em;text-align:left;padding:8px;width:100%">
               <p style="font-size:0.85em;color:var(--vscode-descriptionForeground);margin-bottom:6px">
                 ${this.escapeHtml(this.formatRequestedAt(model.latestGuidance.requestedAt))}
               </p>
               ${this.escapeHtml(model.latestGuidance.text)}
             </div>`
          : `<div class="empty-chat">
               <div class="empty-title">会話を開始してください</div>
               <div class="empty-desc">
                 質問や確認したいことを入力するか、<br>
                 「この箇所を相談」で現在の文脈について質問できます
               </div>
             </div>`;
        return {
          statusDotClass: isConnected ? "" : "disconnected",
          connectionLabel: this.escapeHtml(model.connectionState),
          activeFileRef: this.escapeHtml(model.contextPreview.activeFilePath ?? "なし"),
          diagnosticsRef: `${model.contextPreview.diagnosticsSummary.length} 件`,
          modeManualActive: "active",
          modeAlwaysActive: "",
          chatAreaHtml,
        };
      }

      case "s07-error": {
        const { title, description } = this.getErrorCopy(model);
        return {
          errorTitle: this.escapeHtml(title),
          errorDescription: this.escapeHtml(description),
          recommendedAction: this.escapeHtml(
            model.statusMessage?.text ?? "少し時間を置いてから再試行してください。"
          ),
        };
      }

      default:
        return {};
    }
  }

  private applyTemplate(html: string, vars: Record<string, string>): string {
    return html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
  }

  private getErrorCopy(model: NavigatorViewModel): { title: string; description: string } {
    if (model.connectionState === "unavailable") {
      return {
        title: "Copilot を利用できません",
        description: model.statusMessage?.text ?? "Workspace Trust や Copilot の利用状態を確認してください。"
      };
    }
    return {
      title: "現在は利用が制限されています",
      description: model.statusMessage?.text ?? "少し時間を置いてから再試行してください。"
    };
  }

  private formatRequestedAt(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP");
  }

  private clearViewDisposables(): void {
    while (this.viewDisposables.length > 0) {
      this.viewDisposables.pop()?.dispose();
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}
