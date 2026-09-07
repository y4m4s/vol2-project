import * as vscode from "vscode";
import { ContextCollector } from "../../services/ContextCollector";
import { PreparedGuidanceRequest, RequestPlanner } from "../../services/RequestPlanner";
import { SettingsService } from "../../services/SettingsService";
import { reconcileRequestPlan } from "../../services/RequestPlanTransmission";
import type { ModelProfile } from "../../services/ModelProfile";
import type { GuidancePromptInput } from "../../services/PromptBuilder";
import { getSkill } from "../../shared/skills";
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
  parseSlashInput,
  resolveNextProjectScope,
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
  getModelProfile?(): ModelProfile;
  getPromptExtras?(context: GuidanceContext, plan: RequestPlanSnapshot): Pick<GuidancePromptInput, "knowledgeItems" | "feedbackTendency">;
}

export class RequestPlanCoordinator {
  private draft = { userPrompt: "", additionalContext: "" };
  private detailedRequestPlan?: { key: string; plan: RequestPlanSnapshot };
  // getCurrentPlan は ViewModel を組むたびに呼ばれる。入力が変わらない限り作り直さない。
  private fallbackRequestPlan?: { key: string; plan: RequestPlanSnapshot };
  private cacheGeneration = 0;

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

    if (this.fallbackRequestPlan?.key === key) {
      return this.fallbackRequestPlan.plan;
    }

    const { slashCommand, slashCommandScope, userPrompt } = parseSlashInput(this.draft.userPrompt);
    const kind: GuidanceKind = state.contextPreview.selectedTextPreview ? "context" : "manual";
    const plan = this.externalize(this.requestPlanner.prepareGuidanceRequest(
      withAdditionalContext(this.contextCollector.collectGuidanceContext(), this.draft.additionalContext),
      state.contextPreview,
      settings,
      kind,
      resolveEffectiveAssistanceDepth(kind, state.assistanceDepth, slashCommand),
      slashCommand,
      slashCommandScope
    ), userPrompt).requestPlan;
    // This synchronous fallback has not collected workspace/project context yet.
    // Leave it unstamped so the UI cannot present it as the completed preview.
    this.fallbackRequestPlan = { key, plan };
    return plan;
  }

  public externalize(prepared: PreparedGuidanceRequest, userPrompt?: string): PreparedGuidanceRequest {
    const result = createExternalGuidanceRequest(prepared.context, prepared.requestPlan, this.getWorkspaceRoots());
    result.requestPlan = reconcileRequestPlan(result.requestPlan, {
      ...result.requestPlan,
      context: result.context,
      userPrompt,
      ...this.host.getPromptExtras?.(result.context, result.requestPlan),
      modelProfile: this.host.getModelProfile?.()
    });
    return result;
  }

  /** 文書・診断・ワークスペースの変更で、キーに表れない収集結果も破棄する。 */
  public invalidate(): void {
    this.cacheGeneration += 1;
    this.detailedRequestPlan = undefined;
    this.fallbackRequestPlan = undefined;
  }

  public async refresh(userPrompt = "", additionalContext = ""): Promise<void> {
    this.draft = { userPrompt, additionalContext };
    const state = this.host.getState();
    if (state.requestState !== "idle") {
      return;
    }

    const settings = this.settingsService.getSettings();
    const preview = this.host.rememberSelectionContext(this.contextCollector.collectPreview());
    const kind: GuidanceKind = preview.selectedTextPreview ? "context" : "manual";
    const parsed = parseSlashInput(userPrompt);
    const assistanceDepth = resolveEffectiveAssistanceDepth(kind, state.assistanceDepth, parsed.slashCommand);
    const requestPlanKey = this.createKey({ ...state, contextPreview: preview });
    const requestPlanGeneration = this.cacheGeneration;
    const context = parsed.slashCommand && getSkill(parsed.slashCommand).usesProjectScope
      ? await this.contextCollector.collectNextActionContext(settings, resolveNextProjectScope(assistanceDepth, parsed.slashCommandScope))
      : await this.host.collectGuidanceContextForDepth(settings, assistanceDepth);
    const prepared = this.externalize(this.requestPlanner.prepareGuidanceRequest(
      withAdditionalContext(context, additionalContext),
      preview,
      settings,
      kind,
      assistanceDepth,
      parsed.slashCommand,
      parsed.slashCommandScope
    ), parsed.userPrompt);
    prepared.requestPlan.previewInput = userPrompt;
    prepared.requestPlan.previewAdditionalContext = additionalContext;

    const currentState = this.host.getState();
    const currentPreview = this.contextCollector.collectPreview();
    if (
      this.cacheGeneration !== requestPlanGeneration ||
      this.createKey({ ...currentState, contextPreview: currentPreview }) !== requestPlanKey
    ) {
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
      draft: this.draft,
      modelProfile: this.host.getModelProfile?.(),
      mode: state.mode,
      assistanceDepth: state.assistanceDepth,
      activeFilePath: state.contextPreview.activeFilePath,
      selectedTextPreview: state.contextPreview.selectedTextPreview,
      diagnosticsSummary: state.contextPreview.diagnosticsSummary,
      additionalContext: this.host.getVisibleAdditionalContext(state),
      // 除外設定を変えたら作り直す必要があるため、キーに含める。
      excludedGlobs: this.settingsService.getSettings().excludedGlobs.join("\n")
    });
  }
}
