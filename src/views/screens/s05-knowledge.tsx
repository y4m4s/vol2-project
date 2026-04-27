import React from "react";
import { PageHeader } from "../webview/components/BackHeader";
import { useApp } from "../webview/state/AppContext";

export function S05Knowledge() {
  const { viewModel, send } = useApp();
  const items = viewModel?.knowledgeItems ?? [];
  const searchQuery = viewModel?.knowledgeQuery ?? "";

  function handleSearch(query: string) {
    send({ type: "searchKnowledge", query });
  }

  return (
    <div className="knowledge-root">
      <PageHeader
        title="ナレッジ管理"
        subtitle="保存したナレッジを開いて、内容を確認できます。"
        navIcons={[
          { icon: "history", title: "会話履歴", onClick: () => send({ type: "navigate", screen: "history" }) },
          { icon: "settings", title: "設定", onClick: () => send({ type: "navigate", screen: "settings" }) },
          { icon: "add_comment", title: "新しい相談", onClick: () => send({ type: "navigate", screen: "main" }) },
        ]}
      />

      <div className="search-bar">
        <span className="material-symbols-outlined search-icon">search</span>
        <input
          type="text"
          placeholder="検索..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <span className="material-symbols-outlined empty-state-icon">auto_stories</span>
          <div className="empty-title">まだナレッジがありません</div>
          <div className="empty-desc">回答下の保存ボタンから追加できます</div>
        </div>
      ) : (
        <div id="knowledgeList" className="knowledge-list">
          {items.map((item) => (
            <div key={item.id} className="knowledge-list-item">
              <button
                type="button"
                className="knowledge-item-main"
                onClick={() => send({ type: "selectKnowledge", id: item.id })}
              >
                <span className="knowledge-item-title">{item.title}</span>
                <span className="knowledge-item-preview">{item.summary}</span>
                <span className="knowledge-item-date">
                  <span className="material-symbols-outlined">schedule</span>
                  {formatDateTime(item.updatedAt)}
                </span>
              </button>

              <button
                type="button"
                className="knowledge-delete-btn"
                title="ナレッジを削除"
                aria-label={`${item.title}を削除`}
                onClick={() => send({ type: "deleteKnowledge", id: item.id })}
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

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
}
