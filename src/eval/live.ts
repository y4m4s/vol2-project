import * as vscode from "vscode";
import type { ConnectionService } from "../services/ConnectionService";
import { deriveModelProfile } from "../services/ModelProfile";
import { SCENARIOS } from "./fixtures";
import { formatReport, runLive, type Responder } from "./runner";

/**
 * 評価ハーネスのライブモード配線（開発者専用）。
 *
 * static モードと違い、組み立て済みプロンプトを実際に接続中のモデルへ送り、その応答を
 * responseChecks で検査する。vscode.lm を使うため拡張機能ホスト内でしか動かない。
 *
 * - 開発者がコマンドから手動で実行するもの。ユーザーの質問では一切走らない。
 * - 実モデルを呼ぶためクレジットを消費する（responseChecks を持つシナリオの数だけ）。
 * - AdviceService を経由せず sendRequest を直接呼ぶため、UsageMeter（ユーザー向け使用量表示）
 *   には記録されない。開発時のテスト消費を日次集計に混ぜないための意図的な分離。
 */

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  return (outputChannel ??= vscode.window.createOutputChannel("NaviCom Eval"));
}

// 接続中のモデルへプロンプトを送り、応答テキストを返す responder。
export function createModelResponder(connectionService: ConnectionService): Responder {
  return async (prompt) => {
    const model = connectionService.getModel();
    if (!model || connectionService.getState() !== "connected") {
      throw new Error("Copilot に接続されていません。");
    }

    const tokenSource = new vscode.CancellationTokenSource();
    try {
      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const response = await model.sendRequest(messages, {}, tokenSource.token);
      let text = "";
      for await (const chunk of response.text) {
        text += chunk;
      }
      return text;
    } finally {
      tokenSource.dispose();
    }
  };
}

// コマンドの実体。出力パネルへレポートを書き出す。
export async function runEvalLiveCommand(connectionService: ConnectionService): Promise<void> {
  const channel = getOutputChannel();
  channel.show(true);
  channel.appendLine("");
  channel.appendLine(`# NaviCom Prompt Evals (Live) — ${new Date().toISOString()}`);

  const model = connectionService.getModel();
  if (!model || connectionService.getState() !== "connected") {
    channel.appendLine("Copilot に接続されていません。先に接続してから再実行してください。");
    void vscode.window.showWarningMessage("NaviCom: 先に Copilot へ接続してください。");
    return;
  }

  const profile = deriveModelProfile(model);
  channel.appendLine(`model: ${model.name || model.family || model.id}`);
  channel.appendLine(`profile: delimiter=${profile.delimiter}, contextBudget=${profile.contextBudget}, terse=${profile.terse}`);
  channel.appendLine("");

  try {
    const report = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "NaviCom: プロンプト評価（ライブ）を実行中…" },
      () => runLive(SCENARIOS, createModelResponder(connectionService), profile)
    );
    channel.appendLine(formatReport(report));
    void vscode.window.showInformationMessage(
      `NaviCom Eval (Live): ${report.passed}/${report.total} passed`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    channel.appendLine(`実行に失敗しました: ${message}`);
    void vscode.window.showErrorMessage(`NaviCom Eval (Live) に失敗しました: ${message}`);
  }
}
