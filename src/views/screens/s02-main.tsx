import React, { useState, useRef, useEffect } from "react";
import { useApp } from "../webview/state/AppContext";
import type { ConversationEntry, AutoAdviceState } from "../../shared/types";

declare global {
  interface Window { __ICON_URI__: string; }
}

export function S02Main() {
  const { viewModel, send } = useApp();
  const [inputText, setInputText] = useState("");
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [viewModel?.conversationHistory]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [inputText]);

  if (!viewModel) return null;

  const {
    connectionState,
    mode,
    canAskForGuidance,
    canSwitchMode,
    autoAdvice,
    contextPreview,
    conversationHistory,
    latestGuidance,
    statusMessage,
  } = viewModel;

  function handleSend() {
    const text = inputText.trim();
    if (!text) return;
    send({ type: "ask", text });
    setInputText("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const isAlways = mode === "always";
  const isPaused = autoAdvice.paused;
  const activeFileName = contextPreview.activeFilePath
    ? getFileName(contextPreview.activeFilePath)
    : null;

  return (
    <div className="s02-root">

      {/* ── ヘッダー ── */}
      <div className="s02-header">
        <div className="s02-status">
          <span className={`s02-dot ${connectionState === "connected" ? "connected" : ""}`} />
          <span className="s02-status-label">{formatConnectionState(connectionState)}</span>
        </div>
        <div className="s02-header-actions">
          {isAlways && (
            <button
              className="s02-icon-btn"
              title={isPaused ? "常時モードを再開" : "一時停止"}
              disabled={!autoAdvice.enabled}
              onClick={() => send({ type: "toggleAutoPause" })}
            >
              <span className="material-symbols-outlined">
                {isPaused ? "play_arrow" : "pause"}
              </span>
            </button>
          )}
          <button className="s02-icon-btn" title="送信範囲確認"
            onClick={() => send({ type: "navigate", screen: "context_check" })}>
            <span className="material-symbols-outlined">manage_search</span>
          </button>
          <button className="s02-icon-btn" title="ナレッジ管理"
            onClick={() => send({ type: "navigate", screen: "knowledge" })}>
            <span className="material-symbols-outlined">book</span>
          </button>
          <button className="s02-icon-btn" title="設定"
            onClick={() => send({ type: "navigate", screen: "settings" })}>
            <span className="material-symbols-outlined">settings</span>
          </button>
        </div>
      </div>

      {/* ── 常時モードステータス ── */}
      {isAlways && (
        <div className={`s02-auto-bar ${isPaused ? "paused" : ""}`}>
          <span className="material-symbols-outlined">
            {isPaused ? "pause_circle" : "radio_button_checked"}
          </span>
          <span>{getAutoStatusText(autoAdvice)}</span>
        </div>
      )}

      {/* ── ステータス通知 (info は非表示) ── */}
      {statusMessage && statusMessage.kind !== "info" && (
        <div className={`s02-notice ${statusMessage.kind}`}>
          <span className="material-symbols-outlined">
            {statusMessage.kind === "error" ? "error" : statusMessage.kind === "warning" ? "warning" : "info"}
          </span>
          {statusMessage.text}
        </div>
      )}

      {/* ── チャットエリア ── */}
      <div className="s02-chat">

        {latestGuidance && conversationHistory.length === 0 && (
          <div className="s02-advice-card">
            <div className="s02-advice-header">
              <span className="material-symbols-outlined">auto_awesome</span>
              <span>{latestGuidance.mode === "always" ? "自動アドバイス" : "アドバイス"}</span>
              <span className="s02-advice-time">{formatDate(latestGuidance.requestedAt)}</span>
            </div>
            <div className="s02-advice-body">{truncate(latestGuidance.text, 200)}</div>
            <button className="s02-advice-detail-btn" onClick={() =>
              send({ type: "openAdviceDetail", id: latestGuidance.id })
            }>
              <span className="material-symbols-outlined">open_in_full</span>
              詳細を見る
            </button>
          </div>
        )}

        {conversationHistory.length === 0 && !latestGuidance && (
          <div className="s02-empty">
            <img src={window.__ICON_URI__} alt="AI Pair Navigator" className="s02-empty-icon-img" />
            <div className="s02-empty-title">会話を開始してください</div>
            <div className="s02-empty-desc">
              質問を入力するか「この箇所を相談」で現在のコードについて聞けます
            </div>
          </div>
        )}

        {conversationHistory.map((entry) => (
          <ChatBubble
            key={entry.id}
            entry={entry}
            onDetail={(id) => send({ type: "openAdviceDetail", id })}
          />
        ))}

        <div ref={chatBottomRef} />
      </div>

      {/* ── 入力エリア ── */}
      <div className="s02-input-area">
        <div className="s02-input-wrap">
          <textarea
            ref={textareaRef}
            className="s02-input"
            placeholder="質問を入力... (Shift+Enter で改行)"
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="s02-input-footer">
            <div className="s02-footer-left">
              <button
                className="s02-footer-btn"
                title="この箇所を相談"
                disabled={!canAskForGuidance}
                onClick={() => send({ type: "askContext" })}
              >
                <span className="material-symbols-outlined">content_paste</span>
              </button>
              {activeFileName && (
                <span className="s02-footer-file">
                  <span className="material-symbols-outlined">description</span>
                  <span className="s02-footer-file-name">{activeFileName}</span>
                  {contextPreview.diagnosticsSummary.length > 0 && (
                    <span className="s02-footer-diag">
                      <span className="material-symbols-outlined">warning</span>
                      {contextPreview.diagnosticsSummary.length}
                    </span>
                  )}
                </span>
              )}
              {contextPreview.selectedTextPreview && (
                <span className="s02-footer-selection" title={contextPreview.selectedTextPreview}>
                  <span className="material-symbols-outlined">integration_instructions</span>
                  <span className="s02-footer-selection-text">
                    {getSelectionLabel(contextPreview.selectedTextPreview)}
                  </span>
                </span>
              )}
            </div>
            <div className="s02-footer-right">
              <button
                className={`s02-footer-btn ${isAlways ? "mode-on" : ""}`}
                title={isAlways ? "常時モード ON（クリックでOFF）" : canSwitchMode ? "常時モード OFF（クリックでON）" : "常時モードは接続後に利用できます"}
                disabled={!canSwitchMode && !isAlways}
                onClick={() => send({ type: "setMode", mode: isAlways ? "manual" : "always" })}
              >
                <span className="material-symbols-outlined">bolt</span>
              </button>
              <button
                className="s02-send-btn"
                disabled={!canAskForGuidance || !inputText.trim()}
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

function ChatBubble({ entry, onDetail }: { entry: ConversationEntry; onDetail: (id: string) => void }) {
  const isUser = entry.role === "user";
  const label = isUser ? "あなた" : entry.kind === "always" ? "Navigator (自動)" : "Navigator";

  return (
    <div className={`s02-bubble-wrap ${isUser ? "user" : "assistant"}`}>
      <div className="s02-bubble-meta">
        <span className="material-symbols-outlined s02-bubble-icon">
          {isUser ? "person" : "smart_toy"}
        </span>
        <span className="s02-bubble-role">{label}</span>
        <span className="s02-bubble-time">{formatDate(entry.createdAt)}</span>
      </div>
      <div className={`s02-bubble ${isUser ? "user" : "assistant"}`}>
        <div className="s02-bubble-text">{entry.text}</div>
        {!isUser && (
          <button className="s02-detail-btn" onClick={() => onDetail(entry.id)}>
            <span className="material-symbols-outlined">open_in_full</span>
            詳細・根拠
          </button>
        )}
      </div>
    </div>
  );
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

function getSelectionLabel(preview: string): string {
  const firstLine = preview.split('\n')[0].trim();
  return firstLine.length > 28 ? firstLine.slice(0, 28) + '…' : firstLine;
}

function formatConnectionState(state: string): string {
  switch (state) {
    case "connected": return "接続済み";
    case "connecting": return "接続中...";
    case "consent_pending": return "同意待ち";
    case "restricted": return "制限中";
    case "unavailable": return "利用不可";
    default: return "未接続";
  }
}

function getAutoStatusText(autoAdvice: AutoAdviceState): string {
  if (autoAdvice.paused) return "一時停止中";
  if (autoAdvice.waitingForIdle) {
    const s = Math.max(1, Math.ceil(autoAdvice.idleRemainingMs / 1000));
    return `入力待ち... ${s}秒`;
  }
  if (autoAdvice.cooldownRemainingMs > 0) {
    const s = Math.max(1, Math.ceil(autoAdvice.cooldownRemainingMs / 1000));
    return `次の助言まで ${s}秒`;
  }
  return "監視中";
}

function formatDate(value: string): string {
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max) + "...";
}
