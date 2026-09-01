import { useEffect, useState } from "react";

interface ConfirmDeleteButtonProps {
  className: string;
  ariaLabel: string;
  label?: string;
  disabled?: boolean;
  onConfirm: () => void;
}

const CONFIRM_TIMEOUT_MS = 3_000;

export function ConfirmDeleteButton({
  className,
  ariaLabel,
  label,
  disabled = false,
  onConfirm
}: ConfirmDeleteButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) {
      return undefined;
    }
    const timer = window.setTimeout(() => setArmed(false), CONFIRM_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className={`${className}${armed ? " confirming-delete" : ""}`}
      title={armed ? "もう一度押すと削除します" : "削除"}
      aria-label={armed ? `${ariaLabel}。もう一度押すと確定します` : ariaLabel}
      aria-pressed={armed}
      disabled={disabled}
      onBlur={() => setArmed(false)}
      onClick={(event) => {
        event.stopPropagation();
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        {armed ? "delete_forever" : "delete"}
      </span>
      {label && <span>{armed ? "もう一度押して確定" : label}</span>}
    </button>
  );
}
