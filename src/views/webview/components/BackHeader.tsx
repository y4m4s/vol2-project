import React from "react";
import { useApp } from "../state/AppContext";

type BackButtonProps = {
  title?: string;
  ariaLabel?: string;
  className?: string;
  onClick?: () => void;
};

export type NavIconDef = {
  icon: string;
  title: string;
  onClick: () => void;
};

type PageHeaderProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  back?: false | BackButtonProps;
  status?: React.ReactNode;
  extraContent?: React.ReactNode;
  actions?: React.ReactNode;
  navIcons?: NavIconDef[];
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

export function PageHeader({
  title,
  subtitle,
  back,
  status,
  extraContent,
  actions,
  navIcons,
  className
}: PageHeaderProps) {
  const classes = ["page-header", className].filter(Boolean).join(" ");
  const hasActions = actions != null || (navIcons && navIcons.length > 0);

  return (
    <div className={classes}>
      {back !== false && <BackButton {...(back === undefined ? {} : back)} />}
      <div className="page-header-copy">
        <div className="page-title-row">
          <div className="page-title">{title}</div>
          {status}
        </div>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
        {extraContent}
      </div>
      {hasActions && (
        <div className="page-header-actions">
          {actions}
          {navIcons?.map((item) => (
            <button
              key={item.icon}
              type="button"
              className="page-header-icon-btn"
              title={item.title}
              onClick={item.onClick}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function BackHeader() {
  return <BackButton />;
}
