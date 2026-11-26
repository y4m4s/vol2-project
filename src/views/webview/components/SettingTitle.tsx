import { type ReactNode, useId } from "react";

/** 設定画面の項目見出し（アイコン・ヘルプのツールチップ付き）。s06-settings と学習プロファイル節で共用する。 */
export function SettingTitle({
  icon,
  iconNode,
  endControl,
  children,
  help,
  id,
  htmlFor
}: {
  icon?: string;
  iconNode?: ReactNode;
  endControl?: ReactNode;
  children: ReactNode;
  help: string;
  id?: string;
  htmlFor?: string;
}) {
  const tooltipId = useId();
  const content = (
    <>
      {icon && <span className="material-symbols-outlined setting-title-icon" aria-hidden="true">{icon}</span>}
      {iconNode}
      <span>{children}</span>
    </>
  );

  return (
    <div className="setting-title-row">
      {htmlFor ? (
        <label id={id} className="setting-label setting-title" htmlFor={htmlFor}>{content}</label>
      ) : (
        <div id={id} className="setting-label setting-title">{content}</div>
      )}
      <div className="setting-title-actions">
        {endControl}
        <div className="setting-help">
          <button
            type="button"
            className="setting-help-button"
            aria-label="この項目のヘルプ"
            aria-describedby={tooltipId}
          >
            <HelpCircleIcon />
          </button>
          <div id={tooltipId} className="setting-help-tooltip" role="tooltip">
            {help}
          </div>
        </div>
      </div>
    </div>
  );
}

function HelpCircleIcon() {
  return (
    <svg
      className="setting-help-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9.5" />
      <path d="M9.4 9.1a2.75 2.75 0 1 1 4.7 1.95c-.98.97-2.1 1.45-2.1 2.95" />
      <path d="M12 17h.01" />
    </svg>
  );
}
