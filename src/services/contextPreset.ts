import type { ContextCategoryKey, GuidanceContext, SlashCommand } from "../shared/types";
import { getSkill } from "../shared/skills";

/**
 * ① スキル別の文脈プリセット。
 *
 * スキルが宣言した contextPreset（許可リスト）に従い、送る文脈カテゴリを絞り込む純粋ロジック。
 * 関連性の向上と送信トークン削減を両立する。vscode 非依存なので RequestPlanner からも
 * 評価ハーネスからも同じ関数を使える。
 *
 * - スラッシュコマンドが無い（通常の質問）/ プリセット未定義のスキルは、従来どおり全カテゴリ送る。
 * - additionalContext（ユーザーが手で入力した補足）は許可リストに関わらず常に保持する。
 */

// 各カテゴリキーが GuidanceContext のどのフィールドを支配するか（activeFilePath / Language は
// 軽量な識別子なので常に保持し、重い activeFileExcerpt のみ activeFile カテゴリで制御する）。
export function getSkillContextPreset(command?: SlashCommand): Set<ContextCategoryKey> | undefined {
  if (!command) {
    return undefined;
  }

  const preset = getSkill(command).contextPreset;
  return preset ? new Set(preset) : undefined;
}

export function applySkillContextPreset(context: GuidanceContext, command?: SlashCommand): GuidanceContext {
  const allow = getSkillContextPreset(command);
  if (!allow) {
    return context;
  }

  return {
    activeFilePath: context.activeFilePath,
    activeFileLanguage: context.activeFileLanguage,
    activeFileExcerpt: allow.has("activeFile") ? context.activeFileExcerpt : undefined,
    selectedText: allow.has("selection") ? context.selectedText : undefined,
    workspaceTree: allow.has("workspaceTree") ? context.workspaceTree : undefined,
    referencedFiles: allow.has("referencedFiles") ? context.referencedFiles : [],
    diagnosticsSummary: allow.has("diagnostics") ? context.diagnosticsSummary : [],
    recentEditsSummary: allow.has("recentEdits") ? context.recentEditsSummary : [],
    relatedSymbols: allow.has("relatedSymbols") ? context.relatedSymbols : [],
    projectSummary: allow.has("projectSummary") ? context.projectSummary : undefined,
    // ユーザー入力は常に保持する。
    additionalContext: context.additionalContext
  };
}
