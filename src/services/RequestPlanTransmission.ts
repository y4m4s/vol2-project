import { buildGuidancePrompt, type GuidancePromptInput } from "./PromptBuilder";
import type { ContextCategoryKey, RequestPlanSnapshot } from "../shared/types";
import { AiInputLimitError } from "./AiRequestPolicy";

/** Use the serializer's actual budget decisions, rather than inspecting the untrimmed context. */
export function reconcileRequestPlan(plan: RequestPlanSnapshot, input: GuidancePromptInput): RequestPlanSnapshot {
  const categories = new Set<ContextCategoryKey>();
  const files = new Set<string>();
  const references = new Set<string>();
  let blocked = false;
  let serialized = "";
  try {
    serialized = buildGuidancePrompt(input, (category, file, referenceId) => {
      categories.add(category);
      if (file) files.add(file);
      if (referenceId) references.add(referenceId);
    });
  } catch (error) {
    if (!(error instanceof AiInputLimitError)) throw error;
    blocked = true;
    categories.clear();
    files.clear();
    references.clear();
  }
  const omitted = blocked ? "入力上限を超えているため送信できません" : "選択範囲の優先・モデルの入力予算により送信しません";
  return {
    ...plan,
    estimatedSizeText: input.context.referenceDocuments?.length
      ? blocked ? "送信不可" : `約${(new TextEncoder().encode(serialized).byteLength / 1024).toFixed(1)} KB / 登録資料込み`
      : plan.estimatedSizeText,
    referenceDocuments: input.context.referenceDocuments?.length || input.context.withheldReferenceDocuments?.length ? [
      ...(input.context.referenceDocuments ?? []).map(({ text: _text, ...source }) => ({
        ...source, included: references.has(source.id), note: references.has(source.id) ? undefined : "入力予算内に全文が収まらないため省略しました"
      })),
      ...(input.context.withheldReferenceDocuments ?? []).map(item => ({ ...item, included: false }))
    ] : undefined,
    categories: [
      ...plan.categories.filter((item) => item.key !== "knowledge" && item.key !== "feedback" && item.key !== "referenceDocuments"),
      ...(input.context.referenceDocuments?.length || input.context.withheldReferenceDocuments?.length ? [{ key: "referenceDocuments" as const, label: "登録資料・Skills", description: "用途・適用範囲・関連語で選択した登録資料", enabled: true, included: references.size > 0,
        ...(input.context.withheldReferenceDocuments?.length ? { note: `ローカル限定の${input.context.withheldReferenceDocuments.length}件はこの接続先に送信しません` } : {}) }] : []),
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
