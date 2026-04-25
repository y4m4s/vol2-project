import React, { useEffect, useRef, useState } from "react";
import type { AutoAdviceState } from "../../../shared/types";
import { useApp } from "../state/AppContext";
import { AdditionalContextButton, AdditionalContextPanel } from "./AdditionalContextComposer";

interface ChatInputComposerProps {
  resetKey?: string;
}

export function ChatInputComposer({ resetKey }: ChatInputComposerProps) {
  const { viewModel, send, additionalContextDraft, setAdditionalContextDraft } = useApp();
  const [inputText, setInputText] = useState("");
  const [isAdditionalContextOpen, setAdditionalContextOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }

    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [inputText]);

  useEffect(() => {
    setInputText("");
    setAdditionalContextDraft("");
    setAdditionalContextOpen(false);
  }, [resetKey, setAdditionalContextDraft]);

  if (!viewModel) {
    return null;
  }

  const {
    mode,
    canAskForGuidance,
    canSwitchMode,
    isBusy,
    autoAdvice,
    contextPreview
  } = viewModel;

  const isAlways = mode === "always";
  const isPaused = autoAdvice.paused;
  const hasAdditionalContext = additionalContextDraft.trim().length > 0;

  function handleSend() {
    const text = inputText.trim();
    if (!text) {
      return;
    }

    send({
      type: "ask",
      text,
      additionalContext: additionalContextDraft
    });
    setInputText("");
    setAdditionalContextDraft("");
    setAdditionalContextOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="chat-input-area">
      <div className="chat-input-wrap">
        {contextPreview.selectedTextPreview && (
          <div className="chat-selected-context" title={contextPreview.selectedTextPreview}>
            <span className="material-symbols-outlined">code</span>
            <span className="chat-selected-context-text">
              {getSelectionLabel(contextPreview.selectedTextPreview)}
            </span>
          </div>
        )}

        {isAdditionalContextOpen && (
          <AdditionalContextPanel
            id="chat-additional-context"
            value={additionalContextDraft}
            onChange={setAdditionalContextDraft}
          />
        )}

        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          placeholder="質問を入力... (Shift+Enter で改行)"
          rows={1}
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="chat-input-footer">
          <div className="chat-input-footer-left">
            <AdditionalContextButton
              open={isAdditionalContextOpen}
              hasValue={hasAdditionalContext}
              onClick={() => setAdditionalContextOpen((open) => !open)}
            />
          </div>

          <div className="chat-input-footer-right">
            {isAlways && (
              <div className={`chat-auto-inline ${isPaused ? "paused" : ""}`}>
                <span className="material-symbols-outlined">
                  {isPaused ? "pause_circle" : "radio_button_checked"}
                </span>
                <span className="chat-auto-inline-text">{getAutoStatusText(autoAdvice)}</span>
                <button
                  className="chat-auto-inline-toggle"
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
              className={`chat-mode-btn ${isAlways ? "always" : ""}`}
              title={isAlways ? "必要時モードへ切り替え" : "常時モードへ切り替え"}
              disabled={!canSwitchMode && !isAlways}
              onClick={() => send({ type: "setMode", mode: isAlways ? "manual" : "always" })}
            >
              <span className="material-symbols-outlined">bolt</span>
              {isAlways ? "常時" : "必要時"}
            </button>

            <button
              className="chat-send-btn"
              disabled={!canAskForGuidance || !inputText.trim() || isBusy}
              onClick={handleSend}
            >
              <span className="material-symbols-outlined">arrow_upward</span>
            </button>
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
