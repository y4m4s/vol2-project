import * as vscode from "vscode";
import { ConnectionState, GuidanceContext, GuidanceKind } from "../shared/types";
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

export interface GuidanceRequestInput {
  context: GuidanceContext;
  kind: GuidanceKind;
  userPrompt?: string;
  previousAssistantText?: string;
}

export class AdviceService {
  public constructor(private readonly connectionService: ConnectionService) {}

  public async requestGuidance(input: GuidanceRequestInput): Promise<GuidanceRequestResult> {
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
      const messages = [vscode.LanguageModelChatMessage.User(this.buildPrompt(input))];
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

  private buildPrompt(input: GuidanceRequestInput): string {
    const { context, kind, userPrompt, previousAssistantText } = input;
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

    if (context.recentEditsSummary.length > 0) {
      lines.push("", "最近の編集:");
      for (const recentEdit of context.recentEditsSummary) {
        lines.push(`- ${recentEdit}`);
      }
    }

    if (context.relatedSymbols.length > 0) {
      lines.push("", `関連シンボル候補: ${context.relatedSymbols.join(", ")}`);
    }

    if (userPrompt?.trim()) {
      lines.push("", "## ユーザーからの相談", userPrompt.trim());
    }

    if (kind === "deep_dive" && previousAssistantText) {
      lines.push("", "## 直前のアドバイス", previousAssistantText);
    }

    lines.push(
      "",
      this.getInstructionByKind(kind)
    );

    return lines.join("\n");
  }

  private getInstructionByKind(kind: GuidanceKind): string {
    switch (kind) {
      case "manual":
        return "ユーザーの質問に答える形で、現在の作業文脈を踏まえた考え方の観点や次に確認すべきポイントを提示してください。";
      case "deep_dive":
        return "直前のアドバイスを踏まえて、より具体的な観点や確認手順を段階的に提示してください。";
      case "always":
        return "現在の編集内容と、与えられた変更前後の差分を見て、今のタイミングで役立つ短いフィードバックを1〜3点だけ返してください。重い説明は避け、確認観点・違和感・変更で壊れやすい箇所・次に見る場所を中心に簡潔に伝えてください。";
      case "context":
      default:
        return "ユーザーが相談したいことがあります。現在の作業文脈を踏まえ、考え方の観点や次に確認すべきポイントを提示してください。";
    }
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
