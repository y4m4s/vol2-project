import React, { useEffect, useRef, useState } from "react";
import { BackButton } from "../webview/components/BackHeader";
import { useApp } from "../webview/state/AppContext";
import type { AutoAdviceState, ConversationEntry } from "../../shared/types";

declare global {
  interface Window { __ICON_URI__: string; }
}

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "bullet" | "ordered"; items: string[] }
  | { type: "code"; text: string };

export function S04Conversation() {
  const { viewModel, send } = useApp();
  const [inputText, setInputText] = useState("");
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [viewModel?.conversationHistory, viewModel?.isBusy]);

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
  }, [viewModel?.activeConversationStreamId]);

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
    conversationStreams,
    activeConversationStreamId,
    conversationHistory,
    savedKnowledgeSourceIds
  } = viewModel;

  const activeStream = conversationStreams.find((stream) => stream.id === activeConversationStreamId);
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
    <div className="s04-root">
      <div className="s04-header">
        <BackButton
          className="s04-back-btn"
          title="相談ホームへ戻る"
          ariaLabel="相談ホームへ戻る"
          onClick={() => send({ type: "navigate", screen: "main" })}
        />

        <div className="s04-header-copy">
          <div className="s04-title-row">
            <div className="s04-title">{activeStream?.title ?? "新しい相談"}</div>
            {connectionState !== "connected" && (
              <span className="s04-status-pill">
                <span className="s04-status-dot" />
                {formatConnectionState(connectionState)}
              </span>
            )}
          </div>

          <div className="s04-subtitle">
            {conversationHistory.length > 0
              ? `${conversationHistory.length}件のメッセージ`
              : "この会話専用の画面です"}
          </div>
        </div>

        <div className="s04-header-actions">
          {connectionState !== "connected" && (
            <button
              className="s04-connect-btn"
              disabled={!canConnect}
              onClick={() => send({ type: "connect" })}
            >
              <span className="material-symbols-outlined">power</span>
              接続
            </button>
          )}

          <button
            className="s04-icon-btn"
            title="新しい相談"
            onClick={() => send({ type: "createConversationStream" })}
          >
            <span className="material-symbols-outlined">add_comment</span>
          </button>

          <button
            className="s04-icon-btn"
            title="会話履歴"
            onClick={() => send({ type: "navigate", screen: "history" })}
          >
            <span className="material-symbols-outlined">history</span>
          </button>

          <button
            className="s04-icon-btn"
            title="ナレッジ"
            onClick={() => send({ type: "navigate", screen: "knowledge" })}
          >
            <span className="material-symbols-outlined">book</span>
          </button>

          <button
            className="s04-icon-btn"
            title="設定"
            onClick={() => send({ type: "navigate", screen: "settings" })}
          >
            <span className="material-symbols-outlined">settings</span>
          </button>
        </div>
      </div>

      <div className="s04-chat">
        {conversationHistory.length === 0 && (
          <div className="s04-empty">
            <img src={window.__ICON_URI__} alt="NaviCom" className="s04-empty-icon" />
            <div className="s04-empty-title">ここから会話が始まります</div>
            <div className="s04-empty-desc">
              送信した質問と回答は、この画面だけに積み上がります
            </div>
          </div>
        )}

        {conversationHistory.map((entry) => (
          <ChatBubble
            key={entry.id}
            entry={entry}
            alreadySaved={savedKnowledgeSourceIds.includes(entry.id)}
            isSavingKnowledge={requestState === "saving_knowledge"}
            onSave={(id) => send({ type: "saveKnowledge", id })}
          />
        ))}

        <div ref={chatBottomRef} />
      </div>

      <div className="s04-input-area">
        <div className="s04-input-wrap">
          {contextPreview.selectedTextPreview && (
            <div className="s04-selected-context" title={contextPreview.selectedTextPreview}>
              <span className="material-symbols-outlined">code</span>
              <span className="s04-selected-context-text">
                {getSelectionLabel(contextPreview.selectedTextPreview)}
              </span>
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="s04-input"
            placeholder="質問を入力... (Shift+Enter で改行)"
            rows={1}
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={handleKeyDown}
          />

          <div className="s04-input-footer">
            <div className="s04-footer-right">
              {isAlways && (
                <div className={`s04-auto-inline ${isPaused ? "paused" : ""}`}>
                  <span className="material-symbols-outlined">
                    {isPaused ? "pause_circle" : "radio_button_checked"}
                  </span>
                  <span className="s04-auto-inline-text">{getAutoStatusText(autoAdvice)}</span>
                  <button
                    className="s04-auto-inline-toggle"
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
                className={`s04-mode-btn ${isAlways ? "always" : ""}`}
                title={isAlways ? "必要時モードへ切り替え" : "常時モードへ切り替え"}
                disabled={!canSwitchMode && !isAlways}
                onClick={() => send({ type: "setMode", mode: isAlways ? "manual" : "always" })}
              >
                <span className="material-symbols-outlined">bolt</span>
                {isAlways ? "常時" : "必要時"}
              </button>

              <button
                className="s04-send-btn"
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

function ChatBubble(
  {
    entry,
    alreadySaved,
    isSavingKnowledge,
    onSave
  }: {
    entry: ConversationEntry;
    alreadySaved: boolean;
    isSavingKnowledge: boolean;
    onSave: (id: string) => void;
  }
) {
  const isUser = entry.role === "user";
  const label = isUser ? "あなた" : entry.kind === "always" ? "NaviCom (自動)" : "NaviCom";
  const selectedText = entry.basedOn?.selectedTextPreview;
  const isSelectionRequest = isUser && entry.kind === "context" && Boolean(selectedText);

  return (
    <div className={`s04-bubble-wrap ${isUser ? "user" : "assistant"}`}>
      <div className="s04-bubble-meta">
        <span className="material-symbols-outlined s04-bubble-icon">
          {isUser ? "person" : "smart_toy"}
        </span>
        <span className="s04-bubble-role">{label}</span>
        <span className="s04-bubble-time">{formatTime(entry.createdAt)}</span>
      </div>

      <div className={`s04-bubble ${isUser ? "user" : "assistant"}`}>
        {isSelectionRequest ? (
          <>
            <SelectionReference selectedText={selectedText} />
            {entry.text.trim() && entry.text !== "この選択範囲を相談" && (
              <div className="s04-bubble-text s04-selection-question">{entry.text}</div>
            )}
          </>
        ) : (
          <div className="s04-bubble-text">
            {isUser ? entry.text : <MarkdownText text={entry.text} />}
          </div>
        )}

        {!isUser && (
          <ResponseActions
            text={entry.text}
            alreadySaved={alreadySaved}
            isSavingKnowledge={isSavingKnowledge}
            onSave={() => onSave(entry.id)}
          />
        )}
      </div>
    </div>
  );
}

function MarkdownText({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);

  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading":
            return (
              <div key={index} className="s04-md-heading">
                {renderInlineMarkdown(block.text)}
              </div>
            );
          case "bullet":
          case "ordered": {
            const ListTag = block.type === "ordered" ? "ol" : "ul";
            return (
              <ListTag key={index} className="s04-md-list">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
                ))}
              </ListTag>
            );
          }
          case "code":
            return (
              <pre key={index} className="s04-md-code">
                <code>{block.text}</code>
              </pre>
            );
          case "paragraph":
          default:
            return (
              <p key={index} className="s04-md-paragraph">
                {renderInlineMarkdown(block.text)}
              </p>
            );
        }
      })}
    </>
  );
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listType: "bullet" | "ordered" | undefined;
  let codeLines: string[] = [];
  let inCode = false;

  function flushParagraph() {
    if (paragraph.length === 0) {
      return;
    }

    blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
    paragraph = [];
  }

  function flushList() {
    if (listItems.length === 0 || !listType) {
      return;
    }

    blocks.push({ type: listType, items: listItems });
    listItems = [];
    listType = undefined;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCode) {
        blocks.push({ type: "code", text: codeLines.join("\n") });
        codeLines = [];
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", text: headingMatch[2].trim() });
      continue;
    }

    const bulletMatch = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (bulletMatch) {
      flushParagraph();
      if (listType && listType !== "bullet") {
        flushList();
      }
      listType = "bullet";
      listItems.push(bulletMatch[1].trim());
      continue;
    }

    const orderedMatch = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (orderedMatch) {
      flushParagraph();
      if (listType && listType !== "ordered") {
        flushList();
      }
      listType = "ordered";
      listItems.push(orderedMatch[1].trim());
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  if (inCode) {
    blocks.push({ type: "code", text: codeLines.join("\n") });
  }

  flushParagraph();
  flushList();

  return blocks.length > 0 ? blocks : [{ type: "paragraph", text }];
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${match.index}-${token.length}`;
    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="s04-md-inline-code">
          {token.slice(1, -1)}
        </code>
      );
    } else {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function SelectionReference({ selectedText }: { selectedText?: string }) {
  if (!selectedText) {
    return null;
  }

  return (
    <div className="s04-selection-reference" title={selectedText}>
      <span className="s04-selection-reference-label">選択範囲:</span>
      <span className="s04-selection-reference-text">{getSelectionLabel(selectedText)}</span>
    </div>
  );
}

function ResponseActions(
  {
    text,
    alreadySaved,
    isSavingKnowledge,
    onSave
  }: {
    text: string;
    alreadySaved: boolean;
    isSavingKnowledge: boolean;
    onSave: () => void;
  }
) {
  const [pendingSave, setPendingSave] = useState(false);
  const [copied, setCopied] = useState(false);
  const saveDisabled = alreadySaved || pendingSave || isSavingKnowledge;

  useEffect(() => {
    if (!isSavingKnowledge && !alreadySaved) {
      setPendingSave(false);
    }
  }, [alreadySaved, isSavingKnowledge]);

  function handleSave() {
    if (saveDisabled) {
      return;
    }

    setPendingSave(true);
    onSave();
  }

  async function handleCopy() {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="s04-response-actions">
      <button
        className={`s04-response-action ${alreadySaved ? "active" : ""}`}
        title={
          alreadySaved
            ? "ナレッジに保存しました"
            : pendingSave || isSavingKnowledge
              ? "ナレッジに整理しています"
              : "ナレッジとして保存"
        }
        disabled={saveDisabled}
        onClick={handleSave}
      >
        <span className="material-symbols-outlined">
          {alreadySaved ? "bookmark_added" : pendingSave ? "hourglass_empty" : "bookmark_add"}
        </span>
      </button>

      <button
        className={`s04-response-action ${copied ? "active" : ""}`}
        title={copied ? "コピーしました" : "内容をコピー"}
        onClick={() => void handleCopy()}
      >
        <span className="material-symbols-outlined">{copied ? "done" : "content_copy"}</span>
      </button>
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

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}
