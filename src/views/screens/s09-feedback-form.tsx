import { useState } from "react";
import { PageHeader } from "../webview/components/BackHeader";
import { useApp } from "../webview/state/AppContext";
import type { FeedbackReason } from "../../shared/types";

const GOOD_REASON_OPTIONS: Array<{ value: FeedbackReason; label: string }> = [
  { value: "concise", label: "簡潔で読みやすい" },
  { value: "concrete", label: "場所や確認点が具体的" },
  { value: "well_structured", label: "構成が分かりやすい" },
  { value: "right_depth", label: "詳しさがちょうどよい" },
  { value: "guided_thinking", label: "考える手掛かりになった" },
  { value: "other", label: "その他" }
];

const BAD_REASON_OPTIONS: Array<{ value: FeedbackReason; label: string }> = [
  { value: "too_long", label: "長すぎる" },
  { value: "off_topic", label: "的外れ" },
  { value: "gives_answer", label: "答えを代行しすぎ" },
  { value: "too_vague", label: "観点が曖昧" },
  { value: "other", label: "その他" }
];

export function S09FeedbackForm() {
  const { viewModel, send } = useApp();
  const [selectedReasons, setSelectedReasons] = useState<FeedbackReason[]>([]);
  const [comment, setComment] = useState("");

  if (!viewModel) {
    return null;
  }

  const target = viewModel.conversationHistory.find(
    (entry) => entry.id === viewModel.pendingFeedbackEntryId && entry.role === "assistant"
  );
  const preview = target?.text.replace(/\s+/g, " ").trim() ?? "";
  const isSaving = viewModel.requestState === "saving_feedback";
  const rating = viewModel.pendingFeedbackRating;
  const isGood = rating === "good";
  const reasonOptions = rating === "good"
    ? GOOD_REASON_OPTIONS
    : rating === "bad"
      ? BAD_REASON_OPTIONS
      : [];

  function toggleReason(reason: FeedbackReason): void {
    setSelectedReasons((current) =>
      current.includes(reason)
        ? current.filter((item) => item !== reason)
        : [...current, reason]
    );
  }

  return (
    <div className="s09-root" aria-busy={isSaving}>
      <PageHeader
        title={isGood ? "Good評価の理由" : "Bad評価の理由"}
        subtitle="選択した理由だけを、同じ種類の相談で次回以降の傾向に反映します。"
        back={{ title: "会話へ戻る", ariaLabel: "会話へ戻る", disabled: isSaving, onClick: () => send({ type: "cancelFeedback" }) }}
      />

      <div className="s09-content">
        <section className="s09-preview" aria-label="対象の回答">
          <div className="s09-section-title">対象の回答</div>
          <div className="s09-preview-text">{preview || "対象の回答が見つかりません。"}</div>
        </section>

        <section className="s09-section">
          <div className="s09-section-title">理由</div>
          <div className="s09-reason-grid">
            {reasonOptions.map((option) => (
              <label key={option.value} className="s09-reason-option">
                <input
                  type="checkbox"
                  checked={selectedReasons.includes(option.value)}
                  disabled={isSaving}
                  onChange={() => toggleReason(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <div className="s09-note">「その他」と補足はローカルにだけ保存され、AIへの指示には使用されません。</div>
        </section>

        <section className="s09-section">
          <label className="s09-section-title" htmlFor="s09-comment">補足</label>
          <textarea
            id="s09-comment"
            className="s09-comment"
            value={comment}
            disabled={isSaving}
            onChange={(event) => setComment(event.target.value)}
            placeholder="任意で補足できます（ローカル保存のみ）"
            maxLength={1000}
            rows={5}
          />
          <div className="s09-comment-count">{comment.length} / 1000</div>
        </section>
      </div>

      <div className="s09-actions">
        <button className="s09-secondary" disabled={isSaving} onClick={() => send({ type: "cancelFeedback" })}>
          キャンセル
        </button>
        <button
          className="s09-primary"
          disabled={!target || !rating || selectedReasons.length === 0 || isSaving}
          onClick={() => send({ type: "submitFeedback", reasons: selectedReasons, comment })}
        >
          <span className={`material-symbols-outlined${isSaving ? " s09-is-spinning" : ""}`}>
            {isSaving ? "progress_activity" : "save"}
          </span>
          {isSaving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}
