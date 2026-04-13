import * as vscode from "vscode";
import { NavigatorController } from "../application/NavigatorController";
import { AdviceMode } from "../shared/types";
import * as fs from "fs";
import * as path from "path";

export class NavigatorViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "navigatorView";
  private _view?: vscode.WebviewView;
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
    webviewView.webview.onDidReceiveMessage(async (message:{type:string,}) =>{
      // メッセージの種類によって処理を分岐
      switch(message.type){
        case "connect": //Connectボタンが押されたとき
          await this.controller.connectCopilot(); //Copilotに接続して状態を更新
          await this.refresh("manual"); //画面更新
          return;
        case "ask": //Ask for guidanceボタンが押されたとき
          const guidance = await this.controller.askForGuidance(); //AIにアドバイスを求める
          void vscode.window.showInformationMessage(guidance); //アドバイスをポップアップで表示
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

        // コンテキスト情報を1つの文字列にまとめる
    const contextSummary = [
      state.contextPreview.activeFilePath ? `Active file: ${state.contextPreview.activeFilePath}` : "Active file: none",
      state.contextPreview.selectedText ? `Selection: ${this.escapeHtml(state.contextPreview.selectedText)}` : "Selection: none",
      `Diagnostics: ${state.contextPreview.diagnosticsSummary.length}`
    ].join("<br/>");

    // style.css のパスをWebViewで読める形に変換
    const cssPath = vscode.Uri.joinPath(this.extensionUri, "src", "views", "style.css");
    const cssUri = webview.asWebviewUri(cssPath).toString();

    // index.html をファイルから読み込む
    const htmlPath = path.join(this.extensionUri.fsPath, "src", "views", "index.html");
    let html = fs.readFileSync(htmlPath, "utf8");

    // プレースホルダーを実際の値に置き換える
    html = html
      .replace("{{cssUri}}", cssUri)                                          // CSSのパス
      .replace("{{connectionState}}", this.escapeHtml(state.connectionState)) // 接続状態
      .replace("{{statusMessage}}", this.escapeHtml(state.statusMessage))     // ステータスメッセージ
      .replace("{{mode}}", this.escapeHtml(mode))                             // モード
      .replace("{{contextSummary}}", contextSummary);                         // コンテキスト情報

    return html;
}

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#39;");
  }
}