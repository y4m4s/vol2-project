import React from "react";
import { ChatInputComposer } from "../webview/components/ChatInputComposer";
import { useApp } from "../webview/state/AppContext";

declare global {
  interface Window { __ICON_URI__: string; }
}

export function S02Main() {
  const { viewModel, send } = useApp();

  if (!viewModel) {
    return null;
  }

  const {
    connectionState,
    canConnect
  } = viewModel;

  return (
    <div className="s02-root">
      <div className="s02-header">
        <div className="s02-header-copy">
          <div className="s02-title-row">
            <div className="s02-title">新しい相談</div>
            {connectionState !== "connected" && (
              <span className="s02-status-pill">
                <span className="s02-status-dot" />
                {formatConnectionState(connectionState)}
              </span>
            )}
          </div>

          <div className="s02-subtitle">
            最初の質問を送ると会話画面へ移動し、そのまま続けて相談できます
          </div>
        </div>

        <div className="s02-header-actions">
          {connectionState !== "connected" && (
            <button
              className="s02-connect-btn"
              disabled={!canConnect}
              onClick={() => send({ type: "connect" })}
            >
              <span className="material-symbols-outlined">power</span>
              接続
            </button>
          )}

          <button
            className="s02-icon-btn"
            title="会話履歴"
            onClick={() => send({ type: "navigate", screen: "history" })}
          >
            <span className="material-symbols-outlined">history</span>
          </button>

          <button
            className="s02-icon-btn"
            title="ナレッジ"
            onClick={() => send({ type: "navigate", screen: "knowledge" })}
          >
            <span className="material-symbols-outlined">book</span>
          </button>

          <button
            className="s02-icon-btn"
            title="設定"
            onClick={() => send({ type: "navigate", screen: "settings" })}
          >
            <span className="material-symbols-outlined">settings</span>
          </button>
        </div>
      </div>

      <div className="s02-stage">
        <div className="s02-empty">
          <img src={window.__ICON_URI__} alt="NaviCom" className="s02-empty-icon" />
          <div className="s02-empty-title">ここから新しい会話を始めます</div>
          <div className="s02-empty-desc">
            最初の質問を送ると専用の会話画面に切り替わり、そのまま続けてやり取りできます。
          </div>

          <div className="s02-empty-points">
            <div className="s02-empty-point">
              <span className="material-symbols-outlined">history</span>
              <div className="s02-empty-point-copy">
                <div className="s02-empty-point-title">履歴は別ページで管理</div>
                <div className="s02-empty-point-desc">右上の履歴アイコンから途中の会話を再開できます</div>
              </div>
            </div>

            <div className="s02-empty-point">
              <span className="material-symbols-outlined">description</span>
              <div className="s02-empty-point-copy">
                <div className="s02-empty-point-title">開いているファイルを文脈に反映</div>
                <div className="s02-empty-point-desc">選択範囲や診断情報を付けてそのまま相談できます</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ChatInputComposer />
    </div>
  );
}

function formatConnectionState(state: string): string {
  switch (state) {
    case "connected":
      return "接続済み";
    case "connecting":
      return "接続中...";
    case "consent_pending":
      return "同意待ち";
    case "restricted":
      return "制限中";
    case "unavailable":
      return "利用不可";
    default:
      return "未接続";
  }
}
