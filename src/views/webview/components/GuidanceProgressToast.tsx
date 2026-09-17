import { guidanceProgressState } from "../../../shared/uiActivity";
import { useApp } from "../state/AppContext";
import { FloatingToast } from "./FloatingToast";

export function GuidanceProgressToast({ placement = "floating" }: {
  placement?: "floating" | "composer";
}) {
  const { viewModel, send } = useApp();
  if (!viewModel) return null;
  const hasComposer = ["main", "conversation", "advice_detail"].includes(viewModel.screen);
  // The composer owns its progress indicator; other screens retain the global one.
  if (hasComposer !== (placement === "composer")) return null;
  const progress = guidanceProgressState(viewModel.requestState, viewModel.screen);
  const status = viewModel.requestState === "idle" && viewModel.statusMessage?.scope === "guidance"
    ? viewModel.statusMessage : undefined;
  const showStatus = !progress && Boolean(status);
  return (
    <FloatingToast
      open={Boolean(progress || status)}
      placement={placement === "composer" ? "anchored" : "floating"}
      kind={showStatus ? status?.kind : "info"}
      icon={progress ? "auto_awesome" : undefined}
      title={progress?.title}
      message={progress?.message ?? status?.text ?? ""}
      persist={Boolean(progress)}
      progress={progress ? "running" : undefined}
      durationMs={status?.kind === "error" || status?.action ? 10_000 : undefined}
      actionLabel={showStatus && status?.action === "openConnectionSettings" ? "接続設定を開く" : undefined}
      onAction={showStatus && status?.action === "openConnectionSettings" ? () => send({ type: "navigate", screen: "settings" }) : undefined}
    />
  );
}
