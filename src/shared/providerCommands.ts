import type { AiProviderId } from "./types";
import type { SkillSuggestion } from "./skills";

/**
 * プロバイダ切替コマンドのレジストリ。
 *
 * SKILLS（skills.ts）とは性質が異なる: これは LLM への指示ではなく、
 * 入力欄から打つと即座に接続先プロバイダを切り替える実行コマンド。
 * そのため LLM へは送らず、Controller 側で送信前に横取りして処理する。
 */
export const PROVIDER_COMMANDS: Record<string, AiProviderId> = {
  "/provider-cp": "copilot",
  "/provider-lm": "lmStudio",
  "/provider-oll": "ollama",
  "/provider-orca": "orcaRouter"
};

export function parseProviderCommand(value?: string): AiProviderId | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  return PROVIDER_COMMANDS[trimmed];
}

// UI サジェスト用の表示メタデータ。SlashCommandSuggestion と結合して 1 つの一覧として表示する。
// icon は Material Symbols 名へのフォールバック。providerId があるときは ProviderLogo（公式ブランドアイコン）を優先表示する。
export interface ProviderCommandSuggestion extends SkillSuggestion {
  providerId: AiProviderId;
}

export const PROVIDER_COMMAND_SUGGESTIONS: ProviderCommandSuggestion[] = [
  { commandText: "/provider-cp", title: "GitHub Copilot", description: "接続先を GitHub Copilot に切り替え", icon: "smart_toy", providerId: "copilot" },
  { commandText: "/provider-lm", title: "LM Studio", description: "接続先を LM Studio に切り替え", icon: "dns", providerId: "lmStudio" },
  { commandText: "/provider-oll", title: "Ollama", description: "接続先を Ollama に切り替え", icon: "computer", providerId: "ollama" },
  { commandText: "/provider-orca", title: "OrcaRouter", description: "接続先を OrcaRouter に切り替え", icon: "hub", providerId: "orcaRouter" }
];
