import { useAutoResizeTextarea } from "../hooks/useAutoResizeTextarea";
import { ReferenceSourceManager } from "./ReferenceSourceManager";

interface AdditionalContextButtonProps {
  open: boolean;
  hasValue: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface AdditionalContextPanelProps {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
}

export function AdditionalContextButton({ open, hasValue, disabled = false, onClick }: AdditionalContextButtonProps) {
  const label = hasValue ? "追加コンテキストを編集" : "追加コンテキストを追加";

  return (
    <button
      type="button"
      className={`additional-context-toggle ${open ? "open" : ""} ${hasValue ? "active" : ""}`}
      title={label}
      aria-label={label}
      aria-expanded={open}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="material-symbols-outlined">description</span>
    </button>
  );
}

export function AdditionalContextPanel({ id, value, disabled = false, onChange, onClose }: AdditionalContextPanelProps) {
  const textareaRef = useAutoResizeTextarea(value);

  return (
    <div className="additional-context-panel">
      <div className="additional-context-head">
        <div className="additional-context-title">
          <span className="material-symbols-outlined">description</span>
          コンテキスト
        </div>
        <button
          type="button"
          className="additional-context-clear"
          title="追加コンテキストを閉じる"
          aria-label="追加コンテキストを閉じる"
          onClick={onClose}
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <textarea
        ref={textareaRef}
        id={id}
        className="additional-context-input"
        placeholder="補足や課題文を入力…"
        rows={2}
        maxLength={10000}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <ReferenceSourceManager disabled={disabled} />
    </div>
  );
}
