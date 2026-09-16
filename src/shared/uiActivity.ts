import type { AiProviderId, NavigatorViewModel, RequestState } from "./types";

type ConnectionActivityInput = Pick<NavigatorViewModel,
  "providerId" | "connectionState" | "requestState" | "modelLabel" |
  "testedProviderIds" | "testedProviderModels" | "routingProviderConnection" | "lmStudioServer"
>;

export function connectionActivityState(viewModel: ConnectionActivityInput): {
  providerId: AiProviderId;
  modelLabel?: string;
  stateLabel: string;
  stateClass: "connected" | "switching";
  isAvailable: boolean;
  isChecking: boolean;
} {
  // The header describes the active connection, not the preferred provider
  // that will be used when starting a new conversation.
  const providerId = viewModel.providerId;
  const isConnected = viewModel.connectionState === "connected";
  const isAvailable = isConnected || (viewModel.testedProviderIds ?? []).includes(providerId);
  const isCheckingRouting = viewModel.requestState === "connecting" &&
    viewModel.routingProviderConnection?.providerId === providerId &&
    viewModel.routingProviderConnection.state === "connecting";
  const isCheckingServer = providerId === "lmStudio" &&
    (viewModel.lmStudioServer?.state === "starting" ||
      viewModel.lmStudioServer?.state === "stopping" ||
      viewModel.lmStudioServer?.state === "checking");
  const isChecking = isCheckingRouting || isCheckingServer;
  const testedModelLabel = viewModel.testedProviderModels?.find(model => model.providerId === providerId)?.modelLabel;
  return {
    providerId,
    modelLabel: (isConnected ? viewModel.modelLabel : testedModelLabel)
      ?.replace(/^(GitHub Copilot|LM Studio|Ollama|OrcaRouter)\s*[·：:]\s*/, ""),
    stateLabel: isChecking ? "接続確認中" : isConnected ? "接続中" : isAvailable ? "接続可能" : "未接続",
    stateClass: isAvailable && !isChecking ? "connected" : "switching",
    isAvailable,
    isChecking
  };
}

export function guidanceProgressState(requestState: RequestState, screen: NavigatorViewModel["screen"]):
  { title: string; message: string } | undefined {
  if (requestState === "preparing_guidance") {
    return {
      title: "送信準備中",
      message: "接続先の選択と会話履歴の整理をしています。処理は継続中です。"
    };
  }
  if (requestState === "requesting_guidance" && screen === "main") {
    return {
      title: "回答を生成しています",
      message: "現在の作業文脈をもとに自動でフィードバックを生成しています。"
    };
  }
  return undefined;
}
