import React from "react";
import { useApp } from "../state/AppContext";

type BackButtonProps = {
  title?: string;
  ariaLabel?: string;
  className?: string;
  onClick?: () => void;
};

type PageHeaderProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export function BackButton({
  title = "戻る",
  ariaLabel = title,
  className,
  onClick
}: BackButtonProps) {
  const { send } = useApp();
  const classes = ["back-button", className].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={classes}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick ?? (() => send({ type: "navigateBack" }))}
    >
      <span className="material-symbols-outlined">arrow_back</span>
    </button>
  );
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  const classes = ["page-header", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <BackButton />
      <div className="page-header-copy">
        <div className="page-title">{title}</div>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  );
}

export function BackHeader() {
  return <BackButton />;
}
