import React from "react";
import { BackHeader } from "../webview/components/BackHeader";
import { useApp } from "../webview/state/AppContext";

export function S08History() {
  const { viewModel, send } = useApp();

  if (!viewModel) {
    return null;
  }

  const {
    conversationStreams,
    activeConversationStreamId,
    isBusy
  } = viewModel;

  return (
    <div className="s08-root">
      <BackHeader label="ホームへ戻る" />

      <div className="s08-head">
        <div>
          <div className="page-title">会話履歴</div>
          <div className="page-subtitle">
            履歴を開くと、その会話の続きから質問できます
          </div>
        </div>

        <button
          className="s08-create-btn"
          disabled={isBusy}
          onClick={() => send({ type: "createConversationStream" })}
        >
          <span className="material-symbols-outlined">add</span>
          新規
        </button>
      </div>

      {conversationStreams.length === 0 ? (
        <div className="s08-empty">
          <span className="material-symbols-outlined">history</span>
          <div className="s08-empty-title">履歴はまだありません</div>
          <div className="s08-empty-desc">
            ホームから相談を始めると、ここに会話の履歴が並びます
          </div>
        </div>
      ) : (
        <div className="s08-list">
          {conversationStreams.map((stream) => {
            const isCurrent = stream.id === activeConversationStreamId;
            return (
              <button
                key={stream.id}
                className={`s08-item ${isCurrent ? "current" : ""}`}
                disabled={isBusy}
                onClick={() => send({ type: "selectConversationStream", id: stream.id })}
              >
                <div className="s08-item-top">
                  <span className="s08-item-title">{stream.title}</span>
                  <span className="s08-item-time">{formatStreamDate(stream.updatedAt)}</span>
                </div>

                <div className="s08-item-preview">
                  {stream.lastMessagePreview ?? "メッセージはまだありません"}
                </div>

                <div className="s08-item-meta">
                  {stream.messageCount > 0 ? `${stream.messageCount}件のメッセージ` : "下書き"}
                  {isCurrent ? " · 現在の会話" : ""}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatStreamDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return sameDay
    ? date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}
