import React from "react";
import { PageHeader } from "../webview/components/BackHeader";
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
      <PageHeader
        title="新しい相談"
        subtitle="最初の質問を送ると会話画面へ移動し、そのまま続けて相談できます"
        back={false}
        status={connectionState !== "connected" ? (
          <span className="status-pill">
            <span className="status-dot" />
            {formatConnectionState(connectionState)}
          </span>
        ) : null}
        actions={connectionState !== "connected" ? (
          <button
            className="s02-connect-btn"
            disabled={!canConnect}
            onClick={() => send({ type: "connect" })}
          >
            <span className="material-symbols-outlined">power</span>
            接続
          </button>
        ) : null}
        navIcons={[
          { icon: "history", title: "会話履歴", onClick: () => send({ type: "navigate", screen: "history" }) },
          { icon: "book", title: "ナレッジ", onClick: () => send({ type: "navigate", screen: "knowledge" }) },
          { icon: "settings", title: "設定", onClick: () => send({ type: "navigate", screen: "settings" }) },
        ]}
      />

      <div className="s02-stage">
        <div className="s02-empty">
          <div className="s02-empty-brand">
            <img src={window.__ICON_URI__} alt="NaviCom" className="s02-empty-icon" />
            <div className="s02-empty-title">NaviCom</div>
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
              <span className="material-symbols-outlined">file_open</span>
              <div className="s02-empty-point-copy">
                <div className="s02-empty-point-title">開いているファイルを文脈に反映</div>
                <div className="s02-empty-point-desc">選択範囲や診断情報を付けてそのまま相談できます</div>
              </div>
            </div>

            <div className="s02-empty-point">
              <span className="material-symbols-outlined">book</span>
              <div className="s02-empty-point-copy">
                <div className="s02-empty-point-title">回答をナレッジとして保存</div>
                <div className="s02-empty-point-desc">会話画面の保存ボタンから有用な回答を蓄積できます</div>
              </div>
            </div>

            <div className="s02-empty-point">
              <span className="material-symbols-outlined">description</span>
              <div className="s02-empty-point-copy">
                <div className="s02-empty-point-title">追加コンテキストを付与して相談</div>
                <div className="s02-empty-point-desc">入力欄の添付ボタンから自由な補足情報を加えられます</div>
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
