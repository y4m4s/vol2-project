import * as vscode from "vscode";
import {
  AdviceMode,
  ConnectionState,
  ConversationEntry,
  GuidanceContext,
  GuidanceKind,
  NavigatorContextPreview,
  RequestPlanSnapshot
} from "../shared/types";
import { ConnectionService } from "./ConnectionService";
import type { KnowledgeRecord } from "./KnowledgeStore";

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
  knowledgeItems?: KnowledgeRecord[];
}

export interface KnowledgeDraft {
  title: string;
  summary: string;
  body: string;
}

export interface KnowledgeDraftSource {
  id: string;
  text: string;
  kind: GuidanceKind;
  createdAt: string;
  mode?: AdviceMode;
  basedOn?: NavigatorContextPreview;
  context?: GuidanceContext;
  requestPlan?: RequestPlanSnapshot;
}

export interface KnowledgeDraftInput {
  source: KnowledgeDraftSource;
  conversation: ConversationEntry[];
}

export type KnowledgeDraftResult =
  | { ok: true; draft: KnowledgeDraft }
  | GuidanceRequestFailure;

export interface ConversationTitleInput {
  entries: ConversationEntry[];
}

export class AdviceService {
  public constructor(private readonly connectionService: ConnectionService) {}

  public async requestGuidance(input: GuidanceRequestInput): Promise<GuidanceRequestResult> {
    return this.requestText(this.buildPrompt(input));
  }

  public async createKnowledgeDraft(input: KnowledgeDraftInput): Promise<KnowledgeDraftResult> {
    const result = await this.requestText(this.buildKnowledgePrompt(input));
    if (!result.ok) {
      return result;
    }

    const draft = this.parseKnowledgeDraftResponse(result.text);
    if (!draft) {
      return {
        ok: false,
        connectionState: this.connectionService.getState(),
        message: "Copilot の応答をナレッジ形式に変換できませんでした。もう一度保存を試してください。"
      };
    }

    return {
      ok: true,
      draft
    };
  }

  public async createConversationTitle(input: ConversationTitleInput): Promise<string | undefined> {
    if (input.entries.every((entry) => entry.text.trim().length === 0)) {
      return undefined;
    }

    const result = await this.requestText(this.buildConversationTitlePrompt(input));
    if (!result.ok) {
      return undefined;
    }

    return this.normalizeConversationTitle(result.text);
  }

  private async requestText(prompt: string): Promise<GuidanceRequestResult> {
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
      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
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
    const { context, kind, userPrompt, knowledgeItems } = input;
    const lines: string[] = [
      "You are a pair programming navigator.",
      "Your default goal is to help the user think and move forward on their own.",
      "",
      "Rules:",
      "- For implementation or debugging requests, do not state complete solutions or fixes. Guide the user to discover them.",
      "- If the user asks about the contents, requirements, constraints, input/output, or meaning of the additional context, answer directly from the additional context.",
      "- If the additional context looks like a coding test or problem statement, treat questions about 'the problem' as questions about that additional context.",
      "- Do not drift into active-file code advice when the user's question is about the additional context itself.",
      "- Ignore noise from in-progress editing: unclosed braces, incomplete expressions, half-typed lines. These are not issues.",
      "- Do not use commanding or declarative language ('Fix this', 'This is wrong', 'You should...').",
      "- Do not output code unless the user explicitly asks for code.",
      "- Point to specific locations, functions, variables, or logic flows to direct the user's attention.",
      "- Write in a way that naturally leads the user to their next action — without prescribing exact wording or phrasing patterns.",
      "- Respond in Japanese. Be concise. Use 2–4 short points.",
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

    if (context.additionalContext) {
      lines.push("", "追加コンテキスト:", "```", context.additionalContext, "```");
    }

    if (knowledgeItems && knowledgeItems.length > 0) {
      lines.push("", "## 再利用する個人ナレッジ");
      for (const item of knowledgeItems) {
        lines.push(`- ${item.title}: ${item.summary}`);
      }
      lines.push("これらは過去の学びとして参考にし、現在の文脈に合う場合だけ控えめに活用してください。");
    }

    if (userPrompt?.trim()) {
      lines.push("", "## ユーザーからの相談", userPrompt.trim());
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
        return "ユーザーが質問しています。追加コンテキストの問題文・要件・制約・入出力・意味について尋ねている場合は、追加コンテキストを最優先にして直接説明してください。実装やデバッグの相談では、着目すべき場所・処理・関係性を示して、ユーザー自身が手を動かして確かめられるよう誘導してください。";
      case "always":
        return "今の編集の流れを見て、見落としやすい設計上の懸念・壊れやすい境界・次に影響が出そうな箇所があれば、それだけを短く指し示してください。書きかけのコードや構文の不完全さには触れないでください。何も気になる点がなければ何も返さないでください。";
      case "context":
      default:
        return "ユーザーが選択箇所について相談しています。その箇所の周辺で注目すべき処理・依存関係・データの流れを指し示して、ユーザー自身が原因や改善点にたどり着けるよう誘導してください。";
    }
  }

  private buildConversationTitlePrompt(input: ConversationTitleInput): string {
    const entries = input.entries
      .filter((entry) => entry.text.trim().length > 0)
      .slice(-10);
    const lines: string[] = [
      "You are naming a pair-programming consultation history.",
      "Summarize the conversation into one short Japanese title.",
      "Return only the title. Do not use quotes, labels, bullets, markdown, or punctuation.",
      "Keep it within 30 Japanese characters when possible.",
      "",
      "## Conversation"
    ];

    entries.forEach((entry, index) => {
      lines.push(
        `### ${index + 1}. ${entry.role} / ${entry.kind} / ${entry.createdAt}`,
        "```markdown",
        this.truncate(entry.text, 1200),
        "```"
      );
    });

    return lines.join("\n");
  }

  private normalizeConversationTitle(text: string): string | undefined {
    const firstLine = text
      .trim()
      .replace(/^```(?:text|markdown)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/^#{1,6}\s+/, "")
          .replace(/^[-*+]\s+/, "")
          .replace(/^(title|タイトル)\s*[:：]\s*/i, "")
          .trim()
      )
      .find((line) => line.length > 0);

    if (!firstLine) {
      return undefined;
    }

    const title = firstLine
      .replace(/^["'「『“”]+/, "")
      .replace(/["'」』“”]+$/, "")
      .replace(/[。.]$/, "");

    return this.normalizeLine(title, 40) || undefined;
  }

  private buildKnowledgePrompt(input: KnowledgeDraftInput): string {
    const { source } = input;
    const lines: string[] = [
      "You are a knowledge curator for a pair-programming assistant.",
      "Create a reusable knowledge entry in Japanese from the saved assistant answer and the surrounding conversation.",
      "Do not save the assistant answer verbatim. Reconstruct what happened, what was problematic, and what solved it.",
      "Prefer durable lessons and decision points over one-off wording.",
      "Return only a JSON object. Do not wrap it in Markdown fences.",
      "",
      "Required JSON shape:",
      `{"title":"60文字以内","summary":"160文字以内","body":"Markdown本文"}`,
      "",
      "The body must use these sections:",
      "## 流れ",
      "## 問題点",
      "## 解決方法・要点",
      "## 次に見るポイント",
      "",
      "## 保存対象の回答",
      `kind: ${source.kind}`,
      `mode: ${source.mode ?? "manual"}`,
      `createdAt: ${source.createdAt}`,
      "```markdown",
      this.truncate(source.text, 5000),
      "```"
    ];

    const contextLines = this.buildKnowledgeContextLines(source);
    if (contextLines.length > 0) {
      lines.push("", "## 参照文脈", ...contextLines);
    }

    if (input.conversation.length > 0) {
      lines.push("", "## 前後の会話");
      for (const entry of input.conversation) {
        const marker = entry.id === source.id ? "保存対象" : "周辺";
        lines.push(
          `### ${marker}: ${entry.role} / ${entry.kind} / ${entry.createdAt}`,
          "```markdown",
          this.truncate(entry.text, 1800),
          "```"
        );
      }
    }

    lines.push(
      "",
      "この情報から、後で同じ種類の問題に遭遇したときに再利用しやすいナレッジを作ってください。"
    );

    return lines.join("\n");
  }

  private buildKnowledgeContextLines(source: KnowledgeDraftSource): string[] {
    const lines: string[] = [];
    const context = source.context;
    const basedOn = source.basedOn;

    if (context?.activeFilePath ?? basedOn?.activeFilePath) {
      lines.push(`- ファイル: ${context?.activeFilePath ?? basedOn?.activeFilePath}`);
    }

    if (context?.activeFileLanguage) {
      lines.push(`- 言語: ${context.activeFileLanguage}`);
    }

    if (context?.selectedText) {
      lines.push("- 選択された箇所:", "```", this.truncate(context.selectedText, 3000), "```");
    } else if (basedOn?.selectedTextPreview) {
      lines.push("- 選択された箇所:", "```", basedOn.selectedTextPreview, "```");
    } else if (context?.activeFileExcerpt) {
      lines.push("- アクティブファイル断片:", "```", this.truncate(context.activeFileExcerpt, 3000), "```");
    }

    const diagnostics = context?.diagnosticsSummary.length
      ? context.diagnosticsSummary
      : basedOn?.diagnosticsSummary ?? [];
    if (diagnostics.length > 0) {
      lines.push("- Diagnostics:");
      for (const diagnostic of diagnostics) {
        const sourceLabel = diagnostic.source ? ` (${diagnostic.source})` : "";
        lines.push(`  - ${diagnostic.severity}${sourceLabel} L${diagnostic.line}: ${diagnostic.message}`);
      }
    }

    if (context?.recentEditsSummary.length) {
      lines.push("- 最近の編集:", ...context.recentEditsSummary.slice(0, 8).map((item) => `  - ${item}`));
    }

    if (context?.relatedSymbols.length) {
      lines.push(`- 関連シンボル: ${context.relatedSymbols.slice(0, 12).join(", ")}`);
    }

    if (context?.additionalContext) {
      lines.push("- 追加コンテキスト:", "```", this.truncate(context.additionalContext, 3000), "```");
    }

    const includedCategories = source.requestPlan?.categories
      .filter((category) => category.included)
      .map((category) => category.label);
    if (includedCategories?.length) {
      lines.push(`- 参照カテゴリ: ${includedCategories.join(", ")}`);
    }

    const includedFiles = source.requestPlan?.targetFiles
      .filter((file) => file.included)
      .map((file) => file.path)
      .slice(0, 6);
    if (includedFiles?.length) {
      lines.push("- 参照ファイル:", ...includedFiles.map((file) => `  - ${file}`));
    }

    return lines;
  }

  private parseKnowledgeDraftResponse(text: string): KnowledgeDraft | undefined {
    for (const candidate of this.getJsonCandidates(text)) {
      try {
        const parsed = JSON.parse(candidate);
        const draft = this.normalizeKnowledgeDraft(parsed);
        if (draft) {
          return draft;
        }
      } catch {
        // Try the next candidate.
      }
    }

    return this.createMarkdownKnowledgeDraft(text);
  }

  private getJsonCandidates(text: string): string[] {
    const candidates = new Set<string>();
    const trimmed = text.trim();
    if (trimmed) {
      candidates.add(trimmed);
    }

    const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    if (fenceMatch?.[1].trim()) {
      candidates.add(fenceMatch[1].trim());
    }

    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.add(trimmed.slice(firstBrace, lastBrace + 1));
    }

    return [...candidates];
  }

  private normalizeKnowledgeDraft(value: unknown): KnowledgeDraft | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const title = this.normalizeLine(record.title, 80);
    const summary = this.normalizeLine(record.summary, 180);
    const body = typeof record.body === "string" ? record.body.trim() : "";

    if (!title || !summary || !body) {
      return undefined;
    }

    return {
      title,
      summary,
      body
    };
  }

  private createMarkdownKnowledgeDraft(text: string): KnowledgeDraft | undefined {
    const body = text.trim().replace(/^```(?:markdown)?\s*/i, "").replace(/```\s*$/i, "").trim();
    if (!body) {
      return undefined;
    }

    const firstMeaningfulLine = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "ナレッジ";
    const title = this.normalizeLine(firstMeaningfulLine.replace(/^#+\s*/, ""), 80) || "ナレッジ";
    const summarySource =
      body
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*+]\s*/, "").replace(/^#+\s*/, "").trim())
        .find((line) => line.length > 0 && line !== firstMeaningfulLine) ?? body;

    return {
      title,
      summary: this.normalizeLine(summarySource, 180) || title,
      body
    };
  }

  private normalizeLine(value: unknown, maxLength: number): string {
    if (typeof value !== "string") {
      return "";
    }

    const normalized = value.replace(/\s+/g, " ").trim();
    return this.truncate(normalized, maxLength);
  }

  private truncate(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
  }

  private classifyGuidanceError(error: unknown): ConnectionState {
    if (error instanceof vscode.LanguageModelError) {
      if (error.code === "Blocked" || error.code === "NoPermissions") {
        return "restricted";
      }
      if (error.code === "NotFound" || error.code === "Unavailable") {
        return "unavailable";
      }
    }

    return "disconnected";
  }

  private errorMessage(error: unknown): string {
    if (error instanceof vscode.LanguageModelError) {
      if (error.code === "Blocked") {
        return "Copilot にブロックされました。利用上限に達したか、ポリシーで制限されています。";
      }
      if (error.code === "NoPermissions") {
        return "Copilot の利用権限がありません。サブスクリプションを確認してください。";
      }
      return `Copilot リクエストに失敗しました: ${error.message}`;
    }

    return "予期しないエラーが発生しました。再試行してください。";
  }
}
