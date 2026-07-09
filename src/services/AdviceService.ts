import * as vscode from "vscode";
import {
  AdviceMode,
  AssistanceDepth,
  ConnectionState,
  ConversationEntry,
  GuidanceContext,
  GuidanceKind,
  NavigatorContextPreview,
  RequestPlanSnapshot,
  SlashCommand,
  SlashCommandScope
} from "../shared/types";
import { ConnectedProviderModel, ConnectionService, ProviderTextResponse } from "./ConnectionService";
import { LmStudioError } from "./LmStudioClient";
import { deriveModelProfile } from "./ModelProfile";
import { buildGuidancePrompt, formatReferencedFileReason } from "./PromptBuilder";
import type { KnowledgeRecord } from "./KnowledgeStore";
import type { UsageMeter } from "./UsageMeter";

export interface GuidanceRequestSuccess {
  ok: true;
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface GuidanceRequestFailure {
  ok: false;
  connectionState: ConnectionState;
  message: string;
  cancelled?: boolean;
}

export type GuidanceRequestResult = GuidanceRequestSuccess | GuidanceRequestFailure;

export interface GuidanceRequestInput {
  context: GuidanceContext;
  kind: GuidanceKind;
  userPrompt?: string;
  assistanceDepth?: AssistanceDepth;
  slashCommand?: SlashCommand;
  slashCommandScope?: SlashCommandScope;
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
  public constructor(
    private readonly connectionService: ConnectionService,
    private readonly usageMeter?: UsageMeter
  ) {}

  public async requestGuidance(
    input: GuidanceRequestInput,
    cancellationToken?: vscode.CancellationToken
  ): Promise<GuidanceRequestResult> {
    return this.requestText(this.buildPrompt(input), cancellationToken);
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

  private async requestText(
    prompt: string,
    cancellationToken?: vscode.CancellationToken
  ): Promise<GuidanceRequestResult> {
    const model = this.connectionService.getConnectedModel();

    if (!model || this.connectionService.getState() !== "connected") {
      return {
        ok: false,
        connectionState: "disconnected",
        message: "Copilot に接続されていません。先に接続してください。"
      };
    }

    try {
      const tokenSource = cancellationToken ? undefined : new vscode.CancellationTokenSource();
      const token = cancellationToken ?? tokenSource!.token;
      let response: ProviderTextResponse;
      try {
        response = await model.requestText(prompt, token);
      } finally {
        tokenSource?.dispose();
      }

      if (token.isCancellationRequested) {
        return this.cancelledResult();
      }

      const usage = await this.recordUsage(model, prompt, response);

      return {
        ok: true,
        text: response.text,
        usage
      };
    } catch (error) {
      if (this.isCancellation(error, cancellationToken)) {
        return this.cancelledResult();
      }

      const connectionState = this.classifyGuidanceError(error);

      if (connectionState === "restricted") {
        this.connectionService.markRestricted();
      } else if (connectionState === "disconnected") {
        this.connectionService.resetToDisconnected();
      } else if (model.providerId === "lmStudio") {
        this.connectionService.markUnavailable();
      }

      return {
        ok: false,
        connectionState,
        message: this.errorMessage(error)
      };
    }
  }

  private cancelledResult(): GuidanceRequestFailure {
    return {
      ok: false,
      connectionState: this.connectionService.getState(),
      message: "回答生成を中断しました。",
      cancelled: true
    };
  }

  private isCancellation(error: unknown, cancellationToken?: vscode.CancellationToken): boolean {
    if (cancellationToken?.isCancellationRequested) {
      return true;
    }

    if (error instanceof vscode.CancellationError) {
      return true;
    }

    if (error instanceof Error) {
      return error.name === "AbortError";
    }

    return false;
  }

  private async recordUsage(
    model: ConnectedProviderModel,
    prompt: string,
    response: ProviderTextResponse
  ): Promise<{ inputTokens: number; outputTokens: number } | undefined> {
    if (!this.usageMeter) {
      return undefined;
    }

    const [inputTokens, outputTokens] = response.inputTokens !== undefined && response.outputTokens !== undefined
      ? [response.inputTokens, response.outputTokens]
      : await Promise.all([
          this.countTokensSafe(model, prompt),
          this.countTokensSafe(model, response.text)
        ]);
    await this.usageMeter.record({
      providerId: model.providerId,
      modelId: model.modelId,
      inputTokens,
      outputTokens
    });
    return { inputTokens, outputTokens };
  }

  private async countTokensSafe(model: ConnectedProviderModel, text: string): Promise<number> {
    if (!text) {
      return 0;
    }

    try {
      return model.countTokens ? await model.countTokens(text) : Math.ceil(text.length / 3);
    } catch {
      // 日本語とコードの混在を想定した粗い推定
      return Math.ceil(text.length / 3);
    }
  }

  private buildPrompt(input: GuidanceRequestInput): string {
    // プロンプト組み立ては純粋ロジック（PromptBuilder）に委譲する（評価ハーネスから直接計測可能）。
    return buildGuidancePrompt({
      ...input,
      modelProfile: deriveModelProfile(this.connectionService.getModel())
    });
  }

  private buildConversationTitlePrompt(input: ConversationTitleInput): string {
    const entries = input.entries
      .filter((entry) => entry.text.trim().length > 0)
      .slice(-10);
    const lines: string[] = [
      // ペアプログラミングの相談履歴に名前を付けています。
      "You are naming a pair-programming consultation history.",
      // 会話を短い日本語のタイトル1つに要約してください。
      "Summarize the conversation into one short Japanese title.",
      // タイトルのみを返してください。引用符・ラベル・箇条書き・Markdown・句読点は使わないでください。
      "Return only the title. Do not use quotes, labels, bullets, markdown, or punctuation.",
      // 可能なら日本語30文字以内に収めてください。
      "Keep it within 30 Japanese characters when possible.",
      "",
      // ## 会話
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
      // あなたはペアプログラミング支援のためのナレッジ整理担当です。
      "You are a knowledge curator for a pair-programming assistant.",
      // 保存対象のアシスタント回答と前後の会話から、再利用しやすいナレッジを日本語で作成してください。
      "Create a reusable knowledge entry in Japanese from the saved assistant answer and the surrounding conversation.",
      // アシスタントの回答をそのまま保存しないでください。何が起きて、何が問題で、何が解決につながったかを再構成してください。
      "Do not save the assistant answer verbatim. Reconstruct what happened, what was problematic, and what solved it.",
      // 一度きりの言い回しよりも、長く役立つ教訓や判断ポイントを優先してください。
      "Prefer durable lessons and decision points over one-off wording.",
      // JSON オブジェクトのみを返してください。Markdown のコードフェンスで囲まないでください。
      "Return only a JSON object. Do not wrap it in Markdown fences.",
      "",
      // 必須の JSON 形:
      "Required JSON shape:",
      // {"title":"60文字以内","summary":"160文字以内","body":"Markdown本文"}
      `{"title":"<= 60 Japanese chars","summary":"<= 160 Japanese chars","body":"Markdown body"}`,
      "",
      // body には次の日本語見出しをそのまま使ってください（ナレッジ画面にこの見出しで表示されます）:
      "The body must use these Japanese section headers verbatim (they are displayed as-is in the knowledge view):",
      "## 流れ",
      "## 問題点",
      "## 解決方法・要点",
      "## 次に見るポイント",
      "",
      // ## 保存対象の回答
      "## Answer to be saved",
      `kind: ${source.kind}`,
      `mode: ${source.mode ?? "manual"}`,
      `createdAt: ${source.createdAt}`,
      "```markdown",
      this.truncate(source.text, 5000),
      "```"
    ];

    const contextLines = this.buildKnowledgeContextLines(source);
    if (contextLines.length > 0) {
      // ## 参照文脈
      lines.push("", "## Reference context", ...contextLines);
    }

    if (input.conversation.length > 0) {
      // ## 前後の会話
      lines.push("", "## Surrounding conversation");
      for (const entry of input.conversation) {
        // 保存対象 / 周辺
        const marker = entry.id === source.id ? "target" : "surrounding";
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
      // この情報から、後で同じ種類の問題に遭遇したときに再利用しやすいナレッジを作ってください。
      "From this information, create knowledge that is easy to reuse when the same kind of problem is encountered later."
    );

    return lines.join("\n");
  }

  private buildKnowledgeContextLines(source: KnowledgeDraftSource): string[] {
    const lines: string[] = [];
    const context = source.context;
    const basedOn = source.basedOn;

    if (context?.activeFilePath ?? basedOn?.activeFilePath) {
      // - ファイル:
      lines.push(`- file: ${context?.activeFilePath ?? basedOn?.activeFilePath}`);
    }

    if (context?.activeFileLanguage) {
      // - 言語:
      lines.push(`- language: ${context.activeFileLanguage}`);
    }

    if (context?.selectedText) {
      // - 選択された箇所:
      lines.push("- Selected location:", "```", this.truncate(context.selectedText, 3000), "```");
    } else if (basedOn?.selectedTextPreview) {
      // - 選択された箇所:
      lines.push("- Selected location:", "```", basedOn.selectedTextPreview, "```");
    } else if (context?.activeFileExcerpt) {
      // - アクティブファイル断片:
      lines.push("- Active file excerpt:", "```", this.truncate(context.activeFileExcerpt, 3000), "```");
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
      // - 最近の編集:
      lines.push("- Recent edits:", ...context.recentEditsSummary.slice(0, 8).map((item) => `  - ${item}`));
    }

    if (context?.relatedSymbols.length) {
      // - 関連シンボル:
      lines.push(`- Related symbols: ${context.relatedSymbols.slice(0, 12).join(", ")}`);
    }

    if (context?.workspaceTree?.treeText) {
      // - ディレクトリ構造:
      lines.push("- Directory structure:", "```text", this.truncate(context.workspaceTree.treeText, 1600), "```");
    }

    if (context?.referencedFiles?.length) {
      // - 関連ファイル:
      lines.push("- Related files:");
      for (const file of context.referencedFiles.slice(0, 5)) {
        lines.push(`  - ${file.path} (${formatReferencedFileReason(file.reason)})`);
        if (file.excerpt) {
          lines.push("```", this.truncate(file.excerpt, 1200), "```");
        }
      }
    }

    if (context?.additionalContext) {
      // - 追加コンテキスト:
      lines.push("- Additional context:", "```", this.truncate(context.additionalContext, 3000), "```");
    }

    const includedCategories = source.requestPlan?.categories
      .filter((category) => category.included)
      .map((category) => category.label);
    if (includedCategories?.length) {
      // - 参照カテゴリ:
      lines.push(`- Reference categories: ${includedCategories.join(", ")}`);
    }

    const includedFiles = source.requestPlan?.targetFiles
      .filter((file) => file.included)
      .map((file) => file.path)
      .slice(0, 6);
    if (includedFiles?.length) {
      // - 参照ファイル:
      lines.push("- Reference files:", ...includedFiles.map((file) => `  - ${file}`));
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
    if (error instanceof LmStudioError) {
      return "unavailable";
    }
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
    if (error instanceof LmStudioError) {
      switch (error.kind) {
        case "auth":
          return "LM Studio の API トークンを確認してください。";
        case "unreachable":
          return "LM Studio サーバーに接続できません。起動状態を確認してください。";
        case "timeout":
          return "LM Studio の応答がタイムアウトしました。";
        default:
          return "LM Studio へのリクエストに失敗しました。";
      }
    }
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
