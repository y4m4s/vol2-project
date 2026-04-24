import React from "react";
import { BackHeader } from "../webview/components/BackHeader";
import { useApp } from "../webview/state/AppContext";

export function S03AdviceDetail() {
  const { viewModel, send } = useApp();
  const detail = viewModel?.selectedAdvice;

  return (
    <>
      <BackHeader />
      <div className="page-title">アドバイス詳細</div>

      <div className="detail-stack">
        <div className="card">
          <div className="detail-section-head">
            <span className="material-symbols-outlined">auto_awesome</span>
            <strong>アドバイス</strong>
          </div>
          <div className="detail-body">
            {detail?.adviceBody ?? "まだ詳細表示できるアドバイスがありません。"}
          </div>
          <p className="muted detail-meta">
            {detail?.speculativeNote ?? "まずメイン画面でガイダンスを取得してください。"}
          </p>
        </div>

        <div className="card">
          <div className="detail-section-head">
            <span className="material-symbols-outlined">source_notes</span>
            <strong>根拠</strong>
          </div>
          <div className="detail-row">
            <span className="material-symbols-outlined detail-row-icon">description</span>
            <span className="muted">{detail?.referenceFiles.join(", ") || "なし"}</span>
          </div>
          <div className="detail-row">
            <span className="material-symbols-outlined detail-row-icon">warning</span>
            <span className="muted">{detail?.diagnosticsSummary || "なし"}</span>
          </div>
          <div className="detail-row">
            <span className="material-symbols-outlined detail-row-icon">edit_note</span>
            <span className="muted">{detail?.changeSummary || "なし"}</span>
          </div>
        </div>

        <div className="card">
          <button className="secondary" onClick={() => send({ type: "saveKnowledge" })}>
            <span className="material-symbols-outlined">bookmark_add</span>
            ナレッジとして保存
          </button>
        </div>
      </div>
    </>
  );
}
