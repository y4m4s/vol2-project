import type { AiProviderId, NavigatorViewModel, RequestState } from "./types";

type ConnectionActivityInput = Pick<NavigatorViewModel,
  "providerId" | "connectionState" | "requestState" | "modelLabel" |
  "testedProviderIds" | "testedProviderModels" | "routingProviderConnection"
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
  const isChecking = viewModel.requestState === "connecting" &&
    viewModel.routingProviderConnection?.providerId === providerId &&
    viewModel.routingProviderConnection.state === "connecting";
  const testedModelLabel = viewModel.testedProviderModels?.find(model => model.providerId === providerId)?.modelLabel;
  return {
    providerId,
    modelLabel: (isConnected ? viewModel.modelLabel : testedModelLabel)
      ?.replace(/^(GitHub Copilot|LM Studio|Ollama|OrcaRouter)\s*[·：:]\s*/, ""),
    stateLabel: isConnected ? "接続中" : isChecking ? "接続確認中" : isAvailable ? "接続可能" : "未接続",
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
