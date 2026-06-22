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
    const model = this.connectionService.getConnectedModel();

    if (!model || this.connectionService.getState() !== "connected") {
      return {
        ok: false,
        connectionState: "disconnected",
        message: "Copilot に接続されていません。先に接続してください。"
      };
    }

    try {
      const tokenSource = new vscode.CancellationTokenSource();
      let response: ProviderTextResponse;
      try {
        response = await model.requestText(prompt, tokenSource.token);
      } finally {
        tokenSource.dispose();
      }

      const usage = await this.recordUsage(model, prompt, response);

      return {
        ok: true,
        text: response.text,
        usage
      };
    } catch (error) {
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
    const { context, kind, userPrompt, knowledgeItems, slashCommand, slashCommandScope } = input;
    const assistanceDepth = kind === "always" ? "low" : input.assistanceDepth ?? "low";
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
      "- Do not output implementation code unless the user explicitly asks for code. Mermaid diagrams are allowed for /flow.",
      "- Point to specific locations, functions, variables, or logic flows to direct the user's attention.",
      "- Write in a way that naturally leads the user to their next action without prescribing exact wording or phrasing patterns.",
      "- Respond in Japanese.",
      this.getDepthRule(assistanceDepth, slashCommand),
      "",
      "## 応答設定",
      `深さ: ${assistanceDepth}`,
      slashCommand ? `スラッシュコマンド: /${slashCommand}${slashCommandScope === "deep" ? " deep" : ""}` : "スラッシュコマンド: なし",
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

    if (context.workspaceTree?.treeText) {
      lines.push("", "ディレクトリ構造:", "```text", context.workspaceTree.treeText, "```");
    }

    if (context.referencedFiles.length > 0) {
      lines.push("", "関連ファイル断片:");
      for (const file of context.referencedFiles) {
        lines.push(
          `### ${file.path}`,
          `reason: ${this.formatReferencedFileReason(file.reason)} / score: ${file.score}`
        );

        if (file.diagnosticsSummary.length > 0) {
          lines.push("Diagnostics:");
          for (const diagnostic of file.diagnosticsSummary) {
            const source = diagnostic.source ? ` (${diagnostic.source})` : "";
            lines.push(`- ${diagnostic.severity}${source} L${diagnostic.line}: ${diagnostic.message}`);
          }
        }

        if (file.recentEditsSummary.length > 0) {
          lines.push("最近の編集:", ...file.recentEditsSummary.map((item) => `- ${item}`));
        }

        if (file.excerpt) {
          lines.push("```" + (file.languageId ?? ""), file.excerpt, "```");
        }
      }
    }

    if (context.projectSummary) {
      lines.push("", "## プロジェクト概要", `scope: ${context.projectSummary.scope}`);
      this.pushListSection(lines, "開いているファイル:", context.projectSummary.openFiles);
      this.pushListSection(lines, "ワークスペース診断:", context.projectSummary.diagnosticsSummary);
      this.pushListSection(lines, "最近の編集:", context.projectSummary.recentEditsSummary);
      this.pushListSection(lines, "TODO/FIXME:", context.projectSummary.todoSummary);
      this.pushListSection(lines, "Manifest/設定:", context.projectSummary.manifestSummary);
      this.pushListSection(lines, "Docs:", context.projectSummary.docsSummary);
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

    if (slashCommand) {
      lines.push("", "## スラッシュコマンド指示", this.getSlashCommandInstruction(slashCommand, assistanceDepth, slashCommandScope));
    }

    lines.push(
      "",
      this.getInstructionByKind(kind)
    );

    return lines.join("\n");
  }

  private getDepthRule(depth: AssistanceDepth, slashCommand?: SlashCommand): string {
    // /flow はハイ固定だが、確認手順や注意点ではなくフローの整理だけに集中させる
    if (slashCommand === "flow") {
      return "- Flow mode: focus only on organizing the flow. Do not add checklists, cautions, or next-action sections.";
    }

    if (depth === "high") {
      return "- High mode: give a structured explanation with the next checks, tradeoffs, and boundaries. Keep it compact, but go deeper than hints.";
    }

    return "- Low mode: give short hints and checking points only. Avoid long explanations and avoid jumping to the final answer.";
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

  private formatReferencedFileReason(reason: GuidanceContext["referencedFiles"][number]["reason"]): string {
    switch (reason) {
      case "diagnostic":
        return "diagnostics";
      case "recentEdit":
        return "recent edit";
      case "sameDirectory":
        return "same directory";
      case "workspace":
        return "workspace";
      case "open":
      default:
        return "open file";
    }
  }

  private pushListSection(lines: string[], title: string, values: string[]): void {
    if (values.length === 0) {
      return;
    }

    lines.push(title, ...values.map((value) => `- ${value}`));
  }

  private getSlashCommandInstruction(
    command: SlashCommand,
    depth: AssistanceDepth,
    scope?: SlashCommandScope
  ): string {
    switch (command) {
      case "hint":
        return depth === "high"
          ? "詰まりをほどくために、原因候補を広げすぎず、確認順を3-5個で整理してください。完成した修正案ではなく、ユーザーが次に観察するポイントを中心にしてください。"
          : "詰まりをほどくための短いヒントを2-3個だけ出してください。答えや完成コードは出さず、見る場所と問いを中心にしてください。";
      case "next":
        if (scope === "deep") {
          return "プロジェクト全体を薄く見た前提で、作業の完了確認、未検証のリスク、次に着手する候補、後回しでよいことを根拠つきで短く整理してください。ファイル配置、診断、TODO、docs から読み取れる範囲を優先し、推測しすぎないでください。";
        }

        return depth === "high"
          ? "作業が一区切りついた前提で、送られたプロジェクト概要も使いながら、完了確認、検証、次の実装候補、後回しでよいことを分けて整理してください。命令ではなく、判断材料として提示してください。"
          : "作業が一区切りついた前提で、送られたプロジェクト概要も使いながら、次に確認するとよいことを3個以内で短く提示してください。実行を代行せず、ユーザーが選べる次の一手にしてください。";
      case "flow":
        // /flow は深さ設定に関わらず常にハイとして実行される
        return [
          "現在の文脈から処理やデータの流れを整理してください。",
          "出力は次の2つだけで構成してください: (1) 流れの要点の説明(2〜3行)、(2) Mermaid の flowchart TD コードブロック1つ。",
          "確認手順、注意点、関心箇所の列挙、次のアクションなど、フロー以外のセクションは含めないでください。",
          "コードブロックは必ず ```mermaid で開始してください。",
          'ノードラベルは A["ラベル"] のように必ずダブルクォートで囲み、括弧やコロンなどの記号を含めても構文エラーにならないようにしてください。',
          "図は推測しすぎず、分かる範囲の流れだけを描いてください。"
        ].join("\n");
      case "risk":
        return depth === "high"
          ? "変更や設計の壊れやすい境界、副作用、見落としやすい条件、影響を受けそうな箇所を整理してください。重大度が高そうな順にしてください。"
          : "壊れやすそうな箇所や見落としやすい条件を3個以内で短く示してください。断定しすぎず、確認ポイントとして書いてください。";
      case "test":
        return depth === "high"
          ? "テスト観点を、正常系、境界値、失敗系、回帰確認に分けて整理してください。テストコードは書かず、何を確かめるかに絞ってください。"
          : "今の変更に対して確認するとよいテスト観点を3個以内で短く示してください。テストコードは書かないでください。";
      default:
        return "ユーザーの意図に沿って、学習支援として短く整理してください。";
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

    if (context?.workspaceTree?.treeText) {
      lines.push("- ディレクトリ構造:", "```text", this.truncate(context.workspaceTree.treeText, 1600), "```");
    }

    if (context?.referencedFiles?.length) {
      lines.push("- 関連ファイル:");
      for (const file of context.referencedFiles.slice(0, 5)) {
        lines.push(`  - ${file.path} (${this.formatReferencedFileReason(file.reason)})`);
        if (file.excerpt) {
          lines.push("```", this.truncate(file.excerpt, 1200), "```");
        }
      }
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
