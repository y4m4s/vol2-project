import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../webview/state/AppContext";
import type { AutoAdviceState } from "../../shared/types";

declare global {
  interface Window { __ICON_URI__: string; }
}

export function S02Main() {
  const { viewModel, send } = useApp();
  const [inputText, setInputText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }

    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [inputText]);

  if (!viewModel) {
    return null;
  }

  const {
    connectionState,
    mode,
    canConnect,
    canAskForGuidance,
    canSwitchMode,
    isBusy,
    requestState,
    autoAdvice,
    contextPreview,
    statusMessage
  } = viewModel;

  const isAlways = mode === "always";
  const isPaused = autoAdvice.paused;

  function handleSend() {
    const text = inputText.trim();
    if (!text) {
      return;
    }

    send({ type: "ask", text });
    setInputText("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

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

      {statusMessage && !isKnowledgeSaveStatus(statusMessage.text, requestState) && (
        <div className={`s02-notice ${statusMessage.kind}`}>
          <span className="material-symbols-outlined">
            {statusMessage.kind === "error"
              ? "error"
              : statusMessage.kind === "warning"
                ? "warning"
                : "info"}
          </span>
          <span>{statusMessage.text}</span>
        </div>
      )}

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

      <div className="s02-input-area">
        <div className="s02-input-wrap">
          {contextPreview.selectedTextPreview && (
            <div className="s02-selected-context" title={contextPreview.selectedTextPreview}>
              <span className="material-symbols-outlined">code</span>
              <span className="s02-selected-context-text">
                {getSelectionLabel(contextPreview.selectedTextPreview)}
              </span>
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="s02-input"
            placeholder="質問を入力... (Shift+Enter で改行)"
            rows={1}
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={handleKeyDown}
          />

          <div className="s02-input-footer">
            <div className="s02-footer-right">
              {isAlways && (
                <div className={`s02-auto-inline ${isPaused ? "paused" : ""}`}>
                  <span className="material-symbols-outlined">
                    {isPaused ? "pause_circle" : "radio_button_checked"}
                  </span>
                  <span className="s02-auto-inline-text">{getAutoStatusText(autoAdvice)}</span>
                  <button
                    className="s02-auto-inline-toggle"
                    title={isPaused ? "常時モードを再開" : "常時モードを一時停止"}
                    disabled={!autoAdvice.enabled}
                    onClick={() => send({ type: "toggleAutoPause" })}
                  >
                    <span className="material-symbols-outlined">
                      {isPaused ? "play_arrow" : "pause"}
                    </span>
                  </button>
                </div>
              )}

              <button
                className={`s02-mode-btn ${isAlways ? "always" : ""}`}
                title={isAlways ? "必要時モードへ切り替え" : "常時モードへ切り替え"}
                disabled={!canSwitchMode && !isAlways}
                onClick={() => send({ type: "setMode", mode: isAlways ? "manual" : "always" })}
              >
                <span className="material-symbols-outlined">bolt</span>
                {isAlways ? "常時" : "必要時"}
              </button>

              <button
                className="s02-send-btn"
                disabled={!canAskForGuidance || !inputText.trim() || isBusy}
                onClick={handleSend}
              >
                <span className="material-symbols-outlined">arrow_upward</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getSelectionLabel(preview: string): string {
  const firstLine = preview.split("\n")[0].trim();
  return firstLine.length > 96 ? `${firstLine.slice(0, 96)}...` : firstLine;
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

function isKnowledgeSaveStatus(text: string, requestState: string): boolean {
  return (
    requestState === "saving_knowledge" ||
    text === "Copilot でアドバイスをナレッジ用に整理しています..." ||
    text === "アドバイスを整理してナレッジとして保存しました。"
  );
}

function getAutoStatusText(autoAdvice: AutoAdviceState): string {
  if (autoAdvice.paused) {
    return "常時モードは一時停止中です";
  }

  if (autoAdvice.waitingForIdle) {
    const seconds = Math.max(1, Math.ceil(autoAdvice.idleRemainingMs / 1000));
    return `入力待ちです... ${seconds}秒`;
  }

  if (autoAdvice.cooldownRemainingMs > 0) {
    const seconds = Math.max(1, Math.ceil(autoAdvice.cooldownRemainingMs / 1000));
    return `次の自動助言まで ${seconds}秒`;
  }

  return "常時モードは待機中です";
}
