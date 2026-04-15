import * as vscode from "vscode";
import { NavigatorController } from "./application/NavigatorController";
import { ContextCollector } from "./services/ContextCollector";
import { CopilotService } from "./services/CopilotService";
import { KnowledgeStore } from "./services/KnowledgeStore";
import { NavigatorViewProvider } from "./views/NavigatorViewProvider";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const controller = new NavigatorController(
    new ContextCollector(),
    new CopilotService(),
    new KnowledgeStore()
  );

  await controller.initialize();

  const viewProvider = new NavigatorViewProvider(context.extensionUri, controller);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(NavigatorViewProvider.viewType, viewProvider),
    vscode.commands.registerCommand("aiPairNavigator.connectCopilot", async () => {
      await controller.connectCopilot();
      await viewProvider.refresh();
    }),
    vscode.commands.registerCommand("aiPairNavigator.askForGuidance", async () => {
      const guidance = await controller.askForGuidance("manual");
      void vscode.window.showInformationMessage(guidance);
    })
  );
}

export function deactivate(): void {
  // Nothing to dispose yet.
}
