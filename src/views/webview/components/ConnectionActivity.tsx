import { useApp } from "../state/AppContext";

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

  const copilotActive = viewModel.providerId === "copilot";
  const lmStudioActive = viewModel.providerId === "lmStudio";
  const stateLabel = viewModel.connectionState === "connected" ? "接続中" : "切り替え中";

  return (
    <div className="connection-activity" aria-label="AI 接続状態">
      <button
        type="button"
        className={`connection-activity-provider copilot ${copilotActive ? "active" : "inactive"}`}
        aria-label={copilotActive ? `Copilot ${stateLabel}。接続設定を開く` : "Copilot 接続なし。接続設定を開く"}
        onClick={() => send({ type: "navigate", screen: "settings" })}
      />
      <button
        type="button"
        className={`connection-activity-provider lmstudio ${lmStudioActive ? "active" : "inactive"}`}
        aria-label={lmStudioActive ? `LM ${stateLabel}。接続設定を開く` : "LM 接続なし。接続設定を開く"}
        onClick={() => send({ type: "navigate", screen: "settings" })}
      />

      <div className="connection-activity-tooltip" role="status">
        <div className="connection-activity-tooltip-row">
          Copilot {copilotActive ? stateLabel : "接続なし"}
        </div>
        <div className="connection-activity-tooltip-row">
          LM {lmStudioActive ? stateLabel : "接続なし"}
        </div>
      </div>
    </div>
  );
}
