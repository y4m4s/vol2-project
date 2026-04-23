import React from "react";
import { useApp } from "../webview/state/AppContext";

export function S07Error() {
  const { viewModel, send } = useApp();

  const isUnavailable = viewModel?.connectionState === "unavailable";
  const title = isUnavailable ? "Copilot を利用できません" : "現在は利用が制限されています";
  const description =
    viewModel?.statusMessage?.text ??
    (isUnavailable
      ? "Workspace Trust や Copilot の利用状態を確認してください。"
      : "少し時間を置いてから再試行してください。");

  return (
    <div className="s07-root">
      <span className="material-symbols-outlined s07-icon">error_outline</span>
      <div className="s07-title">{title}</div>
      <div className="s07-desc">{description}</div>
      <button onClick={() => send({ type: "connect" })}>
        <span className="material-symbols-outlined">refresh</span>
        再試行
      </button>
    </div>
  );
}
