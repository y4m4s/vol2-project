import { SLASH_COMMAND_SUGGESTIONS, type SlashCommandSuggestion, type SkillSuggestion } from "./skills";
import { PROVIDER_COMMAND_SUGGESTIONS, type ProviderCommandSuggestion } from "./providerCommands";

// UI サジェスト候補はスキルレジストリ（skills.ts）とプロバイダ切替コマンドから導出する。
export type SlashCommandOption = SlashCommandSuggestion | SkillSuggestion | ProviderCommandSuggestion;

// 通常の一覧ではプロバイダ切替コマンドを 1 つの入口 "/provider" にまとめ、コマンド数を増やしすぎない。
// "/provider" 自体、または各コマンド名にマッチする入力があったときだけ、4 択に展開する。
export const PROVIDER_GROUP_COMMAND_TEXT = "/provider";

const PROVIDER_COMMAND_ENTRY: SkillSuggestion = {
  commandText: PROVIDER_GROUP_COMMAND_TEXT,
  title: "プロバイダ切替",
  description: "接続先プロバイダを切り替え",
  icon: "sync"
};

export const SLASH_COMMAND_OPTIONS: SlashCommandOption[] = [
  ...SLASH_COMMAND_SUGGESTIONS,
  PROVIDER_COMMAND_ENTRY
];

function filterOptions(options: SlashCommandOption[], normalizedQuery: string): SlashCommandOption[] {
  return options.filter((option) => {
    const commandQuery = option.commandText.replace(/^\//, "").toLowerCase();
    return (
      commandQuery.includes(normalizedQuery) ||
      option.title.toLowerCase().includes(normalizedQuery) ||
      option.description.toLowerCase().includes(normalizedQuery)
    );
  });
}

export function getMatchingSlashCommands(query: string): SlashCommandOption[] {
  const normalizedQuery = query.trim().toLowerCase();

  // "provider" にマッチする入力のときだけ、まとめ入口の代わりに4択を展開する。
  const providerNames = PROVIDER_COMMAND_SUGGESTIONS.map((option) => option.commandText.replace(/^\//, "").toLowerCase());
  const matchesProviderGroup = normalizedQuery.length > 0 && "provider".startsWith(normalizedQuery);
  const matchesProviderChild = providerNames.some((name) => name.includes(normalizedQuery));
  if (normalizedQuery && (matchesProviderGroup || matchesProviderChild)) {
    return filterOptions(PROVIDER_COMMAND_SUGGESTIONS, normalizedQuery);
  }

  if (!normalizedQuery) {
    return SLASH_COMMAND_OPTIONS;
  }

  return filterOptions(SLASH_COMMAND_OPTIONS, normalizedQuery);
}
