import { PageHeader } from "../webview/components/BackHeader";
import { useApp } from "../webview/state/AppContext";
import { formatDateTime, formatRelativeTime } from "../webview/utils/formatTime";

export function S05KnowledgeDetail() {
  const { viewModel, send } = useApp();
  const detail = viewModel?.selectedKnowledge;

  if (!detail) {
    return (
      <div className="knowledge-detail-root">
        <div className="s05-sticky-top">
          <PageHeader title="ナレッジ詳細" />
        </div>
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
      <div className="s05-sticky-top">
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
      </div>

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

