import type { AiProviderId } from "../../../shared/types";
import { PROVIDER_LABELS } from "../../../shared/providerRouting";
import { useApp } from "../state/AppContext";
import { AutoModeIcon } from "./AutoModeIcon";
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
  const isAutomatic = routingMode === "automatic";
  const basicProviderId: AiProviderId = isAutomatic
    ? viewModel.settings.routing?.preferredProviderId ?? viewModel.providerId
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
      {isAutomatic && <RoutingModeActivity onClick={() => send({ type: "navigate", screen: "settings" })} />}
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

function RoutingModeActivity({ onClick }: { onClick(): void }) {
  return <div className="routing-mode-activity">
    <button type="button" className="routing-mode-activity-button automatic" aria-label="プロバイダーの自動切り替えがオン。設定を開く" aria-describedby="routing-mode-activity-tooltip" onClick={onClick}>
      <AutoModeIcon className="routing-mode-activity-icon" />
    </button>
    <div id="routing-mode-activity-tooltip" className="routing-mode-activity-tooltip" role="tooltip">
      <strong>自動切り替え</strong>
      <span>許可した接続先へ自動で切り替えます</span>
    </div>
  </div>;
}
