import { useApp } from "../state/AppContext";

declare global {
  interface Window {
    __PROVIDER_LOGO_URIS__: {
      copilot: string;
      lmStudio: string;
    };
  }
}

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
      : "GitHub Copilot Chat";
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
        <ProviderLogo providerId={providerId} instance="button" />
        <span className={`connection-activity-state ${isConnected ? "connected" : "switching"}`} aria-hidden="true">
          <span className="material-symbols-outlined">{isConnected ? "check" : "progress_activity"}</span>
        </span>
      </button>

      <div id="connection-activity-tooltip" className="connection-activity-tooltip" role="tooltip">
        <div className="connection-activity-tooltip-title">
          <ProviderLogo providerId={providerId} instance="tooltip" />
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

function ProviderLogo({
  providerId,
  instance
}: {
  providerId: ProviderId;
  instance: "button" | "tooltip";
}) {
  if (providerId === "orcaRouter") {
    return <span className="material-symbols-outlined connection-activity-provider-logo connection-activity-provider-logo-symbol" aria-hidden="true">route</span>;
  }
  if (providerId === "lmStudio") {
    const logoUri = window.__PROVIDER_LOGO_URIS__.lmStudio;
    return (
      <span
        className="connection-activity-provider-logo"
        style={{
          WebkitMaskImage: `url("${logoUri}")`,
          maskImage: `url("${logoUri}")`
        }}
        aria-hidden="true"
      />
    );
  }

  const invertFilterId = `copilot-logo-invert-${instance}`;
  const logoMaskId = `copilot-logo-mask-${instance}`;
  return (
    <svg
      className="connection-activity-provider-logo"
      viewBox="0 0 600 600"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter id={invertFilterId} colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"
          />
        </filter>
        <mask
          id={logoMaskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="600"
          height="600"
          style={{ maskType: "luminance" }}
        >
          <image
            href={window.__PROVIDER_LOGO_URIS__.copilot}
            width="600"
            height="600"
            filter={`url(#${invertFilterId})`}
          />
        </mask>
      </defs>
      <rect width="600" height="600" fill="currentColor" mask={`url(#${logoMaskId})`} />
    </svg>
  );
}
