import * as vscode from "vscode";
import { NavigatorController } from "../application/NavigatorController";
import {
  AdviceDetailViewData,
  AdviceTriggerReason,
  AutoAdviceState,
  ContextCategoryKey,
  ConversationEntry,
  NavigatorScreen,
  NavigatorStatusMessage,
  NavigatorViewModel,
  RequestPlanCategory,
  RequestPlanFile
} from "../shared/types";

interface WebviewMessage {
  type: string;
  screen?: string;
  text?: string;
  id?: string;
  mode?: "manual" | "always";
  query?: string;
  filter?: string;
  title?: string;
  summary?: string;
  body?: string;
  tags?: string;
  status?: "active" | "disabled";
  defaultMode?: "manual" | "always";
  alwaysModeEnabled?: boolean;
  requestIntervalSec?: number;
  idleDelaySec?: number;
  suppressDuplicate?: boolean;
  ctxActiveFile?: boolean;
  ctxSelection?: boolean;
  ctxDiagnostics?: boolean;
  ctxRecentEdits?: boolean;
  ctxSymbols?: boolean;
  excludeGlobs?: string;
}
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
          case "ask":
            await this.controller.askForGuidance(message.text);
            return;
          case "askContext":
            await this.controller.askForGuidance(undefined, "context");
            return;
          case "setMode":
            if (message.mode) {
              this.controller.setMode(message.mode);
            }
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
            if (message.id) {
              this.controller.selectConversation(message.id);
            }
            return;
          case "deepDive":
            await this.controller.deepDiveSelectedAdvice();
            return;
          case "saveKnowledge":
            await this.controller.saveKnowledge();
            return;
          case "selectKnowledge":
            if (message.id) {
              this.controller.selectKnowledge(message.id);
            }
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
            if (message.id) {
              await this.controller.toggleKnowledgeStatus(message.id);
            }
            return;
          case "deleteKnowledge":
            if (message.id) {
              await this.controller.deleteKnowledge(message.id);
            }
            return;
          case "saveSettings":
            if (message.payload && this.isCompletePayload(message.payload)) {
              await this.controller.saveSettings(message.payload);
            }
            return;
          case "resetSettings":
            await this.controller.resetSettings();
            return;
          case "searchKnowledge":
            this.controller.searchKnowledge(message.query ?? "");
            return;
          case "filterKnowledge":
            this.controller.filterKnowledge(message.filter ?? "");
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

    return this.applyTemplate(html, vars);
  }

  private getScreenVars(screenName: string, model: NavigatorViewModel): Record<string, string> {
    switch (screenName) {
      case "s01-connection":
        return {
          connectDisabled: model.canConnect ? "" : " disabled",
          connectLabel: model.isBusy ? "接続中..." : "Copilotに接続"
        };
      case "s02-main":
        return {
          statusDotClass: model.connectionState === "connected" ? "" : "disconnected",
          connectionLabel: this.escapeHtml(this.formatConnectionState(model.connectionState)),
          activeFileRef: this.escapeHtml(model.contextPreview.activeFilePath ?? "なし"),
          selectedRef: this.escapeHtml(model.contextPreview.selectedTextPreview ?? "選択範囲なし"),
          diagnosticsRef: `${model.contextPreview.diagnosticsSummary.length} 件`,
          modeManualActive: model.mode === "manual" ? "active" : "",
          modeAlwaysActive: model.mode === "always" ? "active" : "",
          modeNote: this.escapeHtml(this.getModeNote(model)),
          chatAreaHtml: this.renderChatHistory(model.conversationHistory),
          sendDisabled: model.canAskForGuidance ? "" : " disabled",
          askContextDisabled: model.canAskForGuidance ? "" : " disabled",
          autoStatusText: this.escapeHtml(this.getAutoStatusText(model.autoAdvice)),
          autoPendingReason: this.escapeHtml(this.describePendingReason(model.autoAdvice.pendingTriggerReason)),
          autoPauseLabel: model.autoAdvice.paused ? "再開" : "一時停止",
          autoPauseDisabled: model.autoAdvice.enabled ? "" : " disabled",
          latestAdviceCardHtml: this.renderLatestAdviceCard(model),
          statusNoticeHtml: this.renderStatusNotice(model.statusMessage)
        };
      case "s03-advice-detail":
        return this.getAdviceDetailVars(model.selectedAdvice);
      case "s04-context-check":
        return {
          categoryCards: this.renderCategoryCards(model.currentRequestPlan.categories),
          targetFilesList: this.renderTargetFiles(model.currentRequestPlan.targetFiles),
          excludePatterns: model.settings.excludedGlobs.map((item) => this.escapeHtml(item)).join("<br>"),
          maxSizeLabel: "最大本文抜粋: 8000文字 / 選択範囲: 4000文字",
          estimatedSize: this.escapeHtml(model.currentRequestPlan.estimatedSizeText)
        };
      case "s05-knowledge":
        return {
          knowledgeQuery: this.escapeHtml(model.knowledgeQuery),
          filterAllActive: model.knowledgeStatusFilter === "all" ? "active" : "",
          filterActiveActive: model.knowledgeStatusFilter === "active" ? "active" : "",
          filterDisabledActive: model.knowledgeStatusFilter === "disabled" ? "active" : "",
          knowledgeEmptyStyle: model.knowledgeItems.length > 0 ? "display:none;" : "display:block;",
          knowledgeListStyle: model.knowledgeItems.length > 0 ? "display:block;" : "display:none;",
          knowledgeList: this.renderKnowledgeList(model),
          selectedKnowledgeDetailHtml: this.renderKnowledgeDetail(model),
          statusNoticeHtml: this.renderStatusNotice(model.statusMessage)
        };
      case "s06-settings":
        return {
          modeManualSelected: model.settings.defaultMode === "manual" ? "selected" : "",
          modeAlwaysSelected: model.settings.defaultMode === "always" ? "selected" : "",
          alwaysModeChecked: model.settings.alwaysModeEnabled ? "checked" : "",
          requestIntervalSec: String(Math.round(model.settings.requestIntervalMs / 1000)),
          idleDelaySec: String(Math.round(model.settings.idleDelayMs / 1000)),
          suppressDuplicateChecked: model.settings.suppressDuplicate ? "checked" : "",
          ctxActiveFileChecked: model.settings.sendTargets.activeFile ? "checked" : "",
          ctxSelectionChecked: model.settings.sendTargets.selection ? "checked" : "",
          ctxDiagnosticsChecked: model.settings.sendTargets.diagnostics ? "checked" : "",
          ctxRecentEditsChecked: model.settings.sendTargets.recentEdits ? "checked" : "",
          ctxSymbolsChecked: model.settings.sendTargets.relatedSymbols ? "checked" : "",
          excludeGlobs: this.escapeHtml(model.settings.excludedGlobs.join("\n"))
        };
      case "s07-error": {
        const { title, description } = this.getErrorCopy(model);
        return {
          errorTitle: this.escapeHtml(title),
          errorDescription: this.escapeHtml(description),
          recommendedAction: this.escapeHtml(
            model.statusMessage?.text ?? "少し時間を置いてから再試行してください。"
          )
        };
      }
      default:
        return {};
    }
  }

  private getAdviceDetailVars(detail?: AdviceDetailViewData): Record<string, string> {
    if (!detail) {
      return {
        adviceBody: "まだ詳細表示できるアドバイスがありません。",
        speculativeNote: "まずメイン画面でガイダンスを取得してください。",
        referenceFiles: "なし",
        diagnosticsSummary: "なし",
        changeSummary: "なし",
        deepDiveDisabled: " disabled"
      };
    }
    const cssFiles = [
      "common.css",
      "s01-connection.css",
      "s02-main.css",
      "s03-advice-detail.css",
      "s04-context-check.css",
      "s05-knowledge.css",
      "s06-settings.css",
      "s07-error.css",
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
    <title>AI Pair Navigator</title>
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
    alwaysModeEnabled: boolean;
    requestIntervalSec: number;
    idleDelaySec: number;
    suppressDuplicate: boolean;
    ctxActiveFile: boolean;
    ctxSelection: boolean;
    ctxDiagnostics: boolean;
    ctxRecentEdits: boolean;
    ctxSymbols: boolean;
    excludeGlobs: string;
  } {
    if (typeof payload !== "object" || payload === null) return false;
    const p = payload as Record<string, unknown>;
    return (
      typeof p.defaultMode === "string" &&
      typeof p.alwaysModeEnabled === "boolean" &&
      typeof p.requestIntervalSec === "number" &&
      typeof p.idleDelaySec === "number" &&
      typeof p.suppressDuplicate === "boolean" &&
      typeof p.ctxActiveFile === "boolean" &&
      typeof p.ctxSelection === "boolean" &&
      typeof p.ctxDiagnostics === "boolean" &&
      typeof p.ctxRecentEdits === "boolean" &&
      typeof p.ctxSymbols === "boolean" &&
      typeof p.excludeGlobs === "string"
    );
  }

  private isCompleteKnowledgeMessage(
    message: WebviewMessage
  ): message is WebviewMessage & {
    id: string;
    title: string;
    summary: string;
    body: string;
    tags: string;
    status: "active" | "disabled";
  } {
    return (
      typeof message.id === "string" &&
      typeof message.title === "string" &&
      typeof message.summary === "string" &&
      typeof message.body === "string" &&
      typeof message.tags === "string" &&
      (message.status === "active" || message.status === "disabled")
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
