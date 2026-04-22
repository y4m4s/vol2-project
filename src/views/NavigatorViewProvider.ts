import * as fs from "fs";
import * as path from "path";
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
      webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
        switch (message.type) {
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
            if (message.screen) {
              this.controller.navigate(message.screen);
            }
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
            if (this.isCompleteSettingsMessage(message)) {
              await this.controller.saveSettings({
                defaultMode: message.defaultMode,
                alwaysModeEnabled: message.alwaysModeEnabled,
                requestIntervalSec: message.requestIntervalSec,
                idleDelaySec: message.idleDelaySec,
                suppressDuplicate: message.suppressDuplicate,
                ctxActiveFile: message.ctxActiveFile,
                ctxSelection: message.ctxSelection,
                ctxDiagnostics: message.ctxDiagnostics,
                ctxRecentEdits: message.ctxRecentEdits,
                ctxSymbols: message.ctxSymbols,
                excludeGlobs: message.excludeGlobs
              });
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
          case "refresh":
            await this.refresh();
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
    return this.loadScreen(this.resolveScreenName(model.screen), model);
  }

  private resolveScreenName(screen: NavigatorScreen): string {
    switch (screen) {
      case "main":
        return "s02-main";
      case "advice_detail":
        return "s03-advice-detail";
      case "context_check":
        return "s04-context-check";
      case "knowledge":
        return "s05-knowledge";
      case "settings":
        return "s06-settings";
      case "error":
        return "s07-error";
      case "onboarding":
      default:
        return "s01-connection";
    }
  }

  private loadScreen(screenName: string, model: NavigatorViewModel): string {
    if (!this.view) {
      return "";
    }

    const webview = this.view.webview;
    const htmlPath = path.join(this.extensionUri.fsPath, "src", "views", "screens", `${screenName}.html`);
    const html = fs.readFileSync(htmlPath, "utf-8");

    const commonCssUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "src", "views", "css", "common.css"))
      .toString();

    const screenCssPath = vscode.Uri.joinPath(this.extensionUri, "src", "views", "css", `${screenName}.css`);
    const screenCssUri = fs.existsSync(screenCssPath.fsPath)
      ? webview.asWebviewUri(screenCssPath).toString()
      : commonCssUri;

    const vars: Record<string, string> = {
      commonCssUri,
      screenCssUri,
      ...this.getScreenVars(screenName, model)
    };

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

    return {
      adviceBody: this.escapeHtml(detail.adviceBody),
      speculativeNote: this.escapeHtml(detail.speculativeNote),
      referenceFiles: detail.referenceFiles.length
        ? detail.referenceFiles.map((item) => this.escapeHtml(item)).join("<br>")
        : "なし",
      diagnosticsSummary: this.escapeHtml(detail.diagnosticsSummary),
      changeSummary: this.escapeHtml(detail.changeSummary),
      deepDiveDisabled: detail.canDeepDive ? "" : " disabled"
    };
  }

  private renderChatHistory(history: ConversationEntry[]): string {
    if (history.length === 0) {
      return `
        <div class="empty-chat">
          <div class="empty-title">会話を開始してください</div>
          <div class="empty-desc">
            質問や確認したいことを入力するか、<br>
            「この箇所を相談」で現在の文脈について質問できます
          </div>
        </div>
      `;
    }

    return history
      .map((entry) => {
        const metaLabel = entry.role === "user" ? "あなた" : entry.kind === "always" ? "Navigator 自動助言" : "Navigator";
        return `
          <div class="chat-entry ${entry.role}">
            <div class="chat-bubble">
              <div class="chat-meta">
                <span>${metaLabel}</span>
                <span>${this.escapeHtml(this.formatRequestedAt(entry.createdAt))}</span>
              </div>
              <div class="chat-text">${this.escapeHtml(entry.text)}</div>
              ${
                entry.role === "assistant"
                  ? `<div class="chat-actions">
                       <button class="secondary" data-advice-id="${this.escapeHtml(entry.id)}">詳細を見る</button>
                     </div>`
                  : ""
              }
            </div>
          </div>
        `;
      })
      .join("");
  }

  private renderCategoryCards(categories: RequestPlanCategory[]): string {
    return categories
      .map((category) => {
        const badgeClass = category.enabled && category.included ? "badge-green" : "badge-gray";
        const badgeText = category.enabled ? (category.included ? "有効" : "未収集") : "無効";
        const noteHtml = category.note
          ? `<div class="cat-desc">${this.escapeHtml(category.note)}</div>`
          : "";

        return `
          <div class="category-card">
            <span class="cat-icon material-symbols-outlined">${this.iconForCategory(category.key)}</span>
            <div class="cat-body">
              <div class="cat-name">${this.escapeHtml(category.label)}</div>
              <div class="cat-desc">${this.escapeHtml(category.description)}</div>
              ${noteHtml}
            </div>
            <span class="cat-badge badge ${badgeClass}">${badgeText}</span>
          </div>
        `;
      })
      .join("");
  }

  private renderTargetFiles(files: RequestPlanFile[]): string {
    if (files.length === 0) {
      return `
        <div class="file-list-item excluded">
          <div>
            <div class="file-path">対象ファイルはありません</div>
            <div class="file-excluded">アクティブファイルが開かれていない可能性があります</div>
          </div>
        </div>
      `;
    }

    return files
      .map((file) => {
        const excludedClass = file.included ? "" : " excluded";
        const excludedHtml = file.excludedReason
          ? `<div class="file-excluded">${this.escapeHtml(file.excludedReason)}</div>`
          : "";

        return `
          <div class="file-list-item${excludedClass}">
            <div>
              <div class="file-path">${this.escapeHtml(file.path)}</div>
              ${excludedHtml}
            </div>
            <div class="file-size">${this.escapeHtml(file.sizeText)}</div>
          </div>
        `;
      })
      .join("");
  }

  private renderKnowledgeList(model: NavigatorViewModel): string {
    if (model.knowledgeItems.length === 0) {
      return "";
    }

    return model.knowledgeItems
      .map(
        (item) => {
          const selectedClass = model.selectedKnowledge?.id === item.id ? " selected" : "";
          const tags = item.tags.length > 0
            ? `<div class="knowledge-tags">${item.tags.map((tag) => `<span>${this.escapeHtml(tag)}</span>`).join("")}</div>`
            : "";

          return `
          <div class="knowledge-card${selectedClass}" data-knowledge-id="${this.escapeHtml(item.id)}">
            <div class="knowledge-card-head">
              <div class="section-title">${this.escapeHtml(item.title)}</div>
              <span class="knowledge-status ${this.escapeHtml(item.status)}">${this.escapeHtml(this.formatKnowledgeStatus(item.status))}</span>
            </div>
            <div class="muted">${this.escapeHtml(item.summary)}</div>
            ${tags}
            <div class="muted">${this.escapeHtml(this.formatRequestedAt(item.updatedAt))}</div>
          </div>
        `;
        }
      )
      .join("");
  }

  private renderKnowledgeDetail(model: NavigatorViewModel): string {
    const detail = model.selectedKnowledge;
    if (!detail) {
      return `
        <div class="knowledge-detail empty-detail">
          <div class="section-title">ナレッジ詳細</div>
          <div class="muted">一覧からナレッジを選択すると、本文の確認や編集ができます。</div>
        </div>
      `;
    }

    return `
      <div class="knowledge-detail">
        <div class="detail-header-row">
          <div class="section-title">ナレッジ詳細</div>
          <span class="knowledge-status ${this.escapeHtml(detail.status)}">${this.escapeHtml(this.formatKnowledgeStatus(detail.status))}</span>
        </div>
        <label class="field-label" for="knowledgeTitle">タイトル</label>
        <input id="knowledgeTitle" type="text" value="${this.escapeHtml(detail.title)}" />

        <label class="field-label" for="knowledgeSummary">要約</label>
        <textarea id="knowledgeSummary" rows="3">${this.escapeHtml(detail.summary)}</textarea>

        <label class="field-label" for="knowledgeBody">本文</label>
        <textarea id="knowledgeBody" rows="8">${this.escapeHtml(detail.body)}</textarea>

        <label class="field-label" for="knowledgeTags">タグ</label>
        <input id="knowledgeTags" type="text" value="${this.escapeHtml(detail.tags.join(", "))}" />

        <select id="knowledgeStatus" class="knowledge-status-select">
          <option value="active"${detail.status === "active" ? " selected" : ""}>有効</option>
          <option value="disabled"${detail.status === "disabled" ? " selected" : ""}>無効</option>
        </select>

        <div class="knowledge-meta">
          作成: ${this.escapeHtml(this.formatRequestedAt(detail.createdAt))}<br>
          更新: ${this.escapeHtml(this.formatRequestedAt(detail.updatedAt))}
          ${detail.sourceAdviceId ? `<br>元アドバイス: ${this.escapeHtml(detail.sourceAdviceId)}` : ""}
        </div>

        <div class="knowledge-actions">
          <button id="saveKnowledgeEdit" data-knowledge-id="${this.escapeHtml(detail.id)}">保存</button>
          <button id="toggleKnowledgeStatus" class="secondary" data-knowledge-id="${this.escapeHtml(detail.id)}">
            ${detail.status === "active" ? "無効化" : "有効化"}
          </button>
          <button id="deleteKnowledge" class="danger" data-knowledge-id="${this.escapeHtml(detail.id)}">削除</button>
        </div>
      </div>
    `;
  }

  private renderLatestAdviceCard(model: NavigatorViewModel): string {
    if (!model.latestGuidance) {
      return `
        <div class="auto-advice-card empty">
          <div class="auto-advice-title">最新アドバイス</div>
          <div class="auto-advice-text">まだアドバイスはありません。</div>
        </div>
      `;
    }

    const label = model.latestGuidance.mode === "always" ? "最新の自動アドバイス" : "最新アドバイス";

    return `
      <div class="auto-advice-card">
        <div class="auto-advice-meta">
          <span class="auto-advice-title">${this.escapeHtml(label)}</span>
          <span>${this.escapeHtml(this.formatRequestedAt(model.latestGuidance.requestedAt))}</span>
        </div>
        <div class="auto-advice-text">${this.escapeHtml(this.truncate(model.latestGuidance.text, 180))}</div>
        <div class="auto-advice-actions">
          <button class="secondary" data-advice-id="${this.escapeHtml(model.latestGuidance.id)}">詳細を見る</button>
        </div>
      </div>
    `;
  }

  private renderStatusNotice(message?: NavigatorStatusMessage): string {
    if (!message) {
      return "";
    }

    return `<div class="status-notice ${this.escapeHtml(message.kind)}">${this.escapeHtml(message.text)}</div>`;
  }

  private getModeNote(model: NavigatorViewModel): string {
    if (!model.settings.alwaysModeEnabled) {
      return "※ 常時モードは設定画面で有効化できます";
    }

    if (model.mode === "always") {
      return "※ 常時モードでは編集が落ち着いたタイミングで自動助言します";
    }

    return "※ 必要時モードでは明示操作でのみ助言します";
  }

  private getAutoStatusText(autoAdvice: AutoAdviceState): string {
    if (!autoAdvice.enabled) {
      return "現在は必要時モードです。自動助言は動いていません。";
    }

    if (autoAdvice.paused) {
      return "常時モードは一時停止中です。再開すると監視を続けます。";
    }

    if (autoAdvice.waitingForIdle) {
      return `入力が落ち着くのを待っています。次の判定まで約${this.formatDurationSeconds(autoAdvice.idleRemainingMs)}秒です。`;
    }

    if (autoAdvice.cooldownRemainingMs > 0) {
      return `次の自動助言までクールダウン中です。残り約${this.formatDurationSeconds(autoAdvice.cooldownRemainingMs)}秒です。`;
    }

    return "編集中のファイルを監視しています。変化があれば自動助言を試みます。";
  }

  private describePendingReason(reason?: AdviceTriggerReason): string {
    switch (reason) {
      case "text_edit":
        return "編集を検知";
      case "selection_change":
        return "選択範囲の変化を検知";
      case "editor_change":
        return "ファイル切替を検知";
      case "diagnostics_change":
        return "診断変化を検知";
      default:
        return "待機中";
    }
  }

  private iconForCategory(key: ContextCategoryKey): string {
    switch (key) {
      case "activeFile":
        return "description";
      case "selection":
        return "highlight_alt";
      case "diagnostics":
        return "warning";
      case "recentEdits":
        return "edit_note";
      case "relatedSymbols":
      default:
        return "code";
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

  private formatConnectionState(state: NavigatorViewModel["connectionState"]): string {
    switch (state) {
      case "connected":
        return "接続済み";
      case "connecting":
        return "接続中";
      case "consent_pending":
        return "同意待ち";
      case "restricted":
        return "制限中";
      case "unavailable":
        return "利用不可";
      case "disconnected":
      default:
        return "未接続";
    }
  }

  private formatKnowledgeStatus(status: "active" | "disabled"): string {
    return status === "active" ? "有効" : "無効";
  }

  private formatRequestedAt(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP");
  }

  private formatDurationSeconds(milliseconds: number): string {
    return String(Math.max(1, Math.ceil(milliseconds / 1000)));
  }

  private truncate(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
  }

  private isCompleteSettingsMessage(
    message: WebviewMessage
  ): message is WebviewMessage & {
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
    return (
      typeof message.defaultMode === "string" &&
      typeof message.alwaysModeEnabled === "boolean" &&
      typeof message.requestIntervalSec === "number" &&
      typeof message.idleDelaySec === "number" &&
      typeof message.suppressDuplicate === "boolean" &&
      typeof message.ctxActiveFile === "boolean" &&
      typeof message.ctxSelection === "boolean" &&
      typeof message.ctxDiagnostics === "boolean" &&
      typeof message.ctxRecentEdits === "boolean" &&
      typeof message.ctxSymbols === "boolean" &&
      typeof message.excludeGlobs === "string"
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

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}
