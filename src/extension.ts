import * as vscode from "vscode";
import { NavigatorController } from "./application/NavigatorController";
import { ContextCollector } from "./services/ContextCollector";
import { AdviceService } from "./services/AdviceService";
import { AdviceScheduler } from "./services/AdviceScheduler";
import { ConversationStore } from "./services/ConversationStore";
import { ConnectionService } from "./services/ConnectionService";
import { KnowledgeStore } from "./services/KnowledgeStore";
import { LmStudioClient } from "./services/LmStudioClient";
import { LmStudioSecretStore } from "./services/LmStudioSecretStore";
import { RequestPlanner } from "./services/RequestPlanner";
import { SettingsService } from "./services/SettingsService";
import { UsageMeter } from "./services/UsageMeter";
import {
  ASK_SELECTION_COMMAND,
  NaviComSelectionCodeActionProvider
} from "./editor/NaviComSelectionCodeActionProvider";
import { NavigatorViewProvider } from "./views/NavigatorViewProvider";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const conversationStorageUri = context.storageUri ?? vscode.Uri.joinPath(context.globalStorageUri, "workspace-history");
  const usageMeter = new UsageMeter(context.globalState);
  const connectionService = new ConnectionService(
    usageMeter,
    new LmStudioClient(),
    new LmStudioSecretStore(context.secrets)
  );
  const contextCollector = new ContextCollector();
  const controller = new NavigatorController(
    contextCollector,
    connectionService,
    new AdviceService(connectionService, usageMeter),
    new AdviceScheduler(),
    new RequestPlanner(),
    new SettingsService(context.workspaceState),
    new ConversationStore(conversationStorageUri),
    new KnowledgeStore(context.globalStorageUri),
    usageMeter
  );

  const viewProvider = new NavigatorViewProvider(context.extensionUri, controller);

  context.subscriptions.push(
    controller,
    viewProvider,
    vscode.window.registerWebviewViewProvider(NavigatorViewProvider.viewType, viewProvider),
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      new NaviComSelectionCodeActionProvider(),
      { providedCodeActionKinds: NaviComSelectionCodeActionProvider.providedCodeActionKinds }
    ),
    vscode.commands.registerCommand("aiPairNavigator.openView", async () => {
      await focusNaviComView();
    }),
    vscode.commands.registerCommand("aiPairNavigator.connectCopilot", async () => {
      await controller.connectCopilot();
    }),
    vscode.commands.registerCommand("aiPairNavigator.askForGuidance", async () => {
      await controller.askForGuidance();
    }),
    vscode.commands.registerCommand(ASK_SELECTION_COMMAND, async (uri?: vscode.Uri, range?: vscode.Range) => {
      const selected = await resolveSelectedRange(uri, range);
      if (!selected) {
        await vscode.window.showWarningMessage("NaviComで相談する範囲を選択してください。");
        return;
      }

      const request = controller.askForGuidance(undefined, "context");
      await focusNaviComView();
      await request;
    })
  );

  void controller.initialize().catch((error) => {
    console.error("NaviCom initialization failed", error);
    void vscode.window.showErrorMessage("NaviCom の初期化に失敗しました。Extension Host ログを確認してください。");
  });

  revealNaviComViewForDevelopment(context);
}

export function deactivate(): void {
  // Nothing to dispose yet.
}

async function resolveSelectedRange(
  uri?: vscode.Uri,
  range?: vscode.Range
): Promise<vscode.Range | undefined> {
  const activeEditor = vscode.window.activeTextEditor;
  if (!range || range.isEmpty) {
    return activeEditor && !activeEditor.selection.isEmpty ? activeEditor.selection : undefined;
  }

  if (!uri) {
    if (activeEditor) {
      activeEditor.selection = new vscode.Selection(range.start, range.end);
      activeEditor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    return range;
  }

  if (activeEditor?.document.uri.toString() === uri.toString()) {
    activeEditor.selection = new vscode.Selection(range.start, range.end);
    activeEditor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    return range;
  }

  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, { preserveFocus: false });
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  return range;
}

async function focusNaviComView(): Promise<void> {
  await vscode.commands.executeCommand("workbench.view.extension.aiPairNavigator").then(
    undefined,
    () => undefined
  );
  await vscode.commands.executeCommand("aiPairNavigator.sidebar.focus").then(
    undefined,
    () => undefined
  );
}

function revealNaviComViewForDevelopment(context: vscode.ExtensionContext): void {
  if (context.extensionMode !== vscode.ExtensionMode.Development) {
    return;
  }

  setTimeout(() => {
    void vscode.commands.executeCommand("workbench.action.resetViewLocations").then(
      () => focusNaviComView(),
      () => focusNaviComView()
    );
  }, 500);
}
