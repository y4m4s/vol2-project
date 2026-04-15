import * as vscode from "vscode";
import { AdviceMode, ConnectionState, NavigatorContextSnapshot } from "../shared/types";

export class CopilotService {
  private connectionState: ConnectionState = "disconnected";
  private model: vscode.LanguageModelChat | undefined;

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  public async connect(): Promise<ConnectionState> {
    if (!vscode.workspace.isTrusted) {
      this.connectionState = "unavailable";
      return this.connectionState;
    }

    this.connectionState = "connecting";

    try {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });

      if (models.length === 0) {
        this.connectionState = "unavailable";
        return this.connectionState;
      }

      this.model = models[0];
      this.connectionState = "consent_pending";

      // 初回リクエストで VS Code / Copilot の同意フローを通す。
      await this.runProbe();

      this.connectionState = "connected";
    } catch (error) {
      this.model = undefined;
      this.connectionState = this.classifyConnectError(error);
    }

    return this.connectionState;
  }

  public async requestGuidance(
    context: NavigatorContextSnapshot,
    mode: AdviceMode,
    relevantKnowledge: string[] = []
  ): Promise<string> {
    if (!this.model) {
      return "Copilot に接続されていません。先に接続してください。";
    }

    const prompt = this.buildPrompt(context, mode, relevantKnowledge);

    try {
      const tokenSource = new vscode.CancellationTokenSource();
      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const response = await this.model.sendRequest(messages, {}, tokenSource.token);

      let text = "";
      for await (const chunk of response.text) {
        text += chunk;
      }

      return text;
    } catch (error) {
      this.connectionState = this.classifyGuidanceError(error);
      return this.errorMessage(error);
    }
  }

  private async runProbe(): Promise<void> {
    if (!this.model) {
      return;
    }

    const tokenSource = new vscode.CancellationTokenSource();
    const messages = [vscode.LanguageModelChatMessage.User("Respond with exactly: ready")];
    const response = await this.model.sendRequest(messages, {}, tokenSource.token);

    // ストリームを消費して接続を確認する。
    for await (const _ of response.text) {
      /* consume */
    }
  }

  private buildPrompt(
    context: NavigatorContextSnapshot,
    mode: AdviceMode,
    relevantKnowledge: string[]
  ): string {
    const lines: string[] = [
      "You are a pair programming navigator. Your role is to support the user's learning — not to give direct answers or write code.",
      "Focus on: perspectives to consider, what to investigate next, questions the user should ask themselves.",
      "Do not perform any actions. Provide suggestions only.",
      "Respond in Japanese. Keep responses concise and focused.",
      "",
      "## 現在の作業文脈",
    ];

    if (context.activeFilePath) {
      lines.push(`ファイル: ${context.activeFilePath}`);
    } else {
      lines.push("ファイル: なし");
    }

    if (context.selectedText) {
      lines.push("", "選択テキスト:", "```", context.selectedText, "```");
    }

    if (context.diagnosticsSummary.length > 0) {
      lines.push("", "Diagnostics:");
      for (const d of context.diagnosticsSummary) {
        lines.push(`- ${d}`);
      }
    }

    if (context.recentEditsSummary.length > 0) {
      lines.push("", "最近の編集:");
      for (const e of context.recentEditsSummary) {
        lines.push(`- ${e}`);
      }
    }

    if (context.relatedSymbols.length > 0) {
      lines.push("", `関連シンボル: ${context.relatedSymbols.join(", ")}`);
    }

    if (relevantKnowledge.length > 0) {
      lines.push("", "## 過去の学習メモ");
      for (const entry of relevantKnowledge) {
        lines.push(`- ${entry}`);
      }
    }

    lines.push("", this.triggerText(mode));

    return lines.join("\n");
  }

  private triggerText(mode: AdviceMode): string {
    if (mode === "manual") {
      return "ユーザーが相談したいことがあります。現在の作業文脈を踏まえ、考え方の観点や次に確認すべきポイントを提示してください。";
    }
    return "現在のコーディング状況を継続的に観察しています。学習に役立つ観点や気づきがあれば提示してください。特に伝えることがなければ、短く返答してください。";
  }

  private classifyConnectError(error: unknown): ConnectionState {
    if (error instanceof vscode.LanguageModelError && error.code === "NoPermissions") {
      // 同意キャンセル → 未接続に戻す。
      return "disconnected";
    }
    return "unavailable";
  }

  private classifyGuidanceError(error: unknown): ConnectionState {
    if (error instanceof vscode.LanguageModelError) {
      if (error.code === "NoPermissions" || error.code === "Blocked") {
        // quota 超過または一時制限。
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
