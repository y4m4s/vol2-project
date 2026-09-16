import { buildGuidancePrompt, type GuidancePromptInput } from "./PromptBuilder";
import type { ContextCategoryKey, RequestPlanSnapshot } from "../shared/types";
import { AiInputLimitError } from "./AiRequestPolicy";

/** Use the serializer's actual budget decisions, rather than inspecting the untrimmed context. */
export function reconcileRequestPlan(plan: RequestPlanSnapshot, input: GuidancePromptInput): RequestPlanSnapshot {
  const categories = new Set<ContextCategoryKey>();
  const files = new Set<string>();
  let blocked = false;
  try {
    buildGuidancePrompt(input, (category, file) => {
      categories.add(category);
      if (file) files.add(file);
    });
  } catch (error) {
    if (!(error instanceof AiInputLimitError)) throw error;
    blocked = true;
    categories.clear();
    files.clear();
  }
  const omitted = blocked ? "入力上限を超えているため送信できません" : "選択範囲の優先・モデルの入力予算により送信しません";
  return {
    ...plan,
    categories: [
      ...plan.categories.filter((item) => item.key !== "knowledge" && item.key !== "feedback"),
      { key: "knowledge" as const, label: "再利用ナレッジ", description: "保存したナレッジのタイトル・要約", enabled: true, included: Boolean(input.knowledgeItems?.length) },
      { key: "feedback" as const, label: "フィードバック傾向", description: "評価理由から生成した定型の傾向（補足コメントは含みません）", enabled: true, included: input.kind !== "always" && Boolean(input.feedbackTendency?.goodPatterns.length || input.feedbackTendency?.badAvoidPatterns.length) }
    ].map((item) => ({
      ...item,
      ...(item.key === "conversationHistory" ? { enabled: true, note: categories.has(item.key) ? "入力予算内の会話メモリを引き継ぎます" : "過去の会話は送信対象に含まれていません" } : {}),
      included: categories.has(item.key),
      ...(item.key !== "conversationHistory" ? { note: item.included && !categories.has(item.key) ? omitted : item.note } : {})
    })),
    targetFiles: plan.targetFiles.map((item) => ({
      ...item,
      included: files.has(item.path),
      excludedReason: files.has(item.path) ? undefined : item.included ? omitted : item.excludedReason
    }))
  };
}
