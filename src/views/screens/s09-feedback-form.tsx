import { useEffect, useRef, useState } from "react";
import { useApp } from "../webview/state/AppContext";
import type { FeedbackReason } from "../../shared/types";

type FeedbackReasonOption = {
  value: FeedbackReason;
  label: string;
  icon: string;
};

const GOOD_REASON_OPTIONS: FeedbackReasonOption[] = [
  { value: "concise", label: "簡潔で読みやすい", icon: "short_text" },
  { value: "concrete", label: "場所や確認点が具体的", icon: "location_on" },
  { value: "well_structured", label: "構成が分かりやすい", icon: "view_agenda" },
  { value: "right_depth", label: "詳しさがちょうどよい", icon: "tune" },
  { value: "guided_thinking", label: "考える手掛かりになった", icon: "lightbulb" },
  { value: "other", label: "その他", icon: "more_horiz" }
];

const BAD_REASON_OPTIONS: FeedbackReasonOption[] = [
  { value: "too_long", label: "長すぎる", icon: "format_align_justify" },
  { value: "off_topic", label: "的外れ", icon: "wrong_location" },
  { value: "gives_answer", label: "答えを代行しすぎ", icon: "assignment" },
  { value: "too_vague", label: "観点が曖昧", icon: "blur_on" },
  { value: "other", label: "その他", icon: "more_horiz" }
];

export function S09FeedbackForm() {
  const { viewModel, send } = useApp();
  const [selectedReasons, setSelectedReasons] = useState<FeedbackReason[]>([]);
  const [comment, setComment] = useState("");
  const [isCommentOpen, setIsCommentOpen] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const isSaving = viewModel?.requestState === "saving_feedback";

  useEffect(() => {
    if (viewModel?.screen !== "feedback_form") return;
    sheetRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) {
        event.preventDefault();
        send({ type: "cancelFeedback" });
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSaving, send, viewModel?.screen]);

  if (!viewModel) {
    return null;
  }

  const target = viewModel.conversationHistory.find(
    (entry) => entry.id === viewModel.pendingFeedbackEntryId && entry.role === "assistant"
  );
  const preview = target?.text.replace(/\s+/g, " ").trim() ?? "";
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

  function dismiss(): void {
    if (!isSaving) send({ type: "cancelFeedback" });
  }

  return (
    <div className={`s09-overlay ${isGood ? "is-good" : "is-bad"}`} aria-busy={isSaving}>
      <div className="s09-backdrop" aria-hidden="true" onClick={dismiss} />
      <section
        ref={sheetRef}
        className="s09-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="s09-title"
        tabIndex={-1}
      >
        <div className="s09-sheet-handle" aria-hidden="true" />
        <header className="s09-sheet-header">
          <span className="material-symbols-outlined s09-rating-mark" aria-hidden="true">
            {isGood ? "thumb_up" : "thumb_down"}
          </span>
          <div className="s09-sheet-heading">
            <strong id="s09-title">{isGood ? "良かった点を教えてください" : "気になった点を教えてください"}</strong>
            <span>今後の回答を、あなたに合う傾向へ調整します。</span>
          </div>
          <button
            type="button"
            className="s09-close"
            title="閉じる"
            aria-label="フィードバックを閉じる"
            disabled={isSaving}
            onClick={dismiss}
          >
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>

        <div className="s09-content">
          <div className="s09-preview" aria-label="対象の回答" title={preview}>
            <span className="material-symbols-outlined" aria-hidden="true">chat_bubble</span>
            <div className="s09-preview-copy">
              <span className="s09-preview-label">対象の回答</span>
              <span className="s09-preview-text">{preview || "対象の回答が見つかりません。"}</span>
            </div>
          </div>

          <section className="s09-section">
            <div className="s09-section-heading">
              <span className="s09-section-title">当てはまるもの</span>
              <span className="s09-selection-count">
                {selectedReasons.length > 0 ? `${selectedReasons.length}件選択中` : "複数選択できます"}
              </span>
            </div>
            <div className="s09-reason-grid" role="group" aria-label={`${isGood ? "良かった" : "気になった"}理由`}>
              {reasonOptions.map((option) => {
                const selected = selectedReasons.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`s09-reason-option${selected ? " selected" : ""}`}
                    aria-pressed={selected}
                    disabled={isSaving}
                    onClick={() => toggleReason(option.value)}
                  >
                    <span className="material-symbols-outlined s09-reason-icon" aria-hidden="true">{option.icon}</span>
                    <span className="s09-reason-label">{option.label}</span>
                    <span className="material-symbols-outlined s09-reason-check" aria-hidden="true">
                      {selected ? "check_circle" : "circle"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={`s09-comment-section${isCommentOpen ? " open" : ""}`}>
            <button
              type="button"
              className="s09-comment-toggle"
              aria-expanded={isCommentOpen}
              disabled={isSaving}
              onClick={() => setIsCommentOpen((current) => !current)}
            >
              <span className="material-symbols-outlined" aria-hidden="true">add_comment</span>
              <span className="s09-comment-toggle-copy">
                <strong>補足を追加</strong>
                <small>任意・ローカル保存のみ</small>
              </span>
              <span className="material-symbols-outlined s09-comment-chevron" aria-hidden="true">
                {isCommentOpen ? "expand_less" : "expand_more"}
              </span>
            </button>
            {isCommentOpen && (
              <div className="s09-comment-body">
                <textarea
                  id="s09-comment"
                  className="s09-comment"
                  aria-label="フィードバックの補足"
                  value={comment}
                  disabled={isSaving}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="任意で補足できます"
                  maxLength={1000}
                  rows={2}
                />
                <div className="s09-comment-count">{comment.length} / 1000</div>
              </div>
            )}
          </section>

          <div className="s09-note">
            <span className="material-symbols-outlined" aria-hidden="true">lock</span>
            <span>「その他」と補足はAIへの指示に使用しません。</span>
          </div>
        </div>

        <div className="s09-actions">
          <button className="s09-secondary" disabled={isSaving} onClick={dismiss}>
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
            {isSaving ? "保存中…" : "評価を保存"}
          </button>
        </div>
      </section>
    </div>
  );
}
