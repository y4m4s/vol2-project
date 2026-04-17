import * as vscode from "vscode";
import { ConnectionState, GuidanceContext } from "../shared/types";
import { ConnectionService } from "./ConnectionService";

export interface GuidanceRequestSuccess {
  ok: true;
  text: string;
}

export interface GuidanceRequestFailure {
  ok: false;
  connectionState: ConnectionState;
  message: string;
}

export type GuidanceRequestResult = GuidanceRequestSuccess | GuidanceRequestFailure;

export class AdviceService {
  public constructor(private readonly connectionService: ConnectionService) {}

  public async requestManualGuidance(context: GuidanceContext): Promise<GuidanceRequestResult> {
    const model = this.connectionService.getModel();

    if (!model || this.connectionService.getState() !== "connected") {
      return {
        ok: false,
        connectionState: "disconnected",
        message: "Copilot に接続されていません。先に接続してください。"
      };
    }

    try {
      const tokenSource = new vscode.CancellationTokenSource();
      const messages = [vscode.LanguageModelChatMessage.User(this.buildPrompt(context))];
      const response = await model.sendRequest(messages, {}, tokenSource.token);

      let text = "";
      for await (const chunk of response.text) {
        text += chunk;
      }

      return {
        ok: true,
        text
      };
    } catch (error) {
      const connectionState = this.classifyGuidanceError(error);

      if (connectionState === "restricted") {
        this.connectionService.markRestricted();
      } else if (connectionState === "disconnected") {
        this.connectionService.resetToDisconnected();
      }

      return {
        ok: false,
        connectionState,
        message: this.errorMessage(error)
      };
    }
  }

  private buildPrompt(context: GuidanceContext): string {
    const lines: string[] = [
      "You are a pair programming navigator.",
      "Your role is to support the user's learning, not to give direct answers or write code for them.",
      "Focus on perspectives, next checks, debugging hints, and questions the user should ask themselves.",
      "Do not perform actions. Do not output code unless it is strictly necessary for explanation.",
      "Respond in Japanese. Keep the response concise and practical.",
      "",
      "## 現在の作業文脈"
    ];

    if (context.activeFilePath) {
      lines.push(`ファイル: ${context.activeFilePath}`);
    } else {
      lines.push("ファイル: なし");
    }

    if (context.activeFileLanguage) {
      lines.push(`言語: ${context.activeFileLanguage}`);
    }

    if (context.selectedText) {
      lines.push("", "選択テキスト:", "```", context.selectedText, "```");
    } else if (context.activeFileExcerpt) {
      lines.push("", "アクティブファイル断片:", "```", context.activeFileExcerpt, "```");
    }

    if (context.diagnosticsSummary.length > 0) {
      lines.push("", "Diagnostics:");
      for (const diagnostic of context.diagnosticsSummary) {
        const source = diagnostic.source ? ` (${diagnostic.source})` : "";
        lines.push(`- ${diagnostic.severity}${source} L${diagnostic.line}: ${diagnostic.message}`);
      }
    }

    lines.push(
      "",
      "ユーザーが相談したいことがあります。現在の作業文脈を踏まえ、考え方の観点や次に確認すべきポイントを提示してください。"
    );

    return lines.join("\n");
  }

  private classifyGuidanceError(error: unknown): ConnectionState {
    if (error instanceof vscode.LanguageModelError) {
      if (error.code === "Blocked" || error.code === "NoPermissions") {
        return "restricted";
      }
    }

    return "restricted";
  }

  private errorMessage(error: unknown): string {
    if (error instanceof vscode.LanguageModelError) {
      return `リクエストに失敗しました: ${error.message}`;
    }

    return "予期しないエラーが発生しました。再試行してください。";
  }
}
