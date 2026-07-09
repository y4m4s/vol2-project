import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import type { AutoAdviceState } from "../../../shared/types";
import { useApp } from "../state/AppContext";
import {
  AdditionalContextButton,
  AdditionalContextPanel,
  AdditionalContextReadonlyPanel
} from "./AdditionalContextComposer";
import {
  getMatchingSlashCommands,
  SlashCommandButton,
  SlashCommandSuggest
} from "./SlashCommandSuggest";
import { useAutoResizeTextarea } from "../hooks/useAutoResizeTextarea";
import { getSelectionLabel } from "../utils/labelUtils";

interface ChatInputComposerProps {
  resetKey?: string;
}

export function ChatInputComposer({ resetKey }: ChatInputComposerProps) {
  const { viewModel, send, additionalContextDraft, setAdditionalContextDraft } = useApp();
  const [inputText, setInputText] = useState("");
  const [enterSendConfirmation, setEnterSendConfirmation] = useState<string | undefined>();
  const [isAdditionalContextOpen, setAdditionalContextOpen] = useState(false);
  const [isSlashCommandOpen, setSlashCommandOpen] = useState(false);
  const [dismissedSlashInput, setDismissedSlashInput] = useState<string | undefined>();
  const [activeSlashCommandIndex, setActiveSlashCommandIndex] = useState(0);
  const isComposingRef = useRef(false);
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
    setSlashCommandOpen(false);
    setDismissedSlashInput(undefined);
    setEnterSendConfirmation(undefined);
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

  useEffect(() => {
    if (enterSendConfirmation && inputText.trim() !== enterSendConfirmation) {
      setEnterSendConfirmation(undefined);
    }
  }, [enterSendConfirmation, inputText]);

  useEffect(() => {
    if (inputText.trim() && getSlashCommandQuery(inputText) === undefined) {
      setSlashCommandOpen(false);
    }
  }, [inputText]);

  useEffect(() => {
    if (dismissedSlashInput && inputText !== dismissedSlashInput) {
      setDismissedSlashInput(undefined);
    }
  }, [dismissedSlashInput, inputText]);

  const slashCommandQuery = getSlashCommandQuery(inputText);
  const slashCommandMenuOpen = Boolean(
    (slashCommandQuery !== undefined && inputText !== dismissedSlashInput) ||
      isSlashCommandOpen
  );
  const slashCommandOptions = useMemo(
    () => getMatchingSlashCommands(slashCommandQuery ?? ""),
    [slashCommandQuery]
  );

  useEffect(() => {
    setActiveSlashCommandIndex(0);
  }, [slashCommandQuery, slashCommandMenuOpen]);

  useEffect(() => {
    // スラッシュ候補と追加コンテキストパネルを同時に開かない。
    // 両方開くと入力エリアが肥大化し、フッター(送信ボタン)が画面外へ押し出されるため。
    if (slashCommandMenuOpen) {
      setAdditionalContextOpen(false);
    }
  }, [slashCommandMenuOpen]);

  useEffect(() => {
    if (
      enterSendConfirmation &&
      (
        !viewModel ||
        viewModel.requestState !== "idle" ||
        viewModel.isBusy ||
        !viewModel.canAskForGuidance
      )
    ) {
      setEnterSendConfirmation(undefined);
    }
  }, [
    enterSendConfirmation,
    viewModel?.canAskForGuidance,
    viewModel?.isBusy,
    viewModel?.requestState
  ]);

  if (!viewModel) {
    return null;
  }

  const {
    mode,
    assistanceDepth,
    canAskForGuidance,
    canSwitchMode,
    canSwitchAssistanceDepth,
    isBusy,
    autoAdvice,
    contextPreview
  } = viewModel;

  const isGuidanceRequesting = viewModel.requestState === "requesting_guidance";
  const isAlways = mode === "always";
  const isPaused = autoAdvice.paused;
  const isHigh = assistanceDepth === "high";
  const trimmedInputText = inputText.trim();
  const isEnterSendConfirmed = enterSendConfirmation === trimmedInputText && trimmedInputText.length > 0;
  // いずれかのパネルが開いているか（背後をぼかすバックドロップの表示判定）。
  const hasOpenPanel = slashCommandMenuOpen || isAdditionalContextOpen;

  function closeOverlays() {
    setAdditionalContextOpen(false);
    setSlashCommandOpen(false);
    setDismissedSlashInput(slashCommandQuery !== undefined ? inputText : undefined);
    setEnterSendConfirmation(undefined);
  }

  function resetComposer() {
    setInputText("");
    setSlashCommandOpen(false);
    setDismissedSlashInput(undefined);
    setEnterSendConfirmation(undefined);
  }

  function handleInputChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value;
    setInputText(nextValue);

    if (enterSendConfirmation && nextValue.trim() !== enterSendConfirmation) {
      setEnterSendConfirmation(undefined);
    }
  }

  function handleSend() {
    const text = trimmedInputText;
    if (!text) {
      return;
    }

    resetComposer();
    send({
      type: "ask",
      text,
      additionalContext: additionalContextDraft
    });
  }

  function handleCancel() {
    resetComposer();
    send({ type: "cancelGuidanceRequest" });
  }

  function handleRunSlashCommand(commandText: string) {
    if (!canAskForGuidance || isBusy) {
      return;
    }

    resetComposer();
    send({
      type: "ask",
      text: commandText,
      additionalContext: additionalContextDraft
    });
    textareaRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const isComposing = isComposingRef.current || event.nativeEvent.isComposing || event.keyCode === 229;
    if (event.key === "Enter" && isComposing) {
      return;
    }

    if (isGuidanceRequesting) {
      return;
    }

    if (slashCommandMenuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSlashCommandIndex((index) => {
          if (slashCommandOptions.length === 0) {
            return 0;
          }
          return (index + 1) % slashCommandOptions.length;
        });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSlashCommandIndex((index) => {
          if (slashCommandOptions.length === 0) {
            return 0;
          }
          return (index - 1 + slashCommandOptions.length) % slashCommandOptions.length;
        });
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setSlashCommandOpen(false);
        setDismissedSlashInput(inputText);
        return;
      }

      if (event.key === "Enter" && !event.shiftKey && slashCommandOptions[activeSlashCommandIndex]) {
        event.preventDefault();
        handleRunSlashCommand(slashCommandOptions[activeSlashCommandIndex].commandText);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      if (!trimmedInputText || !canAskForGuidance || isBusy) {
        return;
      }

      if (isEnterSendConfirmed) {
        handleSend();
        return;
      }

      setEnterSendConfirmation(trimmedInputText);
    }
  }

  return (
    <>
      {/* パネル表示中は背後の main をぼかして前面のパネルを見やすくする。クリックで閉じる。 */}
      {hasOpenPanel && <div className="chat-input-backdrop" onClick={closeOverlays} />}

      <div className={`chat-input-area ${hasOpenPanel ? "has-overlay" : ""}`}>
        {/* スラッシュ候補・追加コンテキストは入力ボックスの上に浮かせ、main の内容を押し上げない */}
        <div className="chat-input-overlays">
        {isAdditionalContextOpen && (
          isAdditionalContextReadonly ? (
            <AdditionalContextReadonlyPanel
              id="chat-additional-context"
              value={activeAdditionalContext}
              onClose={() => setAdditionalContextOpen(false)}
            />
          ) : (
            <AdditionalContextPanel
              id="chat-additional-context"
              value={additionalContextDraft}
              onChange={setAdditionalContextDraft}
              onClose={() => setAdditionalContextOpen(false)}
            />
          )
        )}

        <SlashCommandSuggest
          open={slashCommandMenuOpen}
          query={slashCommandQuery ?? ""}
          activeIndex={activeSlashCommandIndex}
          disabled={!canAskForGuidance || isBusy}
          onActiveIndexChange={setActiveSlashCommandIndex}
          onRunCommand={handleRunSlashCommand}
        />
      </div>

      <div className="chat-input-wrap">
        {contextPreview.selectedTextPreview && (
          <div className="chat-selected-context" title={contextPreview.selectedTextPreview}>
            <span className="material-symbols-outlined">code</span>
            <span className="chat-selected-context-text">
              {getSelectionLabel(contextPreview.selectedTextPreview)}
            </span>
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          placeholder="質問を入力... (Shift+Enter で改行)"
          rows={1}
          value={inputText}
          onChange={handleInputChange}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          onKeyDown={handleKeyDown}
        />

        <div className="chat-input-footer">
          <div className="chat-input-footer-left">
            {(!isConversationComposer || hasAdditionalContext) && (
              <AdditionalContextButton
                open={isAdditionalContextOpen}
                hasValue={hasAdditionalContext}
                readOnly={isAdditionalContextReadonly}
                onClick={() =>
                  setAdditionalContextOpen((open) => {
                    const next = !open;
                    if (next) {
                      // 追加コンテキストを開くときはスラッシュ候補を閉じる(同時表示を防ぐ)。
                      // `/...` 入力中の自動オープンも抑止するため dismissed に積む。
                      setSlashCommandOpen(false);
                      setDismissedSlashInput(slashCommandQuery !== undefined ? inputText : undefined);
                      setEnterSendConfirmation(undefined);
                    }
                    return next;
                  })
                }
              />
            )}
            <SlashCommandButton
              open={slashCommandMenuOpen}
              disabled={isBusy}
              onClick={() => {
                if (slashCommandMenuOpen) {
                  setSlashCommandOpen(false);
                  setDismissedSlashInput(slashCommandQuery !== undefined ? inputText : undefined);
                } else {
                  setSlashCommandOpen(true);
                  setDismissedSlashInput(undefined);
                }
                setAdditionalContextOpen(false);
                setEnterSendConfirmation(undefined);
                textareaRef.current?.focus();
              }}
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
              className={`chat-depth-btn ${isHigh ? "high" : ""}`}
              title={isHigh ? "ロウモードへ切り替え" : "ハイモードへ切り替え"}
              disabled={!canSwitchAssistanceDepth}
              onClick={() => send({
                type: "setAssistanceDepth",
                assistanceDepth: isHigh ? "low" : "high"
              })}
            >
              <span className="material-symbols-outlined">{isHigh ? "travel_explore" : "lightbulb"}</span>
              {isHigh ? "ハイ" : "ロウ"}
            </button>

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
              disabled={
                isGuidanceRequesting
                  ? false
                  : !canAskForGuidance || !trimmedInputText || isBusy
              }
              title={isGuidanceRequesting ? "回答生成を中断" : isEnterSendConfirmed ? "もう一度 Enter で送信" : "送信"}
              aria-label={isGuidanceRequesting ? "回答生成を中断" : "送信"}
              onClick={isGuidanceRequesting ? handleCancel : handleSend}
            >
              <span className="material-symbols-outlined">
                {isGuidanceRequesting ? "stop" : isEnterSendConfirmed ? "keyboard_return" : "arrow_upward"}
              </span>
            </button>
          </div>
        </div>
      </div>
      </div>
    </>
  );
}

function getSlashCommandQuery(value: string): string | undefined {
  const trimmed = value.trimStart();
  if (!trimmed.startsWith("/") || trimmed.includes("\n")) {
    return undefined;
  }

  return trimmed.slice(1).toLowerCase();
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
