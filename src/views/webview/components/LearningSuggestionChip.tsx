/**
 * 回答の後に出す、既知言語との比較の提案（suggest モード）。
 * 表示だけで AI は呼ばない。「説明する」を押したときだけ、比較の説明を1回生成する。
 */
export function LearningSuggestionChip({
  label,
  disabled,
  onAccept,
  onDismiss,
  onDismissConcept
}: {
  label: string;
  disabled: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  onDismissConcept: () => void;
}) {
  return (
    <div className="learning-suggestion" role="region" aria-label="既知言語との比較の提案">
      <span className="material-symbols-outlined learning-suggestion-icon" aria-hidden="true">lightbulb</span>
      <span className="learning-suggestion-label" title={label}>{label}</span>
      <div className="learning-suggestion-actions">
        <button type="button" className="learning-suggestion-accept" disabled={disabled} onClick={onAccept}>
          説明する
        </button>
        <button
          type="button"
          className="learning-suggestion-text-button"
          title="この内容の比較を今後は提案しない（設定から戻せます）"
          onClick={onDismissConcept}
        >
          今後出さない
        </button>
        <button type="button" className="learning-suggestion-close" aria-label="提案を閉じる" title="閉じる" onClick={onDismiss}>
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
    </div>
  );
}
