import { useEffect, useMemo, useRef, useState } from "react";
import type { AiProviderId, NavigatorStatusMessage } from "../../../shared/types";
import { ProviderLogo } from "./ProviderLogo";

type FloatingToastKind = NavigatorStatusMessage["kind"] | "success";
type FloatingToastPhase = "hidden" | "show" | "leaving";
type FloatingToastIcon = "auto_awesome" | "check_circle" | "crisis_alert" | "warning";

const DEFAULT_ICONS: Record<FloatingToastKind, { icon: FloatingToastIcon }> = {
  error: { icon: "crisis_alert" },
  warning: { icon: "warning" },
  success: { icon: "check_circle" },
  info: { icon: "check_circle" }
};

interface FloatingToastProps {
  open: boolean;
  message: string;
  kind?: FloatingToastKind;
  title?: string;
  icon?: FloatingToastIcon;
  providerIconId?: AiProviderId;
  persist?: boolean;
  durationMs?: number;
  progress?: "running" | "done";
  actionLabel?: string;
  onAction?: () => void;
}

const DEFAULT_DURATION_MS = 2600;
const FADE_DURATION_MS = 420;

export function FloatingToast({
  open,
  message,
  kind = "info",
  title,
  icon,
  providerIconId,
  persist = false,
  durationMs = DEFAULT_DURATION_MS,
  progress,
  actionLabel,
  onAction
}: FloatingToastProps) {
  const [phase, setPhase] = useState<FloatingToastPhase>("hidden");
  const dismissedSignatureRef = useRef<string | undefined>(undefined);

  const signature = useMemo(
    () => [kind, icon ?? providerIconId ?? "", title ?? "", message, progress ?? "", actionLabel ?? "", persist ? "persist" : "auto"].join("\n"),
    [actionLabel, icon, kind, message, persist, progress, providerIconId, title]
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
  const layoutClass = title ? "" : " single-line";

  return (
    <div
      className={`floating-toast ${kind}${progressClass}${layoutClass}${phase === "leaving" ? " leaving" : ""}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
    >
      {providerIconId
        ? <ProviderLogo providerId={providerIconId} className="floating-toast-provider-logo" />
        : <span className="material-symbols-outlined floating-toast-icon">{resolvedIcon}</span>}
      <div className="floating-toast-body">
        {title && <div className="floating-toast-title">{title}</div>}
        <div className={title ? "floating-toast-desc" : "floating-toast-message"}>{message}</div>
        {actionLabel && onAction && <button type="button" className="floating-toast-action" onClick={onAction}>{actionLabel}</button>}
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
  return DEFAULT_ICONS[kind].icon;
}
