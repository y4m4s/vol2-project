import * as vscode from "vscode";
import { NavigatorController } from "../application/NavigatorController";
import { AdviceMode } from "../shared/types";

export class NavigatorViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "aiPairNavigator.sidebar";

  private view?: vscode.WebviewView;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: NavigatorController
  ) {}

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
    webviewView.webview.html = this.render("manual");

    webviewView.webview.onDidReceiveMessage(async (message: { type: string }) => {
      switch (message.type) {
        case "connect":
          await this.controller.connectCopilot();
          await this.refresh("manual");
          return;
        case "ask":
          const guidance = await this.controller.askForGuidance();
          void vscode.window.showInformationMessage(guidance);
          return;
        default:
          return;
      }
    });
  }

  public async refresh(mode: AdviceMode = "manual"): Promise<void> {
    if (!this.view) {
      return;
    }

    this.view.webview.html = this.render(mode);
  }

  private render(mode: AdviceMode): string {
    const state = this.controller.getViewState(mode);
    const contextSummary = [
      state.contextPreview.activeFilePath ? `Active file: ${state.contextPreview.activeFilePath}` : "Active file: none",
      state.contextPreview.selectedText ? `Selection: ${this.escapeHtml(state.contextPreview.selectedText)}` : "Selection: none",
      `Diagnostics: ${state.contextPreview.diagnosticsSummary.length}`
    ].join("<br/>");

    return `<!DOCTYPE html>
<html lang="en">
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
      }
      .card {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 10px;
        padding: 12px;
        margin-bottom: 12px;
        background: var(--vscode-editorWidget-background);
      }
      .muted {
        color: var(--vscode-descriptionForeground);
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
      code {
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <strong>AI Pair Navigator</strong>
      <p class="muted">Minimum scaffold for a learning-focused pair-programming navigator.</p>
    </div>
    <div class="card">
      <strong>Connection</strong>
      <p>Status: <code>${state.connectionState}</code></p>
      <p class="muted">${this.escapeHtml(state.statusMessage)}</p>
      <button id="connect">Connect Copilot</button>
    </div>
    <div class="card">
      <strong>Mode</strong>
      <p><code>${mode}</code></p>
      <p class="muted">The real mode switching logic can be added next.</p>
    </div>
    <div class="card">
      <strong>Context preview</strong>
      <p class="muted">${contextSummary}</p>
      <button id="ask" class="secondary">Ask For Guidance</button>
    </div>
    <script>
      const vscode = acquireVsCodeApi();
      document.getElementById('connect')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'connect' });
      });
      document.getElementById('ask')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'ask' });
      });
    </script>
  </body>
</html>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }
}
