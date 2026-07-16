import { useApp } from "../state/AppContext";

export function ConnectionActivity() {
  const { viewModel, send } = useApp();
  if (!viewModel) {
    return null;
  }

  const isConnected = viewModel.connectionState === "connected";
  if (!isConnected || viewModel.screen === "onboarding") {
    return null;
  }

  const copilotActive = isConnected && viewModel.providerId === "copilot";
  const lmStudioActive = isConnected && viewModel.providerId === "lmStudio";

  return (
    <div className="connection-activity" aria-label="AI 接続状態">
      <button
        type="button"
        className={`connection-activity-provider copilot ${copilotActive ? "active" : "inactive"}`}
        aria-label={copilotActive ? "Copilot 接続中。接続設定を開く" : "Copilot 接続なし。接続設定を開く"}
        onClick={() => send({ type: "navigate", screen: "settings" })}
      />
      <button
        type="button"
        className={`connection-activity-provider lmstudio ${lmStudioActive ? "active" : "inactive"}`}
        aria-label={lmStudioActive ? "LM 接続中。接続設定を開く" : "LM 接続なし。接続設定を開く"}
        onClick={() => send({ type: "navigate", screen: "settings" })}
      />

      <div className="connection-activity-tooltip" role="status">
        <div className="connection-activity-tooltip-row">
          Copilot {copilotActive ? "接続中" : "接続なし"}
        </div>
        <div className="connection-activity-tooltip-row">
          LM {lmStudioActive ? "接続中" : "接続なし"}
        </div>
      </div>
    </div>
  );
}
