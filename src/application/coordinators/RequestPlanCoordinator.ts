import * as vscode from "vscode";
import { ContextCollector } from "../../services/ContextCollector";
import { PreparedGuidanceRequest, RequestPlanner } from "../../services/RequestPlanner";
import { SettingsService } from "../../services/SettingsService";
import {
  createExternalGuidanceRequest,
  resolveWorkspaceDisplayPath,
  type WorkspaceRootPath
} from "../../services/WorkspacePathPolicy";
import type {
  AssistanceDepth,
  GuidanceContext,
  GuidanceKind,
  NavigatorSessionState,
  RequestPlanSnapshot
} from "../../shared/types";
import {
  resolveEffectiveAssistanceDepth,
  withAdditionalContext
} from "../GuidanceInput";

export interface RequestPlanCoordinatorHost {
  getState(): NavigatorSessionState;
  patchSession(partial: Partial<NavigatorSessionState>): void;
  rememberSelectionContext(preview: NavigatorSessionState["contextPreview"]): NavigatorSessionState["contextPreview"];
  collectGuidanceContextForDepth(
    settings: ReturnType<SettingsService["getSettings"]>,
    assistanceDepth: AssistanceDepth,
    baseContext?: GuidanceContext
  ): Promise<GuidanceContext>;
  getVisibleAdditionalContext(state: NavigatorSessionState): string | undefined;
}

export class RequestPlanCoordinator {
  private detailedRequestPlan?: { key: string; plan: RequestPlanSnapshot };

  public constructor(
    private readonly contextCollector: ContextCollector,
    private readonly requestPlanner: RequestPlanner,
    private readonly settingsService: SettingsService,
    private readonly host: RequestPlanCoordinatorHost
  ) {}

  public getCurrentPlan(state: NavigatorSessionState): RequestPlanSnapshot {
    const settings = this.settingsService.getSettings();
    const key = this.createKey(state);
    if (this.detailedRequestPlan?.key === key) {
      return this.detailedRequestPlan.plan;
    }

    const kind: GuidanceKind = state.contextPreview.selectedTextPreview ? "context" : "manual";
    return this.externalize(this.requestPlanner.prepareGuidanceRequest(
      withAdditionalContext(this.contextCollector.collectGuidanceContext(), this.host.getVisibleAdditionalContext(state)),
      state.contextPreview,
      settings,
      kind,
      resolveEffectiveAssistanceDepth(kind, state.assistanceDepth)
    )).requestPlan;
  }

  public externalize(prepared: PreparedGuidanceRequest): PreparedGuidanceRequest {
    return createExternalGuidanceRequest(prepared.context, prepared.requestPlan, this.getWorkspaceRoots());
  }

  public async refresh(): Promise<void> {
    const state = this.host.getState();
    if (state.requestState !== "idle") {
      return;
    }

    const settings = this.settingsService.getSettings();
    const preview = this.host.rememberSelectionContext(this.contextCollector.collectPreview());
    const kind: GuidanceKind = preview.selectedTextPreview ? "context" : "manual";
    const assistanceDepth = resolveEffectiveAssistanceDepth(kind, state.assistanceDepth);
    const requestPlanKey = this.createKey({ ...state, contextPreview: preview });
    const context = await this.host.collectGuidanceContextForDepth(settings, assistanceDepth);
    const prepared = this.externalize(this.requestPlanner.prepareGuidanceRequest(
      withAdditionalContext(context, this.host.getVisibleAdditionalContext(state)),
      preview,
      settings,
      kind,
      assistanceDepth
    ));

    const currentState = this.host.getState();
    const currentPreview = this.contextCollector.collectPreview();
    if (this.createKey({ ...currentState, contextPreview: currentPreview }) !== requestPlanKey) {
      return;
    }

    this.detailedRequestPlan = { key: requestPlanKey, plan: prepared.requestPlan };
    this.host.patchSession({ contextPreview: currentPreview });
  }

  public async openReferencedFile(displayPath: string, line?: number): Promise<void> {
    const resolvedPath = resolveWorkspaceDisplayPath(displayPath, this.getWorkspaceRoots());
    if (!resolvedPath) {
      this.host.patchSession({
        statusMessage: { kind: "warning", text: "ワークスペース内の参照ファイルとして開けませんでした。" }
      });
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath));
      const editor = await vscode.window.showTextDocument(document, { preserveFocus: false });
      if (line !== undefined) {
        const position = new vscode.Position(Math.max(0, Math.min(document.lineCount - 1, Math.floor(line) - 1)), 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    } catch {
      this.host.patchSession({
        statusMessage: { kind: "warning", text: "参照ファイルが移動または削除されているため開けませんでした。" }
      });
    }
  }

  private getWorkspaceRoots(): WorkspaceRootPath[] {
    return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
      name: folder.name,
      fsPath: folder.uri.fsPath
    }));
  }

  private createKey(state: NavigatorSessionState): string {
    return JSON.stringify({
      mode: state.mode,
      assistanceDepth: state.assistanceDepth,
      activeFilePath: state.contextPreview.activeFilePath,
      selectedTextPreview: state.contextPreview.selectedTextPreview,
      diagnosticsSummary: state.contextPreview.diagnosticsSummary,
      additionalContext: this.host.getVisibleAdditionalContext(state)
    });
  }
}
