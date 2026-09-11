import {
  getMatchingSlashCommands,
  PROVIDER_GROUP_COMMAND_TEXT,
  type SlashCommandOption
} from "../../../shared/slashCommandOptions";
import { ProviderLogo } from "./ProviderLogo";

export { getMatchingSlashCommands, PROVIDER_GROUP_COMMAND_TEXT, type SlashCommandOption };

function hasProviderId(option: SlashCommandOption): option is SlashCommandOption & { providerId: "copilot" | "lmStudio" | "orcaRouter" | "ollama" } {
  return "providerId" in option;
}

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
                {hasProviderId(option) ? (
                  <ProviderLogo providerId={option.providerId} className="slash-command-option-icon slash-command-option-provider-logo" />
                ) : (
                  <span className="material-symbols-outlined slash-command-option-icon">{option.icon}</span>
                )}
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
