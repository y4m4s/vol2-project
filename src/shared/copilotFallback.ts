import type { ConversationEntry, NavigatorSettings } from "./types";
import { normalizeRoutingSettings } from "./providerRouting";

export function canFallbackToTestedCopilot(
  settings: NavigatorSettings,
  history: readonly ConversationEntry[],
  copilotIsTested: boolean
): boolean {
  const routing = normalizeRoutingSettings(settings.routing);
  return routing.mode === "automatic" &&
    routing.allowedProviderIds.includes("copilot") &&
    copilotIsTested &&
    !history.some(entry => entry.transmissionClass === "localOnly" ||
      (!entry.transmissionClass && (entry.providerId === "lmStudio" || entry.providerId === "ollama")));
}
