import { useApp } from "../state/AppContext";
import { ProviderLogo } from "./ProviderLogo";

type ProviderId = "copilot" | "lmStudio" | "orcaRouter";

export function ConnectionActivity() {
  const { viewModel, send } = useApp();
  if (!viewModel) {
    return null;
  }

  const hasConnectionActivity =
    viewModel.connectionState === "connected" ||
    viewModel.connectionState === "connecting" ||
    viewModel.connectionState === "consent_pending";
  if (!hasConnectionActivity || viewModel.screen === "onboarding") {
    return null;
  }

  const isConnected = viewModel.connectionState === "connected";
  const providerId: ProviderId = viewModel.providerId;
  const providerName = providerId === "lmStudio"
    ? "ローカル LLM"
    : providerId === "orcaRouter"
      ? "OrcaRouter"
      : "GitHub Copilot";
  const stateLabel = isConnected ? "接続中" : "切り替え中";
  const modelLabel = viewModel.modelLabel?.replace(/^(GitHub Copilot|LM Studio|OrcaRouter)\s*[·：:]\s*/, "");

  return (
    <div className="connection-activity">
      <button
        type="button"
        className={`connection-activity-provider ${providerId.toLowerCase()} ${isConnected ? "connected" : "switching"}`}
        aria-label={`${providerName} ${stateLabel}。接続設定を開く`}
        aria-describedby="connection-activity-tooltip"
        onClick={() => send({ type: "navigate", screen: "settings" })}
      >
        <ProviderLogo
          providerId={providerId}
          className="connection-activity-provider-logo"
          symbolClassName="connection-activity-provider-logo-symbol"
        />
        <span className={`connection-activity-state ${isConnected ? "connected" : "switching"}`} aria-hidden="true">
          <span className="material-symbols-outlined">{isConnected ? "check" : "progress_activity"}</span>
        </span>
      </button>

      <div id="connection-activity-tooltip" className="connection-activity-tooltip" role="tooltip">
        <div className="connection-activity-tooltip-title">
          <ProviderLogo
            providerId={providerId}
            className="connection-activity-provider-logo"
            symbolClassName="connection-activity-provider-logo-symbol"
          />
          <span>{providerName}</span>
        </div>
        <div className="connection-activity-tooltip-status">
          <span className={`connection-activity-tooltip-dot ${isConnected ? "connected" : "switching"}`} />
          <span>{stateLabel}</span>
        </div>
        {modelLabel && <div className="connection-activity-tooltip-model">{modelLabel}</div>}
      </div>
    </div>
  );
}
