import type { AiProviderId, AutomaticRoutingSettings } from "../../../shared/types";
import { PROVIDER_LABELS } from "../../../services/ProviderRouting";
import { useApp } from "../state/AppContext";
import { ProviderLogo } from "./ProviderLogo";

export function ConnectionActivity() {
  const { viewModel, send } = useApp();
  if (!viewModel) return null;

  const hasConnectionActivity =
    viewModel.connectionState === "connected" ||
    viewModel.connectionState === "connecting" ||
    viewModel.connectionState === "consent_pending";
  if (!hasConnectionActivity || viewModel.screen === "onboarding") return null;

  const routingMode = viewModel.settings.routing?.mode ?? "manual";
  const isAutomatic = routingMode !== "manual";
  const basicProviderId: AiProviderId = isAutomatic
    ? viewModel.settings.routing?.preferredProviderId ?? viewModel.settings.providerId
    : viewModel.providerId;
  const isCurrentProvider = basicProviderId === viewModel.providerId;
  const isConnected = isCurrentProvider && viewModel.connectionState === "connected";
  const isAvailable = isConnected || (!isCurrentProvider && (viewModel.testedProviderIds ?? []).includes(basicProviderId));
  const stateLabel = isConnected ? "接続中" : isAvailable ? "接続可能" : "未接続";
  const modelLabel = isCurrentProvider
    ? viewModel.modelLabel?.replace(/^(GitHub Copilot|LM Studio|Ollama|OrcaRouter)\s*[·：:]\s*/, "")
    : undefined;

  return (
    <>
      {isAutomatic && <RoutingModeActivity mode={routingMode} onClick={() => send({ type: "navigate", screen: "settings" })} />}
      <div className="connection-activity">
        <button
          type="button"
          className={`connection-activity-provider ${basicProviderId.toLowerCase()} ${isAvailable ? "connected" : "switching"}`}
          aria-label={`${PROVIDER_LABELS[basicProviderId]} ${stateLabel}${isAutomatic ? "、基本プロバイダー" : ""}。接続設定を開く`}
          aria-describedby="connection-activity-tooltip"
          onClick={() => send({ type: "navigate", screen: "settings" })}
        >
          <ProviderLogo providerId={basicProviderId} className="connection-activity-provider-logo" />
          <span className={`connection-activity-state ${isAvailable ? "connected" : "switching"}`} aria-hidden="true">
            {!isAvailable && <span className="material-symbols-outlined">progress_activity</span>}
          </span>
        </button>

        <div id="connection-activity-tooltip" className="connection-activity-tooltip" role="tooltip">
          <div className="connection-activity-tooltip-title">
            <ProviderLogo providerId={basicProviderId} className="connection-activity-provider-logo" />
            <span>{PROVIDER_LABELS[basicProviderId]}</span>
          </div>
          <div className="connection-activity-tooltip-status">
            <span className={`connection-activity-tooltip-dot ${isAvailable ? "connected" : "switching"}`} />
            <span>{stateLabel}</span>
          </div>
          {isAutomatic && <div className="connection-activity-tooltip-role">基本プロバイダー</div>}
          {modelLabel && <div className="connection-activity-tooltip-model">{modelLabel}</div>}
        </div>
      </div>
    </>
  );
}

function RoutingModeActivity({ mode, onClick }: {
  mode: Exclude<AutomaticRoutingSettings["mode"], "manual">;
  onClick(): void;
}) {
  const automatic = mode === "automatic";
  const label = automatic ? "完全自動型" : "提案型";
  return <div className="routing-mode-activity">
    <button type="button" className={`routing-mode-activity-button ${automatic ? "automatic" : "suggest"}`} aria-label={`${label}。切り替え設定を開く`} aria-describedby="routing-mode-activity-tooltip" onClick={onClick}>
      <span className="material-symbols-outlined" aria-hidden="true">{automatic ? "sync" : "smart_toy"}</span>
    </button>
    <div id="routing-mode-activity-tooltip" className="routing-mode-activity-tooltip" role="tooltip">
      <strong>{label}</strong>
      <span>{automatic ? "許可した接続先へ自動で切り替えます" : "切り替える前に確認します"}</span>
    </div>
  </div>;
}
