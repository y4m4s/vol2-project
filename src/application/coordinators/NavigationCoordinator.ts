import {
  ConnectionState,
  GuidanceKind,
  NavigatorScreen,
  NavigatorSessionState
} from "../../shared/types";

const HOME_SCREENS: NavigatorScreen[] = ["onboarding", "main", "error"];

export interface NavigationCoordinatorHost {
  getState(): NavigatorSessionState;
  patchSession(partial: Partial<NavigatorSessionState>): void;
  onSettingsOpened(): void;
}

export class NavigationCoordinator {
  public constructor(private readonly host: NavigationCoordinatorHost) {}

  public navigate(screen: NavigatorScreen): void {
    const state = this.host.getState();
    if (state.requestState === "saving_feedback") return;
    switch (screen) {
      case "onboarding":
        this.host.patchSession({ screen: "onboarding" });
        return;
      case "main":
        this.host.patchSession({
          screen: resolveHomeScreen(state.connectionState),
          selectedConversationId: undefined,
          activeAdditionalContext: undefined,
          pendingAdditionalContext: undefined
        });
        return;
      case "history":
        this.pushScreen("history");
        return;
      case "conversation":
        this.host.patchSession({
          screen: state.activeConversationStreamId ? "conversation" : resolveHomeScreen(state.connectionState)
        });
        return;
      case "knowledge":
        this.pushScreen("knowledge");
        this.host.patchSession({ selectedKnowledgeId: undefined });
        return;
      case "settings":
        this.pushScreen(screen);
        this.host.onSettingsOpened();
        return;
      default:
        return;
    }
  }

  public navigateBack(): void {
    const state = this.host.getState();
    if (state.requestState === "saving_feedback") return;
    if (state.screenHistory.length === 0) {
      this.host.patchSession({ screen: resolveHomeScreen(state.connectionState) });
      return;
    }
    const nextHistory = [...state.screenHistory];
    const previousScreen = nextHistory.pop() ?? resolveHomeScreen(state.connectionState);
    this.host.patchSession({ screen: previousScreen, screenHistory: nextHistory });
  }

  public pushScreen(screen: NavigatorScreen): void {
    const state = this.host.getState();
    this.host.patchSession({ screen, screenHistory: [...state.screenHistory, state.screen] });
  }
}

export function resolveHomeScreen(connectionState: ConnectionState): NavigatorScreen {
  switch (connectionState) {
    case "connected": return "main";
    case "restricted":
    case "unavailable": return "error";
    default: return "onboarding";
  }
}

export function resolveScreenAfterSuccess(kind: GuidanceKind, currentScreen: NavigatorScreen): NavigatorScreen {
  if (kind === "always") return currentScreen === "main" ? "conversation" : currentScreen;
  return shouldKeepUtilityScreen(currentScreen) ? currentScreen : "conversation";
}

export function resolveSelectedConversationIdAfterSuccess(
  kind: GuidanceKind,
  state: NavigatorSessionState,
  assistantEntryId: string
): string | undefined {
  return kind === "always" && state.screen === "advice_detail" ? state.selectedConversationId : assistantEntryId;
}

export function resolveScreenAfterFailure(
  kind: GuidanceKind,
  currentScreen: NavigatorScreen,
  connectionState: ConnectionState,
  hasLatestGuidance: boolean
): NavigatorScreen {
  if (kind === "always" && !HOME_SCREENS.includes(currentScreen)) return currentScreen;
  if (kind === "always" && connectionState === "restricted" && hasLatestGuidance) return "main";
  if (kind !== "always") return shouldKeepUtilityScreen(currentScreen) ? currentScreen : "conversation";
  return resolveHomeScreen(connectionState);
}

function shouldKeepUtilityScreen(screen: NavigatorScreen): boolean {
  return screen === "history" || screen === "knowledge" || screen === "knowledge_detail" ||
    screen === "settings" || screen === "feedback_form";
}
