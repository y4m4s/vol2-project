import type { SlashCommand } from "../../../shared/types";

export interface SlashCommandOption {
  command: SlashCommand;
  commandText: string;
  title: string;
  description: string;
  icon: string;
}

export const SLASH_COMMAND_OPTIONS: SlashCommandOption[] = [
  {
    command: "hint",
    commandText: "/hint",
    title: "ヒント",
    description: "詰まりをほどく短い確認ポイント",
    icon: "lightbulb"
  },
  {
    command: "next",
    commandText: "/next",
    title: "次の一手",
    description: "一区切り後に見ることを整理",
    icon: "arrow_forward"
  },
  {
    command: "next",
    commandText: "/next deep",
    title: "次の一手 Deep",
    description: "プロジェクトを広めに見て整理",
    icon: "travel_explore"
  },
  {
    command: "flow",
    commandText: "/flow",
    title: "流れ",
    description: "処理やデータの流れを整理",
    icon: "account_tree"
  },
  {
    command: "risk",
    commandText: "/risk",
    title: "リスク",
    description: "壊れやすい箇所や副作用を確認",
    icon: "crisis_alert"
  },
  {
    command: "test",
    commandText: "/test",
    title: "テスト",
    description: "確認観点を整理",
    icon: "fact_check"
  }
];

interface SlashCommandButtonProps {
  open: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface SlashCommandSuggestProps {
  open: boolean;
  query: string;
  activeIndex: number;
  disabled?: boolean;
  onActiveIndexChange: (index: number) => void;
  onRunCommand: (commandText: string) => void;
}

export function SlashCommandButton({ open, disabled = false, onClick }: SlashCommandButtonProps) {
  return (
    <button
      type="button"
      className={`slash-command-toggle ${open ? "open" : ""}`}
      title="スラッシュコマンド"
      aria-label="スラッシュコマンド"
      aria-expanded={open}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="slash-command-glyph">/</span>
    </button>
  );
}

export function SlashCommandSuggest({
  open,
  query,
  activeIndex,
  disabled = false,
  onActiveIndexChange,
  onRunCommand
}: SlashCommandSuggestProps) {
  if (!open) {
    return null;
  }

  const normalizedQuery = query.trim().toLowerCase();
  const options = getMatchingSlashCommands(normalizedQuery);

  return (
    <div className="slash-command-panel" role="listbox" aria-label="スラッシュコマンド">
      <div className="slash-command-panel-head">
        <span className="slash-command-panel-mark">/</span>
        <span>Slash Commands</span>
      </div>

      <div className="slash-command-list">
        {options.length > 0 ? (
          options.map((option, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={option.commandText}
                type="button"
                className={`slash-command-option ${active ? "active" : ""}`}
                role="option"
                aria-selected={active}
                disabled={disabled}
                onMouseEnter={() => onActiveIndexChange(index)}
                onClick={() => onRunCommand(option.commandText)}
              >
                <span className="material-symbols-outlined slash-command-option-icon">{option.icon}</span>
                <span className="slash-command-option-body">
                  <span className="slash-command-option-title">
                    <code>{option.commandText}</code>
                    <span>{option.title}</span>
                  </span>
                  <span className="slash-command-option-desc">{option.description}</span>
                </span>
              </button>
            );
          })
        ) : (
          <div className="slash-command-empty">一致するコマンドがありません</div>
        )}
      </div>
    </div>
  );
}

export function getMatchingSlashCommands(query: string): SlashCommandOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return SLASH_COMMAND_OPTIONS;
  }

  return SLASH_COMMAND_OPTIONS.filter((option) => {
    const commandQuery = option.commandText.replace(/^\//, "").toLowerCase();
    return (
      commandQuery.includes(normalizedQuery) ||
      option.title.toLowerCase().includes(normalizedQuery) ||
      option.description.toLowerCase().includes(normalizedQuery)
    );
  });
}
