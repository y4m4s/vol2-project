import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import type { AutoAdviceState } from "../../../shared/types";
import { useApp } from "../state/AppContext";
import {
  AdditionalContextButton,
  AdditionalContextPanel,
  AdditionalContextReadonlyPanel
} from "./AdditionalContextComposer";
import { useAutoResizeTextarea } from "../hooks/useAutoResizeTextarea";
import { getSelectionLabel } from "../utils/labelUtils";

interface ChatInputComposerProps {
  resetKey?: string;
}

export function ChatInputComposer({ resetKey }: ChatInputComposerProps) {
  const { viewModel, send, additionalContextDraft, setAdditionalContextDraft } = useApp();
  const [inputText, setInputText] = useState("");
  const [isAdditionalContextOpen, setAdditionalContextOpen] = useState(false);
  const textareaRef = useAutoResizeTextarea(inputText);
  const activeAdditionalContext = viewModel?.activeAdditionalContext ?? "";
  const isConversationComposer = viewModel?.screen === "conversation" || viewModel?.screen === "advice_detail";
  const isAdditionalContextReadonly = isConversationComposer && activeAdditionalContext.trim().length > 0;
  const hasAdditionalContext = (
    isAdditionalContextReadonly ? activeAdditionalContext : additionalContextDraft
  ).trim().length > 0;

  useEffect(() => {
    setInputText("");
    setAdditionalContextDraft(activeAdditionalContext);
    setAdditionalContextOpen(false);
    // activeAdditionalContext を deps に含めない:
    // main 画面で追加コンテキストを入力するたびにラウンドトリップで変化するため、
    // 入力中にメイン入力欄がクリアされたりパネルが閉じるのを防ぐ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    send({ type: "setAdditionalContext", additionalContext: additionalContextDraft });
  }, [additionalContextDraft, send]);

  useEffect(() => {
    send({ type: "setComposerActive", active: Boolean(inputText.trim()) });
  }, [inputText, send]);

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
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
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
          isAdditionalContextReadonly ? (
            <AdditionalContextReadonlyPanel
              id="chat-additional-context"
              value={activeAdditionalContext}
            />
          ) : (
            <AdditionalContextPanel
              id="chat-additional-context"
              value={additionalContextDraft}
              onChange={setAdditionalContextDraft}
            />
          )
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
            {(!isConversationComposer || hasAdditionalContext) && (
              <AdditionalContextButton
                open={isAdditionalContextOpen}
                hasValue={hasAdditionalContext}
                readOnly={isAdditionalContextReadonly}
                onClick={() => setAdditionalContextOpen((open) => !open)}
              />
            )}
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
              onClick={() => send({
                type: "setMode",
                mode: isAlways ? "manual" : "always",
                additionalContext: isAdditionalContextReadonly ? activeAdditionalContext : additionalContextDraft
              })}
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
