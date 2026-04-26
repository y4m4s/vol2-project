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
      <div className="s01-panel">
        <div className="s01-hero">
          <img src={window.__ICON_URI__} alt="NaviCom" className="s01-icon" />

          <div className="s01-copy">
            <div className="s01-title">NaviCom</div>
            <div className="s01-subtitle">
              GitHub Copilotと連携した学習支援コーディングアシスタントです。
            </div>
          </div>
        </div>

        <div className="s01-feature-list">
          <div className="s01-feature">
            <span className="material-symbols-outlined">code</span>
            <div className="s01-feature-copy">
              <div className="s01-feature-title">開いているコードを踏まえて相談</div>
              <div className="s01-feature-desc">
                編集中のファイル・選択範囲・診断情報を文脈に含めて質問できます。
              </div>
            </div>
          </div>

          <div className="s01-feature">
            <span className="material-symbols-outlined">description</span>
            <div className="s01-feature-copy">
              <div className="s01-feature-title">追加コンテキストを付与して相談</div>
              <div className="s01-feature-desc">
                入力欄の添付ボタンから自由な補足情報を加えて質問できます。
              </div>
            </div>
          </div>

          <div className="s01-feature">
            <span className="material-symbols-outlined">chat</span>
            <div className="s01-feature-copy">
              <div className="s01-feature-title">会話を続けながら深掘り</div>
              <div className="s01-feature-desc">
                最初の質問を送ると専用の会話画面へ移動し、そのまま続けて相談できます。
              </div>
            </div>
          </div>

          <div className="s01-feature">
            <span className="material-symbols-outlined">history</span>
            <div className="s01-feature-copy">
              <div className="s01-feature-title">履歴から途中の会話を再開</div>
              <div className="s01-feature-desc">
                過去の相談は履歴ページで一覧でき、続きからやり取りを再開できます。
              </div>
            </div>
          </div>

          <div className="s01-feature">
            <span className="material-symbols-outlined">book</span>
            <div className="s01-feature-copy">
              <div className="s01-feature-title">役立つ回答をナレッジとして保存</div>
              <div className="s01-feature-desc">
                会話画面の保存ボタンから有用な回答を蓄積し、あとから見返せます。
              </div>
            </div>
          </div>
        </div>

        <div className="s01-actions">
          <button
            className={`s01-connect-btn${isBusy ? " busy" : ""}`}
            disabled={!canConnect}
            onClick={() => send({ type: "connect" })}
          >
            <span className={`material-symbols-outlined${isBusy ? " s01-spin" : ""}`}>
              {isBusy ? "sync" : "power"}
            </span>
            {isBusy ? "接続を確認しています..." : "Copilot に接続"}
          </button>
        </div>
      </div>
    </div>
  );
}
