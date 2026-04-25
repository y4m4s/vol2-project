import React from "react";
import { useApp } from "./state/AppContext";
import { S01Connection } from "../screens/s01-connection";
import { S02Main } from "../screens/s02-main";
import { S04Conversation } from "../screens/s04-conversation";
import { S05Knowledge } from "../screens/s05-knowledge";
import { S05KnowledgeDetail } from "../screens/s05-knowledge-detail";
import { S06Settings } from "../screens/s06-settings";
import { S07Error } from "../screens/s07-error";
import { S08History } from "../screens/s08-history";
import { FloatingToast } from "./components/FloatingToast";
import type { NavigatorScreen } from "../../shared/types";

const KNOWLEDGE_SAVE_PENDING_TEXT = "Copilot でアドバイスをナレッジ用に整理しています...";
const KNOWLEDGE_SAVE_DONE_TEXT = "アドバイスを整理してナレッジとして保存しました。";

export function App() {
  const { viewModel } = useApp();

  if (!viewModel) {
    return <div style={{ padding: 16, opacity: 0.5 }}>読み込み中...</div>;
  }

  const screen = viewModel.screen;

  return (
    <>
      {renderScreen(screen)}
      <StatusMessageToast />
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
    case "knowledge_detail":
      return <S05KnowledgeDetail />;
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
  const isSaving = viewModel?.requestState === "saving_knowledge";
  const saveCompleted =
    viewModel?.statusMessage?.kind === "info" &&
    viewModel.statusMessage.text === KNOWLEDGE_SAVE_DONE_TEXT;

  const title = isSaving
    ? "ナレッジに整理しています"
    : "ナレッジとして保存しました";
  const description = isSaving
    ? "Copilot がアドバイスを再利用しやすい形にまとめています。"
    : "あとからナレッジ管理で見返せます。";

  return (
    <FloatingToast
      open={Boolean(isSaving || saveCompleted)}
      kind="success"
      icon={isSaving ? "auto_awesome_motion" : "check_circle"}
      title={title}
      message={description}
      persist={isSaving}
      progress={isSaving ? "running" : "done"}
    />
  );
}

function StatusMessageToast() {
  const { viewModel } = useApp();
  const statusMessage = viewModel?.statusMessage;
  const shouldSuppress =
    !statusMessage ||
    viewModel?.requestState === "saving_knowledge" ||
    statusMessage.text === KNOWLEDGE_SAVE_PENDING_TEXT ||
    statusMessage.text === KNOWLEDGE_SAVE_DONE_TEXT;

  return (
    <FloatingToast
      open={!shouldSuppress}
      kind={statusMessage?.kind}
      message={statusMessage?.text ?? ""}
    />
  );
}
