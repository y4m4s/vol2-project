import { useAutoResizeTextarea } from "../hooks/useAutoResizeTextarea";

interface AdditionalContextButtonProps {
  open: boolean;
  hasValue: boolean;
  readOnly?: boolean;
  onClick: () => void;
}

interface AdditionalContextPanelProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

interface AdditionalContextReadonlyPanelProps {
  id: string;
  value: string;
}

export function AdditionalContextButton({ open, hasValue, readOnly = false, onClick }: AdditionalContextButtonProps) {
  const label = readOnly
    ? "追加コンテキストを表示"
    : hasValue
      ? "追加コンテキストを編集"
      : "追加コンテキストを追加";

  return (
    <button
      type="button"
      className={`additional-context-toggle ${open ? "open" : ""} ${hasValue ? "active" : ""}`}
      title={label}
      aria-label={label}
      aria-expanded={open}
      onClick={onClick}
    >
      <span className="material-symbols-outlined">description</span>
    </button>
  );
}

export function AdditionalContextPanel({ id, value, onChange }: AdditionalContextPanelProps) {
  const textareaRef = useAutoResizeTextarea(value);

  function handleClear() {
    onChange("");
    textareaRef.current?.focus();
  }

  return (
    <div className="additional-context-panel">
      <div className="additional-context-head">
        <div className="additional-context-title">
          <span className="material-symbols-outlined">description</span>
          追加コンテキスト
        </div>
        <button
          type="button"
          className="additional-context-clear"
          title="追加コンテキストを消去"
          aria-label="追加コンテキストを消去"
          disabled={!value.trim()}
          onClick={handleClear}
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <textarea
        ref={textareaRef}
        id={id}
        className="additional-context-input"
        placeholder="課題文、プロダクト方針、実装で守りたい前提など"
        rows={2}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function AdditionalContextReadonlyPanel({ id, value }: AdditionalContextReadonlyPanelProps) {
  return (
    <div className="additional-context-panel readonly" id={id}>
      <div className="additional-context-head">
        <div className="additional-context-title">
          <span className="material-symbols-outlined">description</span>
          追加コンテキスト
        </div>
      </div>

      <div className="additional-context-readonly">{value}</div>
    </div>
  );
}
