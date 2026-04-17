import * as vscode from "vscode";
import { SessionStore } from "./SessionStore";
import { ContextCollector } from "../services/ContextCollector";
import { AdviceService } from "../services/AdviceService";
import { ConnectionService } from "../services/ConnectionService";
import { KnowledgeStore } from "../services/KnowledgeStore";
import {
  AdviceMode,
  ConnectionState,
  GuidanceCard,
  NavigatorSessionState,
  NavigatorStatusMessage,
  NavigatorViewModel
} from "../shared/types";

export class NavigatorController implements vscode.Disposable {
  private readonly sessionStore: SessionStore;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly didChangeStateEmitter = new vscode.EventEmitter<void>();

  public readonly onDidChangeState = this.didChangeStateEmitter.event;

  public constructor(
    private readonly contextCollector: ContextCollector,
    private readonly connectionService: ConnectionService,
    private readonly adviceService: AdviceService,
    private readonly knowledgeStore: KnowledgeStore
  ) {
    this.sessionStore = new SessionStore(this.createInitialState());

    this.disposables.push(
      this.sessionStore,
      this.didChangeStateEmitter,
      this.sessionStore.onDidChangeState(() => {
        this.didChangeStateEmitter.fire();
      })
    );
  }

  public async initialize(): Promise<void> {
    await this.knowledgeStore.initialize();

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.refreshContextPreview();
      }),
      vscode.window.onDidChangeTextEditorSelection(() => {
        this.refreshContextPreview();
      }),
      vscode.languages.onDidChangeDiagnostics(() => {
        this.refreshContextPreview();
      })
    );

    this.refreshContextPreview();
  }

  public getViewModel(): NavigatorViewModel {
    const state = this.sessionStore.getState();

    return {
      screen: state.screen,
      connectionState: state.connectionState,
      mode: state.mode,
      canConnect: state.requestState === "idle",
      canAskForGuidance: state.connectionState === "connected" && state.requestState === "idle",
      canSwitchMode: false,
      isBusy: state.requestState !== "idle",
      statusMessage: state.statusMessage,
      contextPreview: state.contextPreview,
      latestGuidance: state.latestGuidance
    };
  }

  public async connectCopilot(): Promise<void> {
    const state = this.sessionStore.getState();
    if (state.requestState !== "idle") {
      return;
    }

    this.patchSession({
      requestState: "connecting",
      connectionState: "connecting",
      statusMessage: {
        kind: "info",
        text: "Copilot への接続を確認しています..."
      }
    });

    const connectionState = await this.connectionService.connect();

    if (connectionState === "connected") {
      this.patchSession({
        connectionState,
        requestState: "idle",
        statusMessage: {
          kind: "info",
          text: "Copilot に接続しました。現在の文脈で手動ガイダンスを利用できます。"
        },
        contextPreview: this.contextCollector.collectPreview()
      });
      return;
    }

    this.patchSession({
      connectionState,
      requestState: "idle",
      statusMessage: this.buildConnectionStatusMessage(connectionState)
    });
  }

  public async askForGuidance(): Promise<void> {
    const state = this.sessionStore.getState();
    if (state.requestState !== "idle") {
      return;
    }

    if (this.connectionService.getState() !== "connected") {
      this.patchSession({
        connectionState: this.connectionService.getState(),
        statusMessage: {
          kind: "warning",
          text: "先に Copilot へ接続してください。"
        }
      });
      return;
    }

    this.patchSession({
      requestState: "requesting_guidance",
      connectionState: this.connectionService.getState(),
      statusMessage: {
        kind: "info",
        text: "現在の作業文脈をもとにガイダンスを生成しています..."
      }
    });

    const guidanceContext = this.contextCollector.collectGuidanceContext();
    const result = await this.adviceService.requestManualGuidance(guidanceContext);
    const contextPreview = this.contextCollector.collectPreview();

    if (result.ok) {
      const guidanceCard: GuidanceCard = {
        requestedAt: new Date().toISOString(),
        mode: state.mode,
        text: result.text,
        basedOn: contextPreview
      };

      this.patchSession({
        connectionState: this.connectionService.getState(),
        requestState: "idle",
        contextPreview,
        latestGuidance: guidanceCard,
        statusMessage: undefined
      });
      return;
    }

    this.patchSession({
      connectionState: result.connectionState,
      requestState: "idle",
      contextPreview,
      statusMessage: {
        kind: "error",
        text: result.message
      }
    });
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private refreshContextPreview(): void {
    this.patchSession({
      contextPreview: this.contextCollector.collectPreview()
    });
  }

  private patchSession(partial: Partial<NavigatorSessionState>): void {
    const current = this.sessionStore.getState();
    const nextState: NavigatorSessionState = {
      ...current,
      ...partial,
      screen: current.screen
    };

    nextState.screen = this.resolveScreen(nextState);
    this.sessionStore.patch({
      ...partial,
      screen: nextState.screen
    });
  }

  private resolveScreen(state: NavigatorSessionState): NavigatorSessionState["screen"] {
    switch (state.connectionState) {
      case "connected":
        return "main";
      case "restricted":
        return state.latestGuidance ? "main" : "error";
      case "unavailable":
        return "error";
      case "connecting":
      case "consent_pending":
      case "disconnected":
      default:
        return "onboarding";
    }
  }

  private buildConnectionStatusMessage(connectionState: ConnectionState): NavigatorStatusMessage {
    switch (connectionState) {
      case "disconnected":
        return {
          kind: "warning",
          text: "接続が完了しませんでした。Copilot の同意ダイアログを確認して再試行してください。"
        };
      case "unavailable":
        return {
          kind: "error",
          text: vscode.workspace.isTrusted
            ? "Copilot を利用できません。Copilot の利用状態とネットワーク、VS Code Desktop 環境を確認してください。"
            : "Workspace Trust が無効です。ワークスペースを信頼してから再試行してください。"
        };
      case "restricted":
        return {
          kind: "error",
          text: "現在は Copilot リクエストが制限されています。少し時間を置いて再接続してください。"
        };
      case "connecting":
      case "consent_pending":
        return {
          kind: "info",
          text: "Copilot への接続を続行しています..."
        };
      case "connected":
      default:
        return {
          kind: "info",
          text: "Copilot に接続しました。"
        };
    }
  }

  private createInitialState(): NavigatorSessionState {
    return {
      screen: "onboarding",
      connectionState: this.connectionService.getState(),
      requestState: "idle",
      mode: "manual" satisfies AdviceMode,
      contextPreview: {
        diagnosticsSummary: []
      }
    };
  }
}
