import React from "react";
import { PageHeader } from "../webview/components/BackHeader";
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
      <PageHeader
        title="相談履歴"
        subtitle="過去の相談を開いて、続きから質問できます。"
        actions={(
          <button
            className="s08-create-btn"
            disabled={isBusy}
            onClick={() => send({ type: "createConversationStream" })}
          >
            <span className="material-symbols-outlined">add</span>
            新規
          </button>
        )}
        navIcons={[
          { icon: "book", title: "ナレッジ", onClick: () => send({ type: "navigate", screen: "knowledge" }) },
          { icon: "settings", title: "設定", onClick: () => send({ type: "navigate", screen: "settings" }) },
          { icon: "home", title: "相談ホーム", onClick: () => send({ type: "navigate", screen: "main" }) },
        ]}
      />

      {conversationStreams.length === 0 ? (
        <div className="s08-empty">
          <span className="material-symbols-outlined">history</span>
          <div className="s08-empty-title">履歴はまだありません</div>
          <div className="s08-empty-desc">
            相談が始まると、ここに履歴が並びます。
          </div>
        </div>
      ) : (
        <div className="s08-list">
          {conversationStreams.map((stream) => {
            const isCurrent = stream.id === activeConversationStreamId;
            return (
              <div
                key={stream.id}
                className={`s08-item ${isCurrent ? "current" : ""}`}
              >
                <button
                  className="s08-item-main"
                  disabled={isBusy}
                  onClick={() => send({ type: "selectConversationStream", id: stream.id })}
                >
                  <span className="s08-item-copy">
                    <span className="s08-item-title">{stream.title}</span>
                    {stream.additionalContext && (
                      <span className="s08-context-preview" title={stream.additionalContext}>
                        <span className="material-symbols-outlined">description</span>
                        {getContextPreview(stream.additionalContext)}
                      </span>
                    )}
                  </span>
                  <span className="s08-item-time">{formatRelativeTime(stream.updatedAt)}</span>
                </button>

                <button
                  className="s08-delete-btn"
                  title="履歴を削除"
                  aria-label="履歴を削除"
                  disabled={isBusy}
                  onClick={(event) => {
                    event.stopPropagation();
                    send({ type: "deleteConversationStream", id: stream.id });
                  }}
                >
                  <span className="material-symbols-outlined">delete</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getContextPreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 90 ? `${normalized.slice(0, 90)}...` : normalized;
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    return "まもなく";
  }

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if (diffMs < minute) return "たった今";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}分前`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}時間前`;
  if (diffMs < week) return `${Math.floor(diffMs / day)}日前`;
  if (diffMs < month) return `${Math.floor(diffMs / week)}週間前`;
  if (diffMs < year) return `${Math.floor(diffMs / month)}か月前`;
  return `${Math.floor(diffMs / year)}年前`;
}
