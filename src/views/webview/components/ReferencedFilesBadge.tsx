import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, FocusEvent } from "react";
import type { RequestPlanFile } from "../../../shared/types";

interface ReferencedFilesBadgeProps {
  files?: RequestPlanFile[];
}

const MAX_INLINE_FILE_COUNT = 2;
const CARD_GAP_PX = 6;
const VIEWPORT_PADDING_PX = 8;
const CARD_MAX_HEIGHT_PX = 240;

type CardPlacement = "above" | "below";

export function ReferencedFilesBadge({ files }: ReferencedFilesBadgeProps) {
  const badgeRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [placement, setPlacement] = useState<CardPlacement>("above");
  const [cardStyle, setCardStyle] = useState<CSSProperties>();
  const referencedFiles = (files ?? []).filter((file) => file.included);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  }, []);

  const updateCardPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const card = cardRef.current;
    if (!trigger) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const cardWidth = card?.offsetWidth ?? Math.min(360, window.innerWidth - VIEWPORT_PADDING_PX * 2);
    const naturalCardHeight = card?.scrollHeight ?? CARD_MAX_HEIGHT_PX;
    const availableAbove = Math.max(0, triggerRect.top - VIEWPORT_PADDING_PX);
    const availableBelow = Math.max(0, window.innerHeight - triggerRect.bottom - VIEWPORT_PADDING_PX);
    const preferredHeight = Math.min(naturalCardHeight, CARD_MAX_HEIGHT_PX);
    const nextPlacement: CardPlacement =
      availableAbove < preferredHeight + CARD_GAP_PX && availableBelow >= availableAbove ? "below" : "above";
    const availableHeight = nextPlacement === "below" ? availableBelow : availableAbove;
    const maxHeight = Math.max(1, Math.min(CARD_MAX_HEIGHT_PX, availableHeight - CARD_GAP_PX));
    const renderedHeight = Math.min(naturalCardHeight, maxHeight);
    const top =
      nextPlacement === "below"
        ? triggerRect.bottom + CARD_GAP_PX
        : triggerRect.top - CARD_GAP_PX - renderedHeight;
    const left = Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(triggerRect.left, window.innerWidth - VIEWPORT_PADDING_PX - cardWidth)
    );

    setPlacement(nextPlacement);
    setCardStyle({
      left,
      top: Math.max(VIEWPORT_PADDING_PX, top),
      maxHeight
    });
  }, []);

  const openCard = useCallback(() => {
    clearCloseTimer();
    setIsOpen(true);
    window.requestAnimationFrame(updateCardPosition);
  }, [clearCloseTimer, updateCardPosition]);

  const closeCard = useCallback(() => {
    clearCloseTimer();
    setIsPinned(false);
    setIsOpen(false);
  }, [clearCloseTimer]);

  const scheduleCloseCard = useCallback(() => {
    if (isPinned) {
      return;
    }

    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setIsOpen(false);
    }, 140);
  }, [clearCloseTimer, isPinned]);

  useLayoutEffect(() => {
    if (isOpen) {
      updateCardPosition();
    }
  }, [isOpen, referencedFiles.length, updateCardPosition]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target instanceof Node ? event.target : undefined;
      if (
        target &&
        (badgeRef.current?.contains(target) || cardRef.current?.contains(target))
      ) {
        return;
      }

      closeCard();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeCard();
      }
    }

    window.addEventListener("resize", updateCardPosition);
    window.addEventListener("scroll", updateCardPosition, true);
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updateCardPosition);
      window.removeEventListener("scroll", updateCardPosition, true);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeCard, isOpen, updateCardPosition]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  if (referencedFiles.length === 0) {
    return null;
  }

  const inlineFiles = referencedFiles.slice(0, MAX_INLINE_FILE_COUNT);
  const hiddenCount = Math.max(0, referencedFiles.length - inlineFiles.length);
  const label = [
    "参照ファイル:",
    ...inlineFiles.map((file) => getShortFileName(file.path)),
    hiddenCount > 0 ? `他${hiddenCount}個` : undefined
  ].filter(Boolean).join(" ");

  function handleTriggerClick() {
    if (isPinned) {
      closeCard();
      return;
    }

    setIsPinned(true);
    openCard();
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && badgeRef.current?.contains(event.relatedTarget)) {
      return;
    }

    if (!isPinned) {
      scheduleCloseCard();
    }
  }

  return (
    <div
      ref={badgeRef}
      className="referenced-files-badge"
      onMouseEnter={openCard}
      onMouseLeave={scheduleCloseCard}
      onFocus={openCard}
      onBlur={handleBlur}
    >
      <button
        ref={triggerRef}
        type="button"
        className="referenced-files-trigger"
        aria-label={`参照ファイル ${referencedFiles.length}件`}
        aria-expanded={isOpen}
        onClick={handleTriggerClick}
      >
        <span className="material-symbols-outlined">attach_file</span>
        <span className="referenced-files-label">{label}</span>
      </button>

      {isOpen && (
        <div
          ref={cardRef}
          className={`referenced-files-card ${placement}`}
          role="tooltip"
          style={cardStyle}
          onMouseEnter={openCard}
          onMouseLeave={scheduleCloseCard}
        >
          <div className="referenced-files-card-title">参照ファイル</div>
          <div className="referenced-files-card-list">
            {referencedFiles.map((file) => (
              <div key={file.path} className="referenced-files-card-item">
                <span className="material-symbols-outlined">description</span>
                <div className="referenced-files-card-copy">
                  <div className="referenced-files-card-name">{getShortFileName(file.path)}</div>
                  <div className="referenced-files-card-path">{normalizePath(file.path)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getShortFileName(filePath: string): string {
  const normalized = normalizePath(filePath);
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}
