import React, { useState, useRef, useEffect } from "react";
import { useApp } from "../webview/state/AppContext";
import type { ConversationEntry, AutoAdviceState } from "../../shared/types";

declare global {
  interface Window { __ICON_URI__: string; }
}

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "bullet" | "ordered"; items: string[] }
  | { type: "code"; text: string };

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
            <div className="s02-advice-body">
              <MarkdownText text={truncate(latestGuidance.text, 200)} />
            </div>
            <ResponseActions
              text={latestGuidance.text}
              onSave={() => send({ type: "saveKnowledge", id: latestGuidance.id })}
            />
          </div>
        )}

        {conversationHistory.length === 0 && !latestGuidance && (
          <div className="s02-empty">
            <img src={window.__ICON_URI__} alt="NaviCom" className="s02-empty-icon-img" />
            <div className="s02-empty-title">会話を開始してください</div>
            <div className="s02-empty-desc">
              質問を入力するか、コードを選択してその箇所について相談できます
            </div>
          </div>
        )}

        {conversationHistory.map((entry) => (
          <ChatBubble
            key={entry.id}
            entry={entry}
            onSave={(id) => send({ type: "saveKnowledge", id })}
          />
        ))}

        <div ref={chatBottomRef} />
      </div>

      {/* ── 入力エリア ── */}
      <div className="s02-input-area">
        <div className="s02-input-wrap">
          {contextPreview.selectedTextPreview && (
            <div className="s02-selected-context" title={contextPreview.selectedTextPreview}>
              <span className="material-symbols-outlined">keyboard_return</span>
              <span className="s02-selected-context-text">
                “{getSelectionLabel(contextPreview.selectedTextPreview)}”
              </span>
            </div>
          )}
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
            </div>
            <div className="s02-footer-right">
              <button
                className={`s02-footer-btn ${isAlways ? "mode-on" : ""}`}
                title={isAlways ? "必要時モードに切り替え" : canSwitchMode ? "常時モードに切り替え" : "常時モードは Copilot 接続後に利用できます"}
                disabled={!canSwitchMode && !isAlways}
                onClick={() => send({ type: "setMode", mode: isAlways ? "manual" : "always" })}
              >
                <span className="material-symbols-outlined">bolt</span>
                <span className="s02-footer-btn-label">{isAlways ? "常時" : "必要時"}</span>
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

function ChatBubble({ entry, onSave }: { entry: ConversationEntry; onSave: (id: string) => void }) {
  const isUser = entry.role === "user";
  const label = isUser ? "あなた" : entry.kind === "always" ? "NaviCom (自動)" : "NaviCom";
  const selectedText = entry.basedOn?.selectedTextPreview;
  const isSelectionRequest = isUser && entry.kind === "context" && Boolean(selectedText);

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
        {isSelectionRequest ? (
          <>
            <SelectionReference selectedText={selectedText} />
            {entry.text.trim() && entry.text !== "この箇所を相談" && (
              <div className="s02-bubble-text s02-selection-question">{entry.text}</div>
            )}
          </>
        ) : (
          <div className="s02-bubble-text">
            {isUser ? entry.text : <MarkdownText text={entry.text} />}
          </div>
        )}
        {!isUser && (
          <ResponseActions text={entry.text} onSave={() => onSave(entry.id)} />
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
            return <div key={index} className="s02-md-heading">{renderInlineMarkdown(block.text)}</div>;
          case "bullet":
          case "ordered":
            const ListTag = block.type === "ordered" ? "ol" : "ul";
            return (
              <ListTag key={index} className="s02-md-list">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
                ))}
              </ListTag>
            );
          case "code":
            return <pre key={index} className="s02-md-code"><code>{block.text}</code></pre>;
          case "paragraph":
          default:
            return <p key={index} className="s02-md-paragraph">{renderInlineMarkdown(block.text)}</p>;
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
        <code key={key} className="s02-md-inline-code">
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
    <div className="s02-selection-reference" title={selectedText}>
      <span className="s02-selection-reference-label">選択された箇所:</span>
      <span className="s02-selection-reference-text">{getSelectionLabel(selectedText)}</span>
    </div>
  );
}

function ResponseActions({ text, onSave }: { text: string; onSave: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleSave() {
    onSave();
    setSaved(true);
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
    <div className="s02-response-actions">
      <button
        className={`s02-response-action ${saved ? "active" : ""}`}
        title={saved ? "ナレッジ化を開始しました" : "ナレッジ化して保存"}
        aria-label={saved ? "ナレッジ化を開始しました" : "ナレッジ化して保存"}
        onClick={handleSave}
      >
        <span className="material-symbols-outlined">{saved ? "bookmark_added" : "bookmark_add"}</span>
      </button>
      <button
        className={`s02-response-action ${copied ? "active" : ""}`}
        title={copied ? "コピーしました" : "回答をコピー"}
        aria-label={copied ? "コピーしました" : "回答をコピー"}
        onClick={() => void handleCopy()}
      >
        <span className="material-symbols-outlined">{copied ? "done" : "content_copy"}</span>
      </button>
    </div>
  );
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

function getSelectionLabel(preview: string): string {
  const firstLine = preview.split('\n')[0].trim();
  return firstLine.length > 96 ? firstLine.slice(0, 96) + '…' : firstLine;
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
