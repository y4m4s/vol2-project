import { useRef, useState } from "react";
import { useApp } from "./state/AppContext";
import { S01Connection } from "../screens/s01-connection";
import { S02Main } from "../screens/s02-main";
import { S04Conversation } from "../screens/s04-conversation";
import { S05Knowledge } from "../screens/s05-knowledge";
import { S05KnowledgeDetail } from "../screens/s05-knowledge-detail";
import { S06Settings } from "../screens/s06-settings";
import { S07Error } from "../screens/s07-error";
import { S08History } from "../screens/s08-history";
import { S09FeedbackForm } from "../screens/s09-feedback-form";
import { FloatingToast } from "./components/FloatingToast";
import { GuidanceProgressToast } from "./components/GuidanceProgressToast";
import type { NavigatorScreen } from "../../shared/types";

const KNOWLEDGE_SAVE_PENDING_TEXT = "接続中の AI でアドバイスをナレッジ用に整理しています...";
const KNOWLEDGE_SAVE_DONE_TEXT = "アドバイスを整理してナレッジとして保存しました。";

export function App() {
  const { viewModel, operationError, operationErrorRevision, dismissOperationError } = useApp();

  if (!viewModel) {
    return <div style={{ padding: 16, opacity: 0.5 }}>読み込み中...</div>;
  }

  const screen = viewModel.screen;

  return (
    <>
      {renderScreen(screen)}
      <StatusMessageToast />
      <KnowledgeSaveToast />
      <GuidanceProgressToast />
      <FloatingToast
        key={operationErrorRevision}
        open={Boolean(operationError)}
        kind="error"
        message={operationError ?? ""}
        onDismiss={dismissOperationError}
      />
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
    case "feedback_form":
      return (
        <div className="s09-layer-host">
          <div className="s09-background" aria-hidden="true" inert>
            <S04Conversation />
          </div>
          <S09FeedbackForm />
        </div>
      );
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

  const dismissedRef = useRef<string | undefined>(undefined);
  const [, forceRender] = useState(0);
  const signature = isSaving ? "saving" : saveCompleted ? "done" : undefined;
  const open = Boolean(signature) && dismissedRef.current !== signature;

  const title = isSaving
    ? "ナレッジに整理しています"
    : "ナレッジとして保存しました";
  const description = isSaving
    ? "接続中の AI がアドバイスを再利用しやすい形にまとめています。"
    : "あとからナレッジ管理で見返せます。";

  return (
    <FloatingToast
      open={open}
      kind="success"
      icon={isSaving ? "auto_awesome" : "check_circle"}
      title={title}
      message={description}
      persist={isSaving}
      progress={isSaving ? "running" : "done"}
      onDismiss={isSaving ? undefined : () => {
        dismissedRef.current = signature;
        forceRender((n) => n + 1);
      }}
    />
  );
}

function StatusMessageToast() {
  const { viewModel, send } = useApp();
  const statusMessage = viewModel?.statusMessage;
  const isCheckingRoutingConnection =
    viewModel?.requestState === "connecting" &&
    viewModel.routingProviderConnection?.state === "connecting";
  const shouldSuppress =
    !statusMessage ||
    statusMessage.scope === "guidance" ||
    viewModel?.requestState === "preparing_guidance" ||
    viewModel?.requestState === "saving_knowledge" ||
    statusMessage.text === KNOWLEDGE_SAVE_PENDING_TEXT ||
    statusMessage.text === KNOWLEDGE_SAVE_DONE_TEXT;

  const signature = statusMessage ? `${statusMessage.kind}\n${statusMessage.text}\n${statusMessage.action ?? ""}` : undefined;
  const dismissedRef = useRef<string | undefined>(undefined);
  const [, forceRender] = useState(0);
  const open = !shouldSuppress && dismissedRef.current !== signature;

  return (
    <FloatingToast
      open={open}
      kind={statusMessage?.kind}
      providerIconId={isCheckingRoutingConnection ? viewModel.routingProviderConnection?.providerId : undefined}
      message={statusMessage?.text ?? ""}
      actionLabel={statusMessage?.action === "openConnectionSettings" ? "接続設定を開く" : undefined}
      onAction={statusMessage?.action === "openConnectionSettings" ? () => send({ type: "navigate", screen: "settings" }) : undefined}
      persist={isCheckingRoutingConnection}
      durationMs={statusMessage?.kind === "error" || statusMessage?.action ? 10_000 : undefined}
      onDismiss={isCheckingRoutingConnection ? undefined : () => {
        dismissedRef.current = signature;
        forceRender((n) => n + 1);
      }}
    />
  );
}
