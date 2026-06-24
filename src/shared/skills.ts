import type { AssistanceDepth, ContextCategoryKey, SlashCommandScope } from "./types";

/**
 * スラッシュコマンド（擬似スキル）のレジストリ。
 *
 * ① データ定義化:
 *   各スキルを「データ」として 1 箇所に集約する。コマンドを追加するときは、この
 *   SKILLS に 1 エントリ足すだけでよい。型（SlashCommand）・入力検証・UI サジェスト・
 *   LLM への指示・深さの扱いがすべてここから導出される。
 *
 * ② プログレッシブ・ディスクロージャー:
 *   - 軽量メタデータ（description / suggestions の title・description）は、一覧表示・
 *     サジェスト・将来の自動ルーティング用に常時参照できる。
 *   - 重い指示本体（buildInstruction / depthRule）は、そのスキルが実際に選択された
 *     ときだけプロンプトへ注入される（AdviceService.buildPrompt を参照）。
 */

// UI サジェストパネルに表示する 1 項目。1 スキルが複数のバリアントを持てる（例: /next と /next deep）。
export interface SkillSuggestion {
  commandText: string; // 例 "/next deep"
  title: string;
  description: string;
  icon: string;
}

export interface SkillDefinition {
  // ルーティング・一覧用の短い説明（②の軽量メタデータ）。
  description: string;
  // /next deep のようにスコープ引数（deep/wide/full）を受け付けるか。
  supportsScope?: boolean;
  // /next のようにプロジェクト全体の文脈収集パスを使うか。
  usesProjectScope?: boolean;
  // /flow のように深さ設定を無視して固定するか。
  forceDepth?: AssistanceDepth;
  // ①: このスキルで送る文脈カテゴリの許可リスト。省略時は制限なし（従来どおり全カテゴリ）。
  // additionalContext（ユーザー入力）は許可リストに関わらず常に送る。
  contextPreset?: ContextCategoryKey[];
  // UI サジェスト候補（1 個以上）。
  suggestions: SkillSuggestion[];
  // 会話履歴に表示するユーザー発言テキスト。
  userEntryText: (scope?: SlashCommandScope) => string;
  // 深さルールの上書き（AdviceService.getDepthRule 相当）。省略時は標準の low/high ルールを使う。
  depthRule?: (depth: AssistanceDepth) => string;
  // ②: 選択時のみプロンプトへ注入される指示本体。
  buildInstruction: (depth: AssistanceDepth, scope?: SlashCommandScope) => string;
}

export const SKILLS = {
  hint: {
    description: "Short hints and checkpoints to get unstuck without giving the answer.",
    // 詰まりの手元に集中する（選択・診断・最近の編集）。構造系や関連ファイルは送らない。
    contextPreset: ["activeFile", "selection", "diagnostics", "recentEdits"],
    suggestions: [
      { commandText: "/hint", title: "ヒント", description: "詰まりをほどく短い確認ポイント", icon: "lightbulb" }
    ],
    // ヒントをください
    userEntryText: () => "ヒントをください",
    buildInstruction: (depth) =>
      depth === "high"
        // 詰まりをほどくために、原因候補を広げすぎず、確認順を3-5個で整理してください。完成した修正案ではなく、ユーザーが次に観察するポイントを中心にしてください。
        ? "To help break the impasse, organize 3-5 things to check in order without spreading the candidate causes too wide. Center on the points the user should observe next, not a finished fix."
        // 詰まりをほどくための短いヒントを2-3個だけ出してください。答えや完成コードは出さず、見る場所と問いを中心にしてください。
        : "Give only 2-3 short hints to break the impasse. Do not give the answer or finished code; center on where to look and what to ask."
  },
  next: {
    description: "Organize what to verify and what to tackle next after reaching a milestone.",
    supportsScope: true,
    usesProjectScope: true,
    // 次の一手はプロジェクト概要と診断が主役。関連ファイル断片までは送らない。
    contextPreset: ["activeFile", "selection", "diagnostics", "projectSummary"],
    suggestions: [
      { commandText: "/next", title: "次の一手", description: "一区切り後に見ることを整理", icon: "arrow_forward" },
      { commandText: "/next deep", title: "次の一手 Deep", description: "プロジェクトを広めに見て整理", icon: "travel_explore" }
    ],
    // 次に何をすればよいか（広めに）整理してください
    userEntryText: (scope) =>
      scope === "deep" ? "次に何をすればよいか広めに整理してください" : "次に何をすればよいか整理してください",
    buildInstruction: (depth, scope) => {
      if (scope === "deep") {
        // プロジェクト全体を薄く見た前提で、作業の完了確認、未検証のリスク、次に着手する候補、後回しでよいことを根拠つきで短く整理してください。ファイル配置、診断、TODO、docs から読み取れる範囲を優先し、推測しすぎないでください。
        return "Assuming a shallow view of the whole project, briefly organize—with rationale—the completion checks, unverified risks, candidates to start next, and what can wait. Prioritize what can be read from file layout, diagnostics, TODOs, and docs, and do not over-speculate.";
      }

      return depth === "high"
        // 作業が一区切りついた前提で、送られたプロジェクト概要も使いながら、完了確認、検証、次の実装候補、後回しでよいことを分けて整理してください。命令ではなく、判断材料として提示してください。
        ? "Assuming the work has reached a milestone, and using the supplied project overview, organize separately the completion checks, verification, next implementation candidates, and what can wait. Present these as material for judgment, not as commands."
        // 作業が一区切りついた前提で、送られたプロジェクト概要も使いながら、次に確認するとよいことを3個以内で短く提示してください。実行を代行せず、ユーザーが選べる次の一手にしてください。
        : "Assuming the work has reached a milestone, and using the supplied project overview, briefly present up to 3 things worth checking next. Do not act on the user's behalf; make them next steps the user can choose from.";
    }
  },
  flow: {
    description: "Organize the processing/data flow as a Mermaid diagram.",
    forceDepth: "high",
    // 流れの把握には構造系（関連ファイル・シンボル・ディレクトリ構造）が要る。診断や編集履歴は不要。
    contextPreset: ["activeFile", "selection", "relatedSymbols", "referencedFiles", "workspaceTree"],
    suggestions: [
      { commandText: "/flow", title: "流れ", description: "処理やデータの流れを整理", icon: "account_tree" }
    ],
    // 処理やデータの流れを整理してください
    userEntryText: () => "処理やデータの流れを整理してください",
    // /flow はハイ固定だが、確認手順や注意点ではなくフローの整理だけに集中させる
    depthRule: () =>
      // フローモード: 流れの整理だけに集中する。チェックリスト・注意点・次のアクションのセクションは追加しない。
      "- Flow mode: focus only on organizing the flow. Do not add checklists, cautions, or next-action sections.",
    buildInstruction: () =>
      [
        // 現在の文脈から処理やデータの流れを整理してください。
        "From the current context, organize the processing or data flow.",
        // 出力は次の2つだけで構成してください: (1) 流れの要点の説明(2〜3行)、(2) Mermaid の flowchart TD コードブロック1つ。
        "Compose the output of only these two parts: (1) a 2-3 line summary of the flow, (2) one Mermaid flowchart TD code block.",
        // 確認手順、注意点、関心箇所の列挙、次のアクションなど、フロー以外のセクションは含めないでください。
        "Do not include any non-flow sections such as checking steps, cautions, lists of points of interest, or next actions.",
        // コードブロックは必ず ```mermaid で開始してください。
        "The code block must start with ```mermaid.",
        // ノードラベルは A["ラベル"] のように必ずダブルクォートで囲み、括弧やコロンなどの記号を含めても構文エラーにならないようにしてください。
        'Always wrap node labels in double quotes, like A["label"], so that symbols such as parentheses or colons do not cause syntax errors.',
        // 図は推測しすぎず、分かる範囲の流れだけを描いてください。
        "Do not over-speculate in the diagram; draw only the flow you can actually tell."
      ].join("\n")
  },
  risk: {
    description: "Point out fragile boundaries, side effects, and easy-to-miss conditions.",
    // 壊れやすさは最近の編集・診断・影響範囲（関連ファイル）から読む。
    contextPreset: ["activeFile", "selection", "diagnostics", "recentEdits", "referencedFiles"],
    suggestions: [
      { commandText: "/risk", title: "リスク", description: "壊れやすい箇所や副作用を確認", icon: "crisis_alert" }
    ],
    // 壊れやすい箇所や注意点を確認してください
    userEntryText: () => "壊れやすい箇所や注意点を確認してください",
    buildInstruction: (depth) =>
      depth === "high"
        // 変更や設計の壊れやすい境界、副作用、見落としやすい条件、影響を受けそうな箇所を整理してください。重大度が高そうな順にしてください。
        ? "Organize the fragile boundaries, side effects, easy-to-miss conditions, and likely-affected spots of the change or design. Order them from likely-highest severity."
        // 壊れやすそうな箇所や見落としやすい条件を3個以内で短く示してください。断定しすぎず、確認ポイントとして書いてください。
        : "Briefly point out up to 3 fragile spots or easy-to-miss conditions. Do not assert too strongly; write them as points to check."
  },
  test: {
    description: "Organize test perspectives without writing test code.",
    // テスト観点は変更箇所中心（選択・診断・最近の編集）。構造系は送らない。
    contextPreset: ["activeFile", "selection", "diagnostics", "recentEdits"],
    suggestions: [
      { commandText: "/test", title: "テスト", description: "確認観点を整理", icon: "fact_check" }
    ],
    // テスト観点を整理してください
    userEntryText: () => "テスト観点を整理してください",
    buildInstruction: (depth) =>
      depth === "high"
        // テスト観点を、正常系、境界値、失敗系、回帰確認に分けて整理してください。テストコードは書かず、何を確かめるかに絞ってください。
        ? "Organize the test perspectives, split into happy path, boundary values, failure cases, and regression checks. Do not write test code; focus on what to verify."
        // 今の変更に対して確認するとよいテスト観点を3個以内で短く示してください。テストコードは書かないでください。
        : "Briefly point out up to 3 test perspectives worth checking for the current change. Do not write test code."
  }
} satisfies Record<string, SkillDefinition>;

// SKILLS のキーから型を導出する（①: コマンドの一覧はレジストリが唯一の出所）。
export type SlashCommand = keyof typeof SKILLS;

export function isSlashCommand(value: string): value is SlashCommand {
  return Object.prototype.hasOwnProperty.call(SKILLS, value);
}

export function getSkill(command: SlashCommand): SkillDefinition {
  return SKILLS[command];
}

// UI サジェスト用にフラット化した一覧（スキルごとの複数バリアントを 1 リストに展開）。
export interface SlashCommandSuggestion extends SkillSuggestion {
  command: SlashCommand;
}

export const SLASH_COMMAND_SUGGESTIONS: SlashCommandSuggestion[] = (
  Object.entries(SKILLS) as [SlashCommand, SkillDefinition][]
).flatMap(([command, skill]) => skill.suggestions.map((suggestion) => ({ command, ...suggestion })));
