import React, { useState } from "react";
import { PageHeader } from "../webview/components/BackHeader";
import { useApp } from "../webview/state/AppContext";

export function S08History() {
  const { viewModel, send } = useApp();
  const [searchQuery, setSearchQuery] = useState("");

  if (!viewModel) {
    return null;
  }

  const { conversationStreams, isBusy } = viewModel;

  const filteredStreams = searchQuery.trim()
    ? conversationStreams.filter((s) =>
        s.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversationStreams;

  return (
    <div className="s08-root">
      <div className="s08-sticky-top">
        <PageHeader
          title="相談履歴"
          subtitle="過去の相談を開いて、続きから質問できます。"
          navIcons={[
            { icon: "book", title: "ナレッジ", onClick: () => send({ type: "navigate", screen: "knowledge" }) },
            { icon: "settings", title: "設定", onClick: () => send({ type: "navigate", screen: "settings" }) },
            { icon: "add_comment", title: "新しい相談", onClick: () => send({ type: "navigate", screen: "main" }) },
          ]}
        />

        <div className="search-bar">
          <span className="material-symbols-outlined search-icon">search</span>
          <input
            type="text"
            placeholder="履歴を検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {conversationStreams.length === 0 ? (
          <div className="s08-empty">
            <span className="material-symbols-outlined">history</span>
            <div className="s08-empty-title">履歴はまだありません</div>
            <div className="s08-empty-desc">
              相談が始まると、ここに履歴が並びます。
            </div>
          </div>
        ) : filteredStreams.length === 0 ? (
          <div className="s08-empty">
            <span className="material-symbols-outlined">search_off</span>
            <div className="s08-empty-title">該当する履歴がありません</div>
            <div className="s08-empty-desc">別のキーワードで検索してみてください。</div>
          </div>
        ) : (
          <div className="s08-list">
            {filteredStreams.map((stream) => (
              <div key={stream.id} className="s08-item">
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
                        <span className="s08-context-text">{stream.additionalContext}</span>
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
            ))}
          </div>
        )}
    </div>
  );
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
