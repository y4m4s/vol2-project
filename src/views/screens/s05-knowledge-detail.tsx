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

  const sourceConversation = detail.sourceConversation;

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

      {sourceConversation && (
        <div className="knowledge-detail-section knowledge-source-section">
          <div className="knowledge-panel-title">元の会話</div>
          <button
            type="button"
            className="knowledge-source-conversation"
            disabled={viewModel?.isBusy}
            onClick={() => send({ type: "selectConversationStream", id: sourceConversation.id })}
          >
            <span className="knowledge-source-copy">
              <span className="knowledge-source-title">{sourceConversation.title}</span>
              {sourceConversation.additionalContext && (
                <span className="knowledge-source-context" title={sourceConversation.additionalContext}>
                  <span className="material-symbols-outlined">description</span>
                  {getContextPreview(sourceConversation.additionalContext)}
                </span>
              )}
            </span>
            <span className="knowledge-source-meta">
              <span className="knowledge-source-time">{formatRelativeTime(sourceConversation.updatedAt)}</span>
              <span className="material-symbols-outlined knowledge-source-open-icon">chevron_right</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function getContextPreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 90 ? `${normalized.slice(0, 90)}...` : normalized;
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
