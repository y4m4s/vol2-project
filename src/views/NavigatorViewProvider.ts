import * as vscode from "vscode";
import { NavigatorController } from "../application/NavigatorController";
import { AdviceMode } from "../shared/types";
import * as fs from "fs";
import * as path from "path";

export class NavigatorViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "aiPairNavigator.sidebar";
  private _view?: vscode.WebviewView;
  private _currentScreen: string = "s01"; // 今表示している画面ID
  private _screenHistory: string[] = []; // 画面の履歴（戻る用）
  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: NavigatorController
  ) { }

  public resolveWebviewView(
    webviewView: vscode.WebviewView, //表示するサイドバーのパネル本体
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken //キャンセル信号
  ): void {
    this._view = webviewView; // パネルをクラス変数に保存

    webviewView.webview.options = {
      enableScripts: true, //JavaScriptを動かす許可
      localResourceRoots: [this.extensionUri] //読み込んでいいフォルダーを限定
    };
    webviewView.webview.html = this.render(webviewView.webview, "manual"); //HTMLを生成して表示

    // コントローラーからのイベントを受け取る。
    webviewView.webview.onDidReceiveMessage(async (message: { type: string, }) => {
      // メッセージの種類によって処理を分岐
      switch (message.type) {
        case "connect": //Connectボタンが押されたとき
          await this.controller.connectCopilot(); //Copilotに接続して状態を更新
          await this.refresh("manual"); //画面更新
          return;
        case "ask": //Ask for guidanceボタンが押されたとき
          const guidance = await this.controller.askForGuidance(); //AIにアドバイスを求める
          void vscode.window.showInformationMessage(guidance); //アドバイスをポップアップで表示
          return;
        case "navigate": // 画面移動ボタンが押されたとき
          this._screenHistory.push(this._currentScreen); // 今の画面を履歴に追加
          this._currentScreen = (message as any).screen; // 移動先の画面IDをセット
          await this.refresh();                          // 画面を更新
          return;
        case "navigateBack": // 戻るボタンが押されたとき
          if (this._screenHistory.length > 0) {
            this._currentScreen = this._screenHistory.pop()!; // 履歴から1つ取り出す
          }
          await this.refresh(); // 画面を更新
          return;
      }
    });
  }

  public async refresh(mode: AdviceMode = "manual"): Promise<void> {
    if (!this._view) {
      return;
    }
    this._view.webview.html = this.render(this._view.webview, mode); //HTMLを生成して表示
  }

  private render(webview: vscode.Webview, mode: AdviceMode): string {
    const state = this.controller.getViewState(mode); //コントローラーから現在の状態を取得

    // --- CSS パス ---
    // 全画面共通CSS
    const commonCssPath = vscode.Uri.joinPath(this.extensionUri, "src", "views", "css", "common.css");
    const commonCssUri = webview.asWebviewUri(commonCssPath).toString();

    // 画面固有CSS（存在する画面のみ）
    const screenCssFiles: Record<string, string> = {
      s01: "s01-connection.css",
      s02: "s02-main.css",
      s04: "s04-context-check.css",
      s05: "s05-knowledge.css",
      s06: "s06-settings.css",
    };
    const screenCssFile = screenCssFiles[this._currentScreen];
    let screenCssUri = "";
    if (screenCssFile) {
      const screenCssPath = vscode.Uri.joinPath(this.extensionUri, "src", "views", "css", screenCssFile);
      screenCssUri = webview.asWebviewUri(screenCssPath).toString();
    }

    // --- HTML テンプレート読み込み ---
    const screenFiles: Record<string, string> = {
      s01: "s01-connection.html",    // 初回接続画面
      s02: "s02-main.html",          // メイン画面
      s03: "s03-advice-detail.html", // アドバイス詳細
      s04: "s04-context-check.html", // 送信範囲確認
      s05: "s05-knowledge.html",     // ナレッジ管理
      s06: "s06-settings.html",      // 設定
      s07: "s07-error.html",         // エラー画面
    };

    const htmlFile = screenFiles[this._currentScreen] ?? "s01-connection.html";
    const htmlPath = path.join(this.extensionUri.fsPath, "src", "views", "screens", htmlFile);
    let html = fs.readFileSync(htmlPath, "utf8");

    // --- コンテキスト情報 ---
    const activeFilePath = state.contextPreview.activeFilePath;
    const activeFileRef = activeFilePath
      ? `${this.escapeHtml(activeFilePath)}`
      : "none";
    const diagnosticsCount = state.contextPreview.diagnosticsSummary.length;
    const diagnosticsRef = diagnosticsCount > 0
      ? `警告 ${diagnosticsCount}件`
      : "警告 なし";
    const connectionLabel = state.connectionState === "connected" ? "接続済み" : state.connectionState;
    const statusDotClass = state.connectionState === "connected" ? "" : "disconnected";

    // --- プレースホルダー置換 ---
    html = html
      // CSS
      .replace("{{commonCssUri}}", commonCssUri)
      .replace("{{screenCssUri}}", screenCssUri)
      // 旧CSSプレースホルダー（s03, s07用の後方互換）
      .replace("{{cssUri}}", commonCssUri)
      // 接続状態
      .replace("{{connectionState}}", this.escapeHtml(state.connectionState))
      .replace("{{connectionLabel}}", this.escapeHtml(connectionLabel))
      .replace("{{statusDotClass}}", statusDotClass)
      // メッセージ
      .replace("{{errorMessage}}", this.escapeHtml(state.statusMessage))
      .replace("{{statusMessage}}", this.escapeHtml(state.statusMessage))
      // モード
      .replace("{{mode}}", this.escapeHtml(mode))
      .replace("{{modeManualActive}}", mode === "manual" ? "active" : "")
      .replace("{{modeAlwaysActive}}", mode === "always" ? "active" : "")
      .replace("{{modeManualSelected}}", mode === "manual" ? "selected" : "")
      .replace("{{modeAlwaysSelected}}", mode === "always" ? "selected" : "")
      // 参照文脈
      .replace("{{activeFileRef}}", activeFileRef)
      .replace("{{diagnosticsRef}}", diagnosticsRef)
      // 送信範囲
      .replace("{{targetFilesList}}", "")    // 動的生成予定
      .replace("{{estimatedSize}}", "")       // 動的生成予定
      // ナレッジ
      .replace("{{knowledgeList}}", "")       // 動的生成予定
      // 設定デフォルト値
      .replace("{{requestIntervalSec}}", "60")
      .replace("{{requestIntervalSec}}", "60")
      .replace("{{idleDelaySec}}", "13")
      .replace("{{idleDelaySec}}", "13")
      .replace("{{suppressDuplicateChecked}}", "")
      .replace("{{alwaysModeChecked}}", "")
      .replace("{{excludeGlobs}}", "**/.env\n**/node_modules/**\n**/dist/**\n**/build/**")
      // コンテキストサマリ（旧形式の後方互換）
      .replace("{{contextSummary}}", "");

    return html;
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