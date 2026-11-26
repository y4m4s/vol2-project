import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

export interface SettingsSelectOption<T extends string> {
  value: T;
  label: string;
  /** 選択肢の補足（右側に薄く表示） */
  meta?: string;
}

/**
 * 設定画面用のドロップダウン。ネイティブの <select> は OS・テーマ依存の見た目になり
 * 設定画面のボタン（choice-option）と揃わないため、ボタン＋一覧（listbox）で組む。
 *
 * - クリック、または ↓ / Enter / Space で開く。↑↓ で移動、Enter で決定、Esc / Tab / 外側クリックで閉じる
 * - value が options にない場合は placeholder を表示する（「言語を追加」のような操作用）
 */
export function SettingsSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  disabled = false,
  className = ""
}: {
  value?: T;
  options: Array<SettingsSelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function openList() {
    if (disabled || options.length === 0) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function close(focusTrigger = true) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    close();
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openList();
    }
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(options.length - 1, index + 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 1));
        return;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        return;
      case "End":
        event.preventDefault();
        setActiveIndex(options.length - 1);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(activeIndex);
        return;
      case "Escape":
        event.preventDefault();
        close();
        return;
      case "Tab":
        close(false);
        return;
    }
  }

  return (
    <div ref={rootRef} className={`settings-select ${open ? "open" : ""} ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`settings-select-trigger ${selected ? "" : "placeholder"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={selected ? `${ariaLabel}: ${selected.label}` : ariaLabel}
        disabled={disabled || options.length === 0}
        onClick={() => (open ? close() : openList())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="settings-select-value">{selected?.label ?? placeholder ?? ""}</span>
        <span className="material-symbols-outlined settings-select-chevron" aria-hidden="true">expand_more</span>
      </button>
      {open && (
        <div
          ref={listRef}
          id={listId}
          className="settings-select-list"
          role="listbox"
          aria-label={ariaLabel}
          aria-activedescendant={`${listId}-${activeIndex}`}
          tabIndex={-1}
          onKeyDown={handleListKeyDown}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={isSelected}
                className={`settings-select-option ${index === activeIndex ? "active" : ""} ${isSelected ? "selected" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span className="material-symbols-outlined settings-select-check" aria-hidden="true">{isSelected ? "done" : ""}</span>
                <span className="settings-select-option-label">{option.label}</span>
                {option.meta && <span className="settings-select-option-meta">{option.meta}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
