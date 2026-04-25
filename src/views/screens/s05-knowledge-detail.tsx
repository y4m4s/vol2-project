import React from "react";
import { PageHeader } from "../webview/components/BackHeader";
import { useApp } from "../webview/state/AppContext";

export function S05KnowledgeDetail() {
  const { viewModel, send } = useApp();
  const detail = viewModel?.selectedKnowledge;

  if (!detail) {
    return (
      <div className="knowledge-detail-root">
        <PageHeader title="ナレッジ詳細" />
        <div className="empty-state">
          <span className="material-symbols-outlined empty-state-icon">auto_stories</span>
          <div className="empty-title">ナレッジを表示できません</div>
          <div className="empty-desc">一覧からもう一度ナレッジを選択してください</div>
        </div>
      </div>
    );
  }

  return (
    <div className="knowledge-detail-root">
      <PageHeader
        title={detail.title}
        subtitle={formatDateTime(detail.updatedAt)}
        actions={(
          <button
            type="button"
            className="knowledge-detail-delete-btn"
            title="ナレッジを削除"
            aria-label={`${detail.title}を削除`}
            onClick={() => send({ type: "deleteKnowledge", id: detail.id })}
          >
            <span className="material-symbols-outlined">delete</span>
          </button>
        )}
      />

      <div className="knowledge-detail-section">
        <div className="knowledge-panel-title">内容プレビュー</div>
        <div className="knowledge-summary-text">{detail.summary}</div>
      </div>

      <div className="knowledge-detail-section">
        <div className="knowledge-panel-title">本文</div>
        <div className="knowledge-body-text">{detail.body}</div>
      </div>
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
