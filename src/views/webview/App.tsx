import React, { useEffect, useState } from "react";
import { useApp } from "./state/AppContext";
import { S01Connection } from "../screens/s01-connection";
import { S02Main } from "../screens/s02-main";
import { S04Conversation } from "../screens/s04-conversation";
import { S05Knowledge } from "../screens/s05-knowledge";
import { S06Settings } from "../screens/s06-settings";
import { S07Error } from "../screens/s07-error";
import { S08History } from "../screens/s08-history";
import type { NavigatorScreen } from "../../shared/types";

export function App() {
  const { viewModel } = useApp();

  if (!viewModel) {
    return <div style={{ padding: 16, opacity: 0.5 }}>読み込み中...</div>;
  }

  const screen = viewModel.screen;

  return (
    <>
      {renderScreen(screen)}
      <KnowledgeSaveToast />
    </>
  );
}

function renderScreen(screen: NavigatorScreen) {
  switch (screen) {
    case "onboarding":
      return <S01Connection />;
    case "main":
      return <S02Main />;
    case "history":
      return <S08History />;
    case "conversation":
      return <S04Conversation />;
    case "advice_detail":
      return <S04Conversation />;
    case "knowledge":
      return <S05Knowledge />;
    case "settings":
      return <S06Settings />;
    case "error":
      return <S07Error />;
    default:
      return <S01Connection />;
  }
}

function KnowledgeSaveToast() {
  const { viewModel } = useApp();
  const [showCompleted, setShowCompleted] = useState(false);
  const isSaving = viewModel?.requestState === "saving_knowledge";
  const saveCompleted =
    viewModel?.statusMessage?.kind === "info" &&
    viewModel.statusMessage.text === "アドバイスを整理してナレッジとして保存しました。";

  useEffect(() => {
    if (!saveCompleted) {
      return;
    }

    setShowCompleted(true);
    const timer = window.setTimeout(() => setShowCompleted(false), 3200);
    return () => window.clearTimeout(timer);
  }, [saveCompleted, viewModel?.statusMessage?.text]);

  if (!isSaving && !showCompleted) {
    return null;
  }

  const state = isSaving ? "saving" : "done";
  const title = isSaving
    ? "ナレッジに整理しています"
    : "ナレッジとして保存しました";
  const description = isSaving
    ? "Copilot がアドバイスを再利用しやすい形にまとめています。"
    : "あとからナレッジ管理で見返せます。";

  return (
    <div className={`knowledge-save-toast ${state}`} role="status" aria-live="polite">
      <span className="material-symbols-outlined">
        {isSaving ? "auto_awesome_motion" : "check_circle"}
      </span>
      <div className="knowledge-save-toast-body">
        <div className="knowledge-save-toast-title">{title}</div>
        <div className="knowledge-save-toast-desc">{description}</div>
        <div className="knowledge-save-progress" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
