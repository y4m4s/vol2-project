import React from "react";
import { useApp } from "../webview/state/AppContext";

declare global {
  interface Window { __ICON_URI__: string; }
}

export function S01Connection() {
  const { viewModel, send } = useApp();

  const canConnect = viewModel?.canConnect ?? false;
  const isBusy = viewModel?.isBusy ?? false;

  return (
    <div className="s01-root">
      {/* ヒーローセクション */}
      <div className="s01-hero">
        <img src={window.__ICON_URI__} alt="AI Pair Navigator" className="s01-icon" />
        <div className="s01-title">AI Pair Navigator</div>
        <div className="s01-subtitle">
          GitHub Copilot と連携してコーディング中にアドバイスを提供します
        </div>
      </div>

      {/* 送信情報 */}
      <div className="s01-info-card">
        <div className="s01-info-title">
          <span className="material-symbols-outlined">info</span>
          送信される情報
        </div>
        <ul className="s01-info-list">
          <li><span className="material-symbols-outlined">description</span>アクティブファイルのコード（抜粋）</li>
          <li><span className="material-symbols-outlined">highlight_alt</span>選択範囲のテキスト</li>
          <li><span className="material-symbols-outlined">warning</span>エラー・警告などの診断情報</li>
        </ul>
        <div
          className="s01-exclude-link"
          onClick={() => send({ type: "navigate", screen: "context_check" })}
        >
          <span className="material-symbols-outlined">tune</span>
          除外設定・詳細を見る
        </div>
      </div>

      {/* 利用条件 */}
      <div className="s01-req-card">
        <div className="s01-info-title">
          <span className="material-symbols-outlined">checklist</span>
          利用条件
        </div>
        <ul className="s01-info-list">
          <li><span className="material-symbols-outlined">check</span>GitHub Copilot の有効なサブスクリプション</li>
          <li><span className="material-symbols-outlined">check</span>Copilot 拡張機能のインストールと有効化</li>
          <li><span className="material-symbols-outlined">check</span>ワークスペースの信頼</li>
        </ul>
      </div>

      {/* アクション */}
      <div className="s01-actions">
        <button disabled={!canConnect} onClick={() => send({ type: "connect" })}>
          <span className="material-symbols-outlined">power</span>
          {isBusy ? "接続中..." : "Copilot に接続"}
        </button>
        <button className="secondary" onClick={() => send({ type: "navigate", screen: "settings" })}>
          <span className="material-symbols-outlined">settings</span>
          設定
        </button>
      </div>
    </div>
  );
}
