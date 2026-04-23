import * as vscode from "vscode";
import { NavigatorController } from "./application/NavigatorController";
import { ContextCollector } from "./services/ContextCollector";
import { AdviceService } from "./services/AdviceService";
import { AdviceScheduler } from "./services/AdviceScheduler";
import { ConnectionService } from "./services/ConnectionService";
import { KnowledgeStore } from "./services/KnowledgeStore";
import { RequestPlanner } from "./services/RequestPlanner";
import { SettingsService } from "./services/SettingsService";
import { NavigatorViewProvider } from "./views/NavigatorViewProvider";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const connectionService = new ConnectionService();
  const contextCollector = new ContextCollector();
  const controller = new NavigatorController(
    contextCollector,
    connectionService,
    new AdviceService(connectionService),
    new AdviceScheduler(),
    new RequestPlanner(),
    new SettingsService(context.workspaceState),
    new KnowledgeStore()
  );

  await controller.initialize();

  const viewProvider = new NavigatorViewProvider(context.extensionUri, controller);

  context.subscriptions.push(
    controller,
    viewProvider,
    vscode.window.registerWebviewViewProvider(NavigatorViewProvider.viewType, viewProvider),
    vscode.commands.registerCommand("aiPairNavigator.connectCopilot", async () => {
      await controller.connectCopilot();
    }),
    vscode.commands.registerCommand("aiPairNavigator.askForGuidance", async () => {
      await controller.askForGuidance();
    })
  );
}

export function deactivate(): void {
  // Nothing to dispose yet.
}
