import * as vscode from "vscode";
import { NavigatorController } from "./application/NavigatorController";
import { ContextCollector } from "./services/ContextCollector";
import { AdviceService } from "./services/AdviceService";
import { GUIDANCE_POLICY_REVISION } from "./services/PromptBuilder";
import { AdviceScheduler } from "./services/AdviceScheduler";
import { ConversationStore } from "./services/ConversationStore";
import { ConnectionService } from "./services/ConnectionService";
import { KnowledgeStore } from "./services/KnowledgeStore";
import { FeedbackStore } from "./services/FeedbackStore";
import { ProviderEvaluationStore } from "./services/ProviderEvaluationStore";
import { LmStudioClient } from "./services/LmStudioClient";
import { OrcaRouterClient } from "./services/OrcaRouterClient";
import { OrcaRouterCredentialStore } from "./services/OrcaRouterCredentialStore";
import { LmStudioServerService } from "./services/LmStudioServerService";
import { RequestPlanner } from "./services/RequestPlanner";
import { SettingsService } from "./services/SettingsService";
import { UsageMeter } from "./services/UsageMeter";
import {
  ASK_SELECTION_COMMAND,
  NaviComSelectionCodeActionProvider
} from "./editor/NaviComSelectionCodeActionProvider";
import { NavigatorViewProvider } from "./views/NavigatorViewProvider";
import { runEvalLiveCommand } from "./eval/live";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const conversationStorageUri = context.storageUri ?? vscode.Uri.joinPath(context.globalStorageUri, "workspace-history");
  const usageMeter = new UsageMeter(context.globalState);
  const orcaRouterCredentials = new OrcaRouterCredentialStore(context.secrets);
  await orcaRouterCredentials.initialize();
  const connectionService = new ConnectionService(
    usageMeter,
    new LmStudioClient(),
    new OrcaRouterClient(),
    orcaRouterCredentials,
    context.languageModelAccessInformation
  );
  const contextCollector = new ContextCollector();
  const diagnostics = vscode.window.createOutputChannel("NaviCom Diagnostics", { log: true });
  const writeDiagnostic = (entry: Record<string, unknown>) => diagnostics.info(JSON.stringify(entry));
  context.subscriptions.push(diagnostics);
  diagnostics.info(JSON.stringify({ event: "activation", policyRevision: GUIDANCE_POLICY_REVISION,
    extensionPath: context.extensionUri.fsPath }));
  const lmStudioServerService = new LmStudioServerService();
  const controller = new NavigatorController(
    contextCollector,
    connectionService,
    new AdviceService(connectionService, usageMeter, writeDiagnostic),
    new AdviceScheduler(),
    new RequestPlanner(),
    new SettingsService(context.workspaceState),
    lmStudioServerService,
    new ConversationStore(conversationStorageUri),
    new KnowledgeStore(context.globalStorageUri),
    new FeedbackStore(context.globalStorageUri),
    new ProviderEvaluationStore(context.globalStorageUri),
    usageMeter,
    writeDiagnostic
  );

  try {
    await controller.initialize();
  } catch (error) {
    console.error("NaviCom initialization failed", error);
    await vscode.window.showErrorMessage("NaviCom の初期化に失敗しました。既存データへのアクセス権と Extension Host ログを確認してください。");
    controller.dispose();
    throw error;
  }

  const viewProvider = new NavigatorViewProvider(context.extensionUri, controller);

  context.subscriptions.push(
    lmStudioServerService,
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
    vscode.commands.registerCommand("aiPairNavigator.compactContextLocal", async () => {
      await runMemoryCompactionCommand(controller, "local");
    }),
    vscode.commands.registerCommand("aiPairNavigator.compactContextWithoutLocal", async () => {
      await runMemoryCompactionCommand(controller, "withoutLocal");
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
    }),
    // 開発者専用: プロンプト評価ハーネスのライブモード（接続中モデルへ実送信）。
    // コマンドは常に登録するが、コマンドパレットでは naviCom.devMode のときだけ表示する。
    vscode.commands.registerCommand("aiPairNavigator.runEvalLive", async () => {
      await runEvalLiveCommand(connectionService);
    })
  );

  // 開発モードのときだけライブ評価コマンドをコマンドパレットへ出す。
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    void vscode.commands.executeCommand("setContext", "naviCom.devMode", true);
  }

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

async function runMemoryCompactionCommand(
  controller: NavigatorController,
  target: "local" | "withoutLocal"
): Promise<void> {
  const label = target === "local" ? "ローカルLLM" : "ローカルLLMなし";
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `NaviCom: ${label}でコンテキスト圧縮中…`,
      cancellable: true
    },
    (_progress, token) => controller.compactActiveConversation(target, token)
  );
  const details = result.status === "saved" && result.providerId && result.modelId
    ? ` (${result.providerId} / ${result.modelId}、${result.sourceEntryCount ?? 0}件から${result.summaryItemCount ?? 0}項目)`
    : "";
  if (result.status === "saved") {
    await vscode.window.showInformationMessage(`${result.reason}${details}`);
  } else if (result.status === "failed" || result.status === "blocked") {
    await vscode.window.showErrorMessage(result.reason);
  } else {
    await vscode.window.showWarningMessage(result.reason);
  }
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
