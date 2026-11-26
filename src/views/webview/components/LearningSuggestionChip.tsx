import { useApp } from "../state/AppContext";

export function CurrentLearningSuggestion() {
  const { viewModel, send } = useApp();
  const suggestion = viewModel?.learningSuggestion;
  if (!suggestion) return null;
  return <LearningSuggestionChip label={suggestion.label} disabled={viewModel?.requestState !== "idle"} kind={suggestion.kind}
    onAccept={() => send({ type: "acceptLearningSuggestion", id: suggestion.id })}
    onDismiss={() => send({ type: "dismissLearningSuggestion", id: suggestion.id, scope: "once" })}
    onDismissConcept={suggestion.canDismissConcept === false ? undefined : () => send({ type: "dismissLearningSuggestion", id: suggestion.id, scope: "concept" })} />;
}

/**
 * 既知言語との比較の提案（suggest モード）と、つまずいたときの相談の提案（kind="consultation"）。
 * 表示だけで AI は呼ばない。ボタンを押したときだけ、説明・相談を1回生成する。
 */
export function LearningSuggestionChip({
  label,
  disabled,
  kind = "comparison",
  onAccept,
  onDismiss,
  onDismissConcept
}: {
  label: string;
  disabled: boolean;
  kind?: "comparison" | "consultation";
  onAccept: () => void;
  onDismiss: () => void;
  onDismissConcept?: () => void;
}) {
  return (
    <div className="learning-suggestion" role="region" aria-label={kind === "consultation" ? "つまずいたときの相談の提案" : "既知言語との比較の提案"}>
      <span className="material-symbols-outlined learning-suggestion-icon" aria-hidden="true">lightbulb</span>
      <span className="learning-suggestion-label" title={label}>{label}</span>
      <div className="learning-suggestion-actions">
        <button type="button" className="learning-suggestion-accept" disabled={disabled} onClick={onAccept}>
          {kind === "consultation" ? "相談する" : "説明する"}
        </button>
        {onDismissConcept && <button
          type="button"
          className="learning-suggestion-text-button"
          title="この内容の比較を今後は提案しない（設定から戻せます）"
          onClick={onDismissConcept}
        >
          今後出さない
        </button>}
        <button type="button" className="learning-suggestion-close" aria-label="提案を閉じる" title="閉じる" onClick={onDismiss}>
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
    </div>
  );
}
