import { PROVIDER_LABELS } from "../../../shared/providerRouting";
import { connectionActivityState } from "../../../shared/uiActivity";
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
  const preferredProviderId = viewModel.settings.routing?.preferredProviderId;
  const { providerId, modelLabel, stateLabel, stateClass, isAvailable, isChecking } = connectionActivityState(viewModel);

  return (
    <>
      {isAutomatic && <RoutingModeActivity onClick={() => send({ type: "navigate", screen: "settings" })} />}
      <div className="connection-activity">
        <button
          type="button"
          className={`connection-activity-provider ${providerId.toLowerCase()} ${stateClass}`}
          aria-label={`${PROVIDER_LABELS[providerId]} ${stateLabel}、現在のプロバイダー。接続設定を開く`}
          aria-describedby="connection-activity-tooltip"
          onClick={() => send({ type: "navigate", screen: "settings" })}
        >
          <ProviderLogo providerId={providerId} className="connection-activity-provider-logo" />
          {(isAvailable || isChecking) && <span className={`connection-activity-state ${stateClass}`} aria-hidden="true">
            {isChecking && <span className="material-symbols-outlined">progress_activity</span>}
          </span>}
        </button>

        <div id="connection-activity-tooltip" className="connection-activity-tooltip" role="tooltip">
          <div className="connection-activity-tooltip-title">
            <ProviderLogo providerId={providerId} className="connection-activity-provider-logo" />
            <span>{PROVIDER_LABELS[providerId]}</span>
          </div>
          <div className="connection-activity-tooltip-status">
            <span className={`connection-activity-tooltip-dot ${stateClass}`} />
            <span>{stateLabel}</span>
          </div>
          <div className="connection-activity-tooltip-role">現在のプロバイダー</div>
          {isAutomatic && preferredProviderId && preferredProviderId !== providerId &&
            <div className="connection-activity-tooltip-role">基本プロバイダー: {PROVIDER_LABELS[preferredProviderId]}</div>}
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
