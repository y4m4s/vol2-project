import { useEffect, useMemo, useRef, useState } from "react";
import type { NavigatorStatusMessage } from "../../../shared/types";

type FloatingToastKind = NavigatorStatusMessage["kind"] | "success";
type FloatingToastPhase = "hidden" | "show" | "leaving";

interface FloatingToastProps {
  open: boolean;
  message: string;
  kind?: FloatingToastKind;
  title?: string;
  icon?: string;
  persist?: boolean;
  durationMs?: number;
  progress?: "running" | "done";
}

const DEFAULT_DURATION_MS = 2600;
const FADE_DURATION_MS = 420;

export function FloatingToast({
  open,
  message,
  kind = "info",
  title,
  icon,
  persist = false,
  durationMs = DEFAULT_DURATION_MS,
  progress
}: FloatingToastProps) {
  const [phase, setPhase] = useState<FloatingToastPhase>("hidden");
  const dismissedSignatureRef = useRef<string | undefined>(undefined);

  const signature = useMemo(
    () => [kind, icon ?? "", title ?? "", message, progress ?? "", persist ? "persist" : "auto"].join("\n"),
    [icon, kind, message, persist, progress, title]
  );

  useEffect(() => {
    let fadeTimer: number | undefined;
    let hideTimer: number | undefined;

    if (!open || !message) {
      dismissedSignatureRef.current = undefined;
      setPhase((current) => (current === "hidden" ? "hidden" : "leaving"));
      hideTimer = window.setTimeout(() => setPhase("hidden"), FADE_DURATION_MS);
      return () => {
        if (hideTimer) {
          window.clearTimeout(hideTimer);
        }
      };
    }

    if (!persist && dismissedSignatureRef.current === signature) {
      return;
    }

    dismissedSignatureRef.current = undefined;
    setPhase("show");

    if (!persist) {
      fadeTimer = window.setTimeout(() => setPhase("leaving"), durationMs);
      hideTimer = window.setTimeout(() => {
        dismissedSignatureRef.current = signature;
        setPhase("hidden");
      }, durationMs + FADE_DURATION_MS);
    }

    return () => {
      if (fadeTimer) {
        window.clearTimeout(fadeTimer);
      }
      if (hideTimer) {
        window.clearTimeout(hideTimer);
      }
    };
  }, [durationMs, message, open, persist, signature]);

  if (phase === "hidden") {
    return null;
  }

  const resolvedIcon = icon ?? getDefaultIcon(kind);
  const progressClass = progress ? ` progress-${progress}` : "";

  return (
    <div
      className={`floating-toast ${kind}${progressClass}${phase === "leaving" ? " leaving" : ""}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
    >
      <span className="material-symbols-outlined floating-toast-icon">{resolvedIcon}</span>
      <div className="floating-toast-body">
        {title && <div className="floating-toast-title">{title}</div>}
        <div className={title ? "floating-toast-desc" : "floating-toast-message"}>{message}</div>
        {progress && (
          <div className="floating-toast-progress" aria-hidden="true">
            <span />
          </div>
        )}
      </div>
    </div>
  );
}

function getDefaultIcon(kind: FloatingToastKind): string {
  switch (kind) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "success":
      return "check_circle";
    case "info":
    default:
      return "info";
  }
}
