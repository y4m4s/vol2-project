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
import { ConnectionService } from "./ConnectionService";
import { getSkill } from "../shared/skills";
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

      const usage = await this.recordUsage(model, prompt, text);

      return {
        ok: true,
        text,
        usage
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

  private async recordUsage(
    model: vscode.LanguageModelChat,
    prompt: string,
    responseText: string
  ): Promise<{ inputTokens: number; outputTokens: number } | undefined> {
    if (!this.usageMeter) {
      return undefined;
    }

    const [inputTokens, outputTokens] = await Promise.all([
      this.countTokensSafe(model, prompt),
      this.countTokensSafe(model, responseText)
    ]);
    await this.usageMeter.record({ inputTokens, outputTokens });
    return { inputTokens, outputTokens };
  }

  private async countTokensSafe(model: vscode.LanguageModelChat, text: string): Promise<number> {
    if (!text) {
      return 0;
    }

    try {
      return await model.countTokens(text);
    } catch {
      // 日本語とコードの混在を想定した粗い推定
      return Math.ceil(text.length / 3);
    }
  }

  private buildPrompt(input: GuidanceRequestInput): string {
    const { context, kind, userPrompt, knowledgeItems, slashCommand, slashCommandScope } = input;
    const assistanceDepth = kind === "always" ? "low" : input.assistanceDepth ?? "low";
    const lines: string[] = [
      // あなたはペアプログラミングのナビゲーターです。
      "You are a pair programming navigator.",
      // 既定の目標は、ユーザー自身が考えて前に進めるよう支援することです。
      "Your default goal is to help the user think and move forward on their own.",
      "",
      // ルール:
      "Rules:",
      // 実装やデバッグの依頼では、完全な解決策や修正そのものを述べず、ユーザーが自力で気づけるよう導いてください。
      "- For implementation or debugging requests, do not state complete solutions or fixes. Guide the user to discover them.",
      // 追加コンテキストの内容・要件・制約・入出力・意味について尋ねられたら、追加コンテキストから直接答えてください。
      "- If the user asks about the contents, requirements, constraints, input/output, or meaning of the additional context, answer directly from the additional context.",
      // 追加コンテキストがコーディングテストや問題文に見える場合、「その問題」に関する質問は追加コンテキストへの質問として扱ってください。
      "- If the additional context looks like a coding test or problem statement, treat questions about 'the problem' as questions about that additional context.",
      // ユーザーの質問が追加コンテキスト自体に関するものなら、アクティブファイルのコード助言へ話を逸らさないでください。
      "- Do not drift into active-file code advice when the user's question is about the additional context itself.",
      // 編集途中のノイズ（閉じていない括弧、未完成の式、書きかけの行）は無視してください。これらは問題ではありません。
      "- Ignore noise from in-progress editing: unclosed braces, incomplete expressions, half-typed lines. These are not issues.",
      // 命令的・断定的な言い回し（「これを直して」「これは間違い」「〜すべき」）は使わないでください。
      "- Do not use commanding or declarative language ('Fix this', 'This is wrong', 'You should...').",
      // ユーザーが明示的にコードを求めない限り、実装コードは出力しないでください。/flow では Mermaid 図のみ許可します。
      "- Do not output implementation code unless the user explicitly asks for code. Mermaid diagrams are allowed for /flow.",
      // 具体的な場所・関数・変数・ロジックの流れを示して、ユーザーの注意を向けてください。
      "- Point to specific locations, functions, variables, or logic flows to direct the user's attention.",
      // 正確な言い回しやフレーズの型を指定せず、自然に次の行動へ導く書き方をしてください。
      "- Write in a way that naturally leads the user to their next action without prescribing exact wording or phrasing patterns.",
      // 日本語で回答してください。
      "- Respond in Japanese.",
      this.getDepthRule(assistanceDepth, slashCommand),
      "",
      // ## 応答設定
      "## Response settings",
      // 深さ: <値>
      `depth: ${assistanceDepth}`,
      // スラッシュコマンド: /<コマンド>（指定なしのときは none）
      slashCommand ? `slash command: /${slashCommand}${slashCommandScope === "deep" ? " deep" : ""}` : "slash command: none",
      "",
      // ## 現在の作業文脈
      "## Current working context"
    ];

    if (context.activeFilePath) {
      // ファイル: <パス>
      lines.push(`file: ${context.activeFilePath}`);
    } else {
      // ファイル: なし
      lines.push("file: none");
    }

    if (context.activeFileLanguage) {
      // 言語: <言語>
      lines.push(`language: ${context.activeFileLanguage}`);
    }

    if (context.selectedText) {
      // 選択テキスト:
      lines.push("", "Selected text:", "```", context.selectedText, "```");
    } else if (context.activeFileExcerpt) {
      // アクティブファイル断片:
      lines.push("", "Active file excerpt:", "```", context.activeFileExcerpt, "```");
    }

    if (context.diagnosticsSummary.length > 0) {
      lines.push("", "Diagnostics:");
      for (const diagnostic of context.diagnosticsSummary) {
        const source = diagnostic.source ? ` (${diagnostic.source})` : "";
        lines.push(`- ${diagnostic.severity}${source} L${diagnostic.line}: ${diagnostic.message}`);
      }
    }

    if (context.recentEditsSummary.length > 0) {
      // 最近の編集:
      lines.push("", "Recent edits:");
      for (const recentEdit of context.recentEditsSummary) {
        lines.push(`- ${recentEdit}`);
      }
    }

    if (context.relatedSymbols.length > 0) {
      // 関連シンボル候補: <一覧>
      lines.push("", `Related symbol candidates: ${context.relatedSymbols.join(", ")}`);
    }

    if (context.workspaceTree?.treeText) {
      // ディレクトリ構造:
      lines.push("", "Directory structure:", "```text", context.workspaceTree.treeText, "```");
    }

    if (context.referencedFiles.length > 0) {
      // 関連ファイル断片:
      lines.push("", "Related file excerpts:");
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
          // 最近の編集:
          lines.push("Recent edits:", ...file.recentEditsSummary.map((item) => `- ${item}`));
        }

        if (file.excerpt) {
          lines.push("```" + (file.languageId ?? ""), file.excerpt, "```");
        }
      }
    }

    if (context.projectSummary) {
      // ## プロジェクト概要
      lines.push("", "## Project overview", `scope: ${context.projectSummary.scope}`);
      // 開いているファイル:
      this.pushListSection(lines, "Open files:", context.projectSummary.openFiles);
      // ワークスペース診断:
      this.pushListSection(lines, "Workspace diagnostics:", context.projectSummary.diagnosticsSummary);
      // 最近の編集:
      this.pushListSection(lines, "Recent edits:", context.projectSummary.recentEditsSummary);
      // TODO/FIXME:
      this.pushListSection(lines, "TODO/FIXME:", context.projectSummary.todoSummary);
      // Manifest/設定:
      this.pushListSection(lines, "Manifest/config:", context.projectSummary.manifestSummary);
      // Docs:
      this.pushListSection(lines, "Docs:", context.projectSummary.docsSummary);
    }

    if (context.additionalContext) {
      // 追加コンテキスト:
      lines.push("", "Additional context:", "```", context.additionalContext, "```");
    }

    if (knowledgeItems && knowledgeItems.length > 0) {
      // ## 再利用する個人ナレッジ
      lines.push("", "## Personal knowledge to reuse");
      for (const item of knowledgeItems) {
        lines.push(`- ${item.title}: ${item.summary}`);
      }
      // これらは過去の学びとして参考にし、現在の文脈に合う場合だけ控えめに活用してください。
      lines.push("Treat these as past lessons; draw on them sparingly and only when they fit the current context.");
    }

    if (userPrompt?.trim()) {
      // ## ユーザーからの相談
      lines.push("", "## User's question", userPrompt.trim());
    }

    if (slashCommand) {
      // ## スラッシュコマンド指示
      lines.push("", "## Slash command instruction", this.getSlashCommandInstruction(slashCommand, assistanceDepth, slashCommandScope));
    }

    lines.push(
      "",
      this.getInstructionByKind(kind)
    );

    return lines.join("\n");
  }

  private getDepthRule(depth: AssistanceDepth, slashCommand?: SlashCommand): string {
    // スキル固有の深さルール上書き（例: /flow はフローの整理だけに集中させる）があれば優先する。
    const override = slashCommand ? getSkill(slashCommand).depthRule : undefined;
    if (override) {
      return override(depth);
    }

    if (depth === "high") {
      // ハイモード: 次の確認事項・トレードオフ・境界を含む構造化された説明を行う。簡潔に、ただしヒントより踏み込む。
      return "- High mode: give a structured explanation with the next checks, tradeoffs, and boundaries. Keep it compact, but go deeper than hints.";
    }

    // ロウモード: 短いヒントと確認ポイントのみ。長い説明を避け、最終的な答えへ飛ばない。
    return "- Low mode: give short hints and checking points only. Avoid long explanations and avoid jumping to the final answer.";
  }

  private getInstructionByKind(kind: GuidanceKind): string {
    switch (kind) {
      case "manual":
        // ユーザーが質問しています。追加コンテキストの問題文・要件・制約・入出力・意味について尋ねている場合は、追加コンテキストを最優先にして直接説明してください。実装やデバッグの相談では、着目すべき場所・処理・関係性を示して、ユーザー自身が手を動かして確かめられるよう誘導してください。
        return "The user is asking a question. If they ask about the problem statement, requirements, constraints, input/output, or meaning of the additional context, explain it directly with the additional context as the top priority. For implementation or debugging questions, point to the relevant locations, operations, and relationships so the user can verify things hands-on themselves.";
      case "always":
        // 今の編集の流れを見て、見落としやすい設計上の懸念・壊れやすい境界・次に影響が出そうな箇所があれば、それだけを短く指し示してください。書きかけのコードや構文の不完全さには触れないでください。何も気になる点がなければ何も返さないでください。
        return "Looking at the current editing flow, if there are easy-to-miss design concerns, fragile boundaries, or spots likely to be affected next, point to only those, briefly. Do not comment on in-progress code or syntactic incompleteness. If nothing stands out, return nothing.";
      case "context":
      default:
        // ユーザーが選択箇所について相談しています。その箇所の周辺で注目すべき処理・依存関係・データの流れを指し示して、ユーザー自身が原因や改善点にたどり着けるよう誘導してください。
        return "The user is consulting about the selected location. Point to the operations, dependencies, and data flow worth noting around it so the user can arrive at the cause or improvement themselves.";
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
    // ②: 指示本体はレジストリ（skills.ts）から取得し、選択時のみ注入する。
    return getSkill(command).buildInstruction(depth, scope);
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
        lines.push(`  - ${file.path} (${this.formatReferencedFileReason(file.reason)})`);
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
