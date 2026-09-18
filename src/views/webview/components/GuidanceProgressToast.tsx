import { useRef } from "react";
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
  return (
    <>
      {/* Keep timers mounted across navigation so old completion notices do not replay. */}
      <div hidden={hasComposer || (!busy && !completed)}>
        <FloatingToast key={revision} placement="corner" open={busy || completed}
          kind={busy ? "info" : "success"} icon={busy ? "progress_activity" : "check_circle"}
          message={busy ? "生成中…" : "生成完了"} persist={busy} durationMs={4000}
          onActivate={!busy && completed && viewModel.guidanceCompletedStreamId
            ? () => send({ type: "selectConversationStream", id: viewModel.guidanceCompletedStreamId! }) : undefined} />
      </div>
      {/* Result notifications belong to the app, not to a screen's composer. */}
      <div className={!hasComposer && completed ? "guidance-result-above-completion" : undefined}>
    <FloatingToast
      open={Boolean(status)}
      kind={status?.kind}
      message={status?.text ?? ""}
      durationMs={status?.kind === "error" || status?.action ? 10_000 : undefined}
      actionLabel={status?.action === "openConnectionSettings" ? "接続設定を開く" : undefined}
      onAction={status?.action === "openConnectionSettings" ? () => send({ type: "navigate", screen: "settings" }) : undefined}
    />
      </div>
    </>
  );
}
