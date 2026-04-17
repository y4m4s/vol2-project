import * as vscode from "vscode";
import { NavigatorController } from "../application/NavigatorController";
import { DiagnosticSummary, NavigatorViewModel } from "../shared/types";

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
      webviewView.webview.onDidReceiveMessage(async (message: { type: string }) => {
        switch (message.type) {
          case "connect":
            await this.controller.connectCopilot();
            return;
          case "ask":
            await this.controller.askForGuidance();
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

    return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Pair Navigator</title>
    <style>
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        padding: 16px;
        line-height: 1.5;
      }
      .stack > * + * {
        margin-top: 12px;
      }
      .card {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 10px;
        padding: 12px;
        background: var(--vscode-editorWidget-background);
      }
      .muted {
        color: var(--vscode-descriptionForeground);
      }
      .banner {
        border-radius: 10px;
        padding: 12px;
        border: 1px solid transparent;
      }
      .banner.info {
        background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent);
      }
      .banner.warning,
      .banner.error {
        background: color-mix(in srgb, var(--vscode-inputValidation-errorBackground) 40%, transparent);
      }
      button {
        width: 100%;
        border: 0;
        border-radius: 8px;
        padding: 10px 12px;
        margin-top: 8px;
        cursor: pointer;
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
      }
      button.secondary {
        color: var(--vscode-button-secondaryForeground);
        background: var(--vscode-button-secondaryBackground);
      }
      button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      ul {
        margin: 8px 0 0;
        padding-left: 18px;
      }
      code {
        white-space: pre-wrap;
      }
      .section-title {
        display: block;
        margin-bottom: 6px;
      }
      .guidance {
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <div class="stack">
      ${this.renderHeader(model)}
      ${this.renderStatusMessage(model)}
      ${this.renderScreen(model)}
    </div>
    <script>
      const vscode = acquireVsCodeApi();
      document.getElementById("connect")?.addEventListener("click", () => {
        vscode.postMessage({ type: "connect" });
      });
      document.getElementById("ask")?.addEventListener("click", () => {
        vscode.postMessage({ type: "ask" });
      });
      document.getElementById("refresh")?.addEventListener("click", () => {
        vscode.postMessage({ type: "refresh" });
      });
    </script>
  </body>
</html>`;
  }

  private renderHeader(model: NavigatorViewModel): string {
    return `
      <div class="card">
        <strong>AI Pair Navigator</strong>
        <p class="muted">学習支援に特化したペアプログラミング用ナビゲーターです。</p>
        <p>Status: <code>${this.escapeHtml(model.connectionState)}</code></p>
      </div>
    `;
  }

  private renderStatusMessage(model: NavigatorViewModel): string {
    if (!model.statusMessage) {
      return "";
    }

    return `
      <div class="banner ${this.escapeHtml(model.statusMessage.kind)}">
        ${this.escapeHtml(model.statusMessage.text)}
      </div>
    `;
  }

  private renderScreen(model: NavigatorViewModel): string {
    switch (model.screen) {
      case "main":
        return this.renderMain(model);
      case "error":
        return this.renderError(model);
      case "onboarding":
      default:
        return this.renderOnboarding(model);
    }
  }

  private renderOnboarding(model: NavigatorViewModel): string {
    return `
      <div class="card">
        <strong class="section-title">はじめに</strong>
        <p class="muted">Copilot と接続すると、現在のファイルや選択範囲、diagnostics をもとに手動ガイダンスを受けられます。</p>
        <ul>
          <li>VS Code Desktop が必要です</li>
          <li>Workspace Trust が有効である必要があります</li>
          <li>Phase 1 では必要時モードのみ利用できます</li>
        </ul>
        <button id="connect"${model.canConnect ? "" : " disabled"}>${model.isBusy ? "接続中..." : "Copilot に接続"}</button>
      </div>
      <div class="card">
        <strong class="section-title">送信対象の最小要約</strong>
        <ul>
          <li>アクティブファイル: ${this.escapeHtml(model.contextPreview.activeFilePath ?? "なし")}</li>
          <li>選択テキスト: ${this.escapeHtml(model.contextPreview.selectedTextPreview ?? "なし")}</li>
          <li>Diagnostics: ${model.contextPreview.diagnosticsSummary.length} 件</li>
        </ul>
      </div>
    `;
  }

  private renderMain(model: NavigatorViewModel): string {
    return `
      <div class="card">
        <strong class="section-title">手動ガイダンス</strong>
        <p><code>必要時モード</code></p>
        <p class="muted">常時モードは Phase 3 で有効化予定です。</p>
        <button id="ask" class="secondary"${model.canAskForGuidance ? "" : " disabled"}>${model.isBusy ? "ガイダンス生成中..." : "ガイダンスを求める"}</button>
        ${model.connectionState !== "connected" ? `<button id="connect"${model.canConnect ? "" : " disabled"}>Copilot に接続し直す</button>` : ""}
      </div>
      <div class="card">
        <strong class="section-title">現在の文脈</strong>
        <ul>
          <li>アクティブファイル: ${this.escapeHtml(model.contextPreview.activeFilePath ?? "なし")}</li>
          <li>選択テキスト: ${this.escapeHtml(model.contextPreview.selectedTextPreview ?? "なし")}</li>
          <li>Diagnostics: ${model.contextPreview.diagnosticsSummary.length} 件</li>
        </ul>
        ${this.renderDiagnostics(model.contextPreview.diagnosticsSummary)}
      </div>
      <div class="card">
        <strong class="section-title">最新アドバイス</strong>
        ${
          model.latestGuidance
            ? `
              <p class="muted">取得時刻: ${this.escapeHtml(this.formatRequestedAt(model.latestGuidance.requestedAt))}</p>
              <div class="guidance">${this.escapeHtml(model.latestGuidance.text)}</div>
            `
            : '<p class="muted">まだガイダンスはありません。接続後に手動で生成できます。</p>'
        }
      </div>
    `;
  }

  private renderError(model: NavigatorViewModel): string {
    const { title, description } = this.getErrorCopy(model);

    return `
      <div class="card">
        <strong class="section-title">${this.escapeHtml(title)}</strong>
        <p class="muted">${this.escapeHtml(description)}</p>
        <button id="connect"${model.canConnect ? "" : " disabled"}>Copilot に接続し直す</button>
        <button id="refresh" class="secondary">状態を更新</button>
      </div>
      <div class="card">
        <strong class="section-title">現在の文脈</strong>
        <ul>
          <li>アクティブファイル: ${this.escapeHtml(model.contextPreview.activeFilePath ?? "なし")}</li>
          <li>選択テキスト: ${this.escapeHtml(model.contextPreview.selectedTextPreview ?? "なし")}</li>
          <li>Diagnostics: ${model.contextPreview.diagnosticsSummary.length} 件</li>
        </ul>
      </div>
    `;
  }

  private renderDiagnostics(diagnostics: DiagnosticSummary[]): string {
    if (diagnostics.length === 0) {
      return '<p class="muted">Diagnostics はありません。</p>';
    }

    const items = diagnostics
      .map((diagnostic) => {
        const source = diagnostic.source ? ` (${this.escapeHtml(diagnostic.source)})` : "";
        return `<li>${this.escapeHtml(diagnostic.severity)}${source} L${diagnostic.line}: ${this.escapeHtml(diagnostic.message)}</li>`;
      })
      .join("");

    return `<ul>${items}</ul>`;
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
      .replaceAll(">", "&gt;");
  }
}
