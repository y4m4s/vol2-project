import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { PageHeader } from "../webview/components/BackHeader";
import { ChatInputComposer } from "../webview/components/ChatInputComposer";
import { MermaidDiagram } from "../webview/components/MermaidDiagram";
import { ReferencedFilesBadge } from "../webview/components/ReferencedFilesBadge";
import { useApp } from "../webview/state/AppContext";
import { formatTime } from "../webview/utils/formatTime";
import { formatConnectionState } from "../webview/utils/formatState";
import { formatCostUsd, formatTokenCount } from "../webview/utils/formatUsage";
import { getSelectionLabel } from "../webview/utils/labelUtils";
import type { ConversationEntry, FeedbackRating, RequestPlanSnapshot, TokenUsage } from "../../shared/types";

declare global {
  interface Window { __ICON_URI__: string; }
}

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "bullet" | "ordered"; items: string[] }
  | { type: "code"; text: string; lang?: string };

export function S04Conversation() {
  const { viewModel, send } = useApp();
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [viewModel?.conversationHistory, viewModel?.isBusy]);

  if (!viewModel) {
    return null;
  }

  const {
    connectionState,
    canConnect,
    requestState,
    conversationStreams,
    activeConversationStreamId,
    conversationHistory,
    savedKnowledgeSourceIds
  } = viewModel;

  const isThinking = requestState === "requesting_guidance";

  const activeStream = conversationStreams.find((stream) => stream.id === activeConversationStreamId);

  return (
    <div className="s04-root">
      <PageHeader
        title={activeStream?.title ?? "新しい相談"}
        subtitle={conversationHistory.length > 0
          ? `${conversationHistory.length}件のメッセージ`
          : "この会話専用の画面です"}
        back={{ title: "相談ホームへ戻る", ariaLabel: "相談ホームへ戻る", onClick: () => send({ type: "navigate", screen: "main" }) }}
        status={connectionState !== "connected" ? (
          <span className="status-pill">
            <span className="status-dot" />
            {formatConnectionState(connectionState)}
          </span>
        ) : null}
        actions={connectionState !== "connected" ? (
          <button
            className="s04-connect-btn"
            disabled={!canConnect}
            onClick={() => send({ type: "connect" })}
          >
            <span className="material-symbols-outlined">power</span>
            接続
          </button>
        ) : null}
        navIcons={[
          { icon: "history", title: "会話履歴", onClick: () => send({ type: "navigate", screen: "history" }) },
          { icon: "book", title: "ナレッジ", onClick: () => send({ type: "navigate", screen: "knowledge" }) },
          { icon: "settings", title: "設定", onClick: () => send({ type: "navigate", screen: "settings" }) },
          { icon: "add_comment", title: "新しい相談", onClick: () => send({ type: "navigate", screen: "main" }) },
        ]}
      />

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
            onRate={(id, rating) => send({ type: "rateAdvice", id, rating })}
          />
        ))}

        {isThinking && <ThinkingIndicator />}

        <div ref={chatBottomRef} />
      </div>

      <ChatInputComposer resetKey={activeConversationStreamId} />
    </div>
  );
}
function ChatBubble(
  {
    entry,
    alreadySaved,
    isSavingKnowledge,
    onSave,
    onRate
  }: {
    entry: ConversationEntry;
    alreadySaved: boolean;
    isSavingKnowledge: boolean;
    onSave: (id: string) => void;
    onRate: (id: string, rating: FeedbackRating) => void;
  }
) {
  const isUser = entry.role === "user";
  const label = isUser ? "あなた" : entry.kind === "always" ? "NaviCom (自動)" : "NaviCom";
  const selectedText = entry.basedOn?.selectedTextPreview;
  const isSelectionRequest = isUser && entry.kind === "context" && Boolean(selectedText);
  const slashCommandLabel = entry.slashCommand
    ? `/${entry.slashCommand}${entry.slashCommandScope === "deep" ? " deep" : ""}`
    : undefined;
  const depthLabel = entry.assistanceDepth === "high" ? "ハイ" : entry.assistanceDepth === "low" ? "ロウ" : undefined;
  const modelLabel = !isUser ? entry.modelLabel : undefined;

  return (
    <div className={`s04-bubble-wrap ${isUser ? "user" : "assistant"}`}>
      <div className="s04-bubble-meta">
        {isUser ? (
          <span className="material-symbols-outlined s04-bubble-icon">person</span>
        ) : (
          <img src={window.__ICON_URI__} alt="NaviCom" className="s04-bubble-icon s04-bubble-logo" />
        )}
        <span className="s04-bubble-role">{label}</span>
        {slashCommandLabel && <span className="s04-meta-pill command">{slashCommandLabel}</span>}
        {depthLabel && !isUser && <span className="s04-meta-pill depth">{depthLabel}</span>}
        {modelLabel && <span className="s04-meta-pill model" title={modelLabel}>{modelLabel}</span>}
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
      </div>

      {!isUser && (
        <ResponseActions
          text={entry.text}
          referencedFiles={entry.requestPlan?.targetFiles}
          tokenUsage={entry.tokenUsage}
          alreadySaved={alreadySaved}
          isSavingKnowledge={isSavingKnowledge}
          feedback={entry.feedback}
          onRate={(rating) => onRate(entry.id, rating)}
          onSave={() => onSave(entry.id)}
        />
      )}
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
            if (isMermaidBlock(block)) {
              return <MermaidDiagram key={index} code={block.text} />;
            }
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

function isMermaidBlock(block: Extract<MarkdownBlock, { type: "code" }>): boolean {
  if (block.lang === "mermaid") {
    return true;
  }

  // 言語タグなしのフェンスでも、先頭行が Mermaid のダイアグラム宣言なら描画を試みる
  if (block.lang) {
    return false;
  }

  const firstLine = block.text.trimStart().split("\n")[0]?.trim() ?? "";
  return /^(flowchart|graph)\s/.test(firstLine) || /^(sequenceDiagram|classDiagram|stateDiagram)/.test(firstLine);
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listType: "bullet" | "ordered" | undefined;
  let codeLines: string[] = [];
  let codeLang: string | undefined;
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
        blocks.push({ type: "code", text: codeLines.join("\n"), lang: codeLang });
        codeLines = [];
        codeLang = undefined;
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        codeLang = trimmed.slice(3).trim().toLowerCase() || undefined;
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
    blocks.push({ type: "code", text: codeLines.join("\n"), lang: codeLang });
  }

  flushParagraph();
  flushList();

  return blocks.length > 0 ? blocks : [{ type: "paragraph", text }];
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
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
    referencedFiles,
    tokenUsage,
    alreadySaved,
    isSavingKnowledge,
    feedback,
    onRate,
    onSave
  }: {
    text: string;
    referencedFiles?: RequestPlanSnapshot["targetFiles"];
    tokenUsage?: TokenUsage;
    alreadySaved: boolean;
    isSavingKnowledge: boolean;
    feedback?: FeedbackRating;
    onRate: (rating: FeedbackRating) => void;
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
      <ReferencedFilesBadge files={referencedFiles} />

      <div className="s04-response-action-buttons">
        {tokenUsage && (
          <span
            className="s04-response-usage"
            title={`入力 ${tokenUsage.inputTokens} / 出力 ${tokenUsage.outputTokens} トークン`}
          >
            約{formatTokenCount(tokenUsage.inputTokens + tokenUsage.outputTokens)}トークン（目安 {formatCostUsd(tokenUsage.estimatedCostUsd)}）消費
          </span>
        )}

        <button
          className={`s04-response-action ${feedback === "good" ? "active feedback-good" : ""}`}
          title={feedback ? "評価済み" : "Good"}
          disabled={Boolean(feedback)}
          onClick={() => onRate("good")}
        >
          <span className="material-symbols-outlined">thumb_up</span>
        </button>

        <button
          className={`s04-response-action ${feedback === "bad" ? "active feedback-bad" : ""}`}
          title={feedback ? "評価済み" : "Bad"}
          disabled={Boolean(feedback)}
          onClick={() => onRate("bad")}
        >
          <span className="material-symbols-outlined">thumb_down</span>
        </button>

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
    </div>
  );
}


function ThinkingIndicator() {
  return (
    <div className="s04-bubble-wrap assistant">
      <div className="s04-bubble-meta">
        <img src={window.__ICON_URI__} alt="NaviCom" className="s04-bubble-icon s04-bubble-logo" />
        <span className="s04-bubble-role">NaviCom</span>
      </div>
      <div className="s04-bubble assistant">
        <div className="s04-thinking">
          <span className="s04-thinking-dot" />
          <span className="s04-thinking-dot" />
          <span className="s04-thinking-dot" />
        </div>
      </div>
    </div>
  );
}
