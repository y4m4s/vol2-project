import { useState } from "react";
import { PageHeader } from "../webview/components/BackHeader";
import { useApp } from "../webview/state/AppContext";
import type { BadFeedbackReason } from "../../shared/types";

const REASON_OPTIONS: Array<{ value: BadFeedbackReason; label: string }> = [
  { value: "too_long", label: "長すぎる" },
  { value: "off_topic", label: "的外れ" },
  { value: "gives_answer", label: "答えを代行しすぎ" },
  { value: "too_vague", label: "観点が曖昧" },
  { value: "other", label: "その他" }
];

export function S09FeedbackForm() {
  const { viewModel, send } = useApp();
  const [selectedReasons, setSelectedReasons] = useState<BadFeedbackReason[]>([]);
  const [comment, setComment] = useState("");

  if (!viewModel) {
    return null;
  }

  const target = viewModel.conversationHistory.find(
    (entry) => entry.id === viewModel.pendingFeedbackEntryId && entry.role === "assistant"
  );
  const preview = target?.text.replace(/\s+/g, " ").trim() ?? "";

  function toggleReason(reason: BadFeedbackReason): void {
    setSelectedReasons((current) =>
      current.includes(reason)
        ? current.filter((item) => item !== reason)
        : [...current, reason]
    );
  }

  return (
    <div className="s09-root">
      <PageHeader
        title="回答へのフィードバック"
        subtitle="次回以降の助言の傾向に反映します。"
        back={{ title: "会話へ戻る", ariaLabel: "会話へ戻る", onClick: () => send({ type: "cancelBadFeedback" }) }}
      />

      <div className="s09-content">
        <section className="s09-preview" aria-label="対象の回答">
          <div className="s09-section-title">対象の回答</div>
          <div className="s09-preview-text">{preview || "対象の回答が見つかりません。"}</div>
        </section>

        <section className="s09-section">
          <div className="s09-section-title">理由</div>
          <div className="s09-reason-grid">
            {REASON_OPTIONS.map((option) => (
              <label key={option.value} className="s09-reason-option">
                <input
                  type="checkbox"
                  checked={selectedReasons.includes(option.value)}
                  onChange={() => toggleReason(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="s09-section">
          <label className="s09-section-title" htmlFor="s09-comment">補足</label>
          <textarea
            id="s09-comment"
            className="s09-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="任意で、気になった点を短く書けます"
            rows={5}
          />
        </section>
      </div>

      <div className="s09-actions">
        <button className="s09-secondary" onClick={() => send({ type: "cancelBadFeedback" })}>
          キャンセル
        </button>
        <button
          className="s09-primary"
          disabled={!target}
          onClick={() => send({ type: "submitBadFeedback", reasons: selectedReasons, comment })}
        >
          <span className="material-symbols-outlined">send</span>
          送信
        </button>
      </div>
    </div>
  );
}
