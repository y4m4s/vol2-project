import {
  ContextCategoryKey,
  GuidanceContext,
  GuidanceKind,
  NavigatorContextPreview,
  NavigatorSettings,
  RequestPlanCategory,
  RequestPlanFile,
  RequestPlanSnapshot
} from "../shared/types";

export interface PreparedGuidanceRequest {
  context: GuidanceContext;
  requestPlan: RequestPlanSnapshot;
}

export class RequestPlanner {
  public prepareGuidanceRequest(
    context: GuidanceContext,
    preview: NavigatorContextPreview,
    settings: NavigatorSettings,
    kind: GuidanceKind
  ): PreparedGuidanceRequest {
    const filteredContext: GuidanceContext = {
      activeFilePath: context.activeFilePath,
      activeFileLanguage: context.activeFileLanguage,
      activeFileExcerpt: settings.sendTargets.activeFile ? context.activeFileExcerpt : undefined,
      selectedText: settings.sendTargets.selection ? context.selectedText : undefined,
      diagnosticsSummary: settings.sendTargets.diagnostics ? context.diagnosticsSummary : []
    };

    return {
      context: filteredContext,
      requestPlan: {
        kind,
        categories: this.buildCategories(filteredContext, settings),
        targetFiles: this.buildTargetFiles(context, filteredContext, settings),
        excludedGlobs: settings.excludedGlobs,
        estimatedSizeText: this.estimateSizeText(filteredContext, preview)
      }
    };
  }

  private buildCategories(context: GuidanceContext, settings: NavigatorSettings): RequestPlanCategory[] {
    return [
      this.createCategory("activeFile", "アクティブファイル断片", "現在編集中のファイルの内容", settings.sendTargets.activeFile, Boolean(context.activeFileExcerpt)),
      this.createCategory("selection", "選択範囲", "エディタで選択している範囲", settings.sendTargets.selection, Boolean(context.selectedText)),
      this.createCategory("diagnostics", "診断情報", "エラーや警告の情報", settings.sendTargets.diagnostics, context.diagnosticsSummary.length > 0 || settings.sendTargets.diagnostics),
      this.createCategory("recentEdits", "最近の編集範囲", "直近で編集した箇所", settings.sendTargets.recentEdits, false, "Phase 2 ではまだ収集中です"),
      this.createCategory("relatedSymbols", "関連シンボル", "関数や変数の定義・参照", settings.sendTargets.relatedSymbols, false, "Phase 2 ではまだ収集中です")
    ];
  }

  private buildTargetFiles(
    rawContext: GuidanceContext,
    filteredContext: GuidanceContext,
    settings: NavigatorSettings
  ): RequestPlanFile[] {
    if (!rawContext.activeFilePath) {
      return [];
    }

    const includedSize = this.byteLength(
      `${filteredContext.activeFileExcerpt ?? ""}${filteredContext.selectedText ?? ""}${filteredContext.diagnosticsSummary.map((item) => item.message).join("")}`
    );

    const included = Boolean(
      (settings.sendTargets.activeFile && filteredContext.activeFileExcerpt) ||
        (settings.sendTargets.selection && filteredContext.selectedText) ||
        (settings.sendTargets.diagnostics && filteredContext.diagnosticsSummary.length > 0)
    );

    return [
      {
        path: rawContext.activeFilePath,
        sizeText: this.toReadableSize(includedSize),
        included,
        excludedReason: included ? undefined : "現在の設定では送信対象が含まれていません"
      }
    ];
  }

  private estimateSizeText(context: GuidanceContext, preview: NavigatorContextPreview): string {
    const byteLength = this.byteLength(
      `${context.activeFileExcerpt ?? ""}${context.selectedText ?? ""}${context.diagnosticsSummary.map((item) => item.message).join("")}`
    );

    const categories = [
      preview.activeFilePath ? "ファイル" : undefined,
      context.selectedText ? "選択範囲" : undefined,
      context.diagnosticsSummary.length > 0 ? "diagnostics" : undefined
    ].filter((value): value is string => Boolean(value));

    return `${this.toReadableSize(byteLength)} / ${categories.length}カテゴリ`;
  }

  private createCategory(
    key: ContextCategoryKey,
    label: string,
    description: string,
    enabled: boolean,
    included: boolean,
    note?: string
  ): RequestPlanCategory {
    return {
      key,
      label,
      description,
      enabled,
      included,
      note
    };
  }

  private byteLength(value: string): number {
    return Buffer.byteLength(value, "utf8");
  }

  private toReadableSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    return `${(bytes / 1024).toFixed(1)} KB`;
  }
}
