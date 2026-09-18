import { useEffect, useRef, useState } from "react";
import { guidanceProgressState } from "../../../shared/uiActivity";
import { useApp } from "../state/AppContext";
import { FloatingToast } from "./FloatingToast";

export function GuidanceProgressToast({ placement = "floating" }: {
  placement?: "floating" | "composer";
}) {
  const { viewModel, send } = useApp();
  const initialCompletion = useRef(viewModel?.guidanceCompletionRevision ?? 0);
  if (!viewModel) return null;
  const hasComposer = ["main", "conversation", "advice_detail"].includes(viewModel.screen);
  const progress = guidanceProgressState(viewModel.requestState, viewModel.screen);
  const status = viewModel.requestState === "idle" && viewModel.statusMessage?.scope === "guidance"
    ? viewModel.statusMessage : undefined;
  if (placement === "composer") {
    return <FloatingToast open={Boolean(progress)} placement="anchored" icon="auto_awesome"
      title={progress?.title} message={progress?.message ?? ""} persist progress="running" />;
  }
  const busy = viewModel.requestState === "preparing_guidance" || viewModel.requestState === "requesting_guidance";
  const revision = viewModel.guidanceCompletionRevision ?? 0;
  const completed = Boolean(viewModel.guidanceCompleted) && revision > initialCompletion.current;
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const lastBusyRef = useRef(busy);
  useEffect(() => {
    if (busy !== lastBusyRef.current) {
      lastBusyRef.current = busy;
      if (busy) setCompletionDismissed(false);
    }
  }, [busy]);
  const statusSignature = status ? `${status.kind}\n${status.text}\n${status.action ?? ""}` : undefined;
  const dismissedStatusRef = useRef<string | undefined>(undefined);
  const [, forceRender] = useState(0);
  return (
    <>
      {/* Keep timers mounted across navigation so old completion notices do not replay. */}
      <div hidden={hasComposer || (!busy && !completed)}>
        <FloatingToast key={revision} placement="corner" open={(busy || completed) && !(completed && completionDismissed)}
          kind={busy ? "info" : "success"} icon={busy ? "progress_activity" : "check_circle"}
          message={busy ? "生成中…" : "生成完了"} persist={busy} durationMs={4000}
          onActivate={!busy && completed && viewModel.guidanceCompletedStreamId
            ? () => send({ type: "selectConversationStream", id: viewModel.guidanceCompletedStreamId! }) : undefined}
          onDismiss={busy ? undefined : () => setCompletionDismissed(true)} />
      </div>
      {/* Result notifications belong to the app, not to a screen's composer. */}
      <div className={!hasComposer && completed ? "guidance-result-above-completion" : undefined}>
    <FloatingToast
      open={Boolean(status) && dismissedStatusRef.current !== statusSignature}
      kind={status?.kind}
      message={status?.text ?? ""}
      durationMs={status?.kind === "error" || status?.action ? 10_000 : undefined}
      actionLabel={status?.action === "openConnectionSettings" ? "接続設定を開く" : undefined}
      onAction={status?.action === "openConnectionSettings" ? () => send({ type: "navigate", screen: "settings" }) : undefined}
      onDismiss={() => {
        dismissedStatusRef.current = statusSignature;
        forceRender((n) => n + 1);
      }}
    />
      </div>
    </>
  );
}
