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
    const excludedGlobs = this.getEffectiveExcludedGlobs(settings);
    const fileExcluded = context.activeFilePath ? this.isPathExcluded(context.activeFilePath, excludedGlobs) : false;
    const filteredContext: GuidanceContext = {
      activeFilePath: context.activeFilePath,
      activeFileLanguage: context.activeFileLanguage,
      activeFileExcerpt: !fileExcluded ? context.activeFileExcerpt : undefined,
      selectedText: !fileExcluded ? context.selectedText : undefined,
      diagnosticsSummary: !fileExcluded ? context.diagnosticsSummary : [],
      recentEditsSummary: !fileExcluded ? context.recentEditsSummary : [],
      relatedSymbols: !fileExcluded ? context.relatedSymbols : [],
      additionalContext: context.additionalContext
    };

    return {
      context: filteredContext,
      requestPlan: {
        kind,
        categories: this.buildCategories(context, filteredContext, fileExcluded),
        targetFiles: this.buildTargetFiles(context, filteredContext, fileExcluded),
        excludedGlobs,
        estimatedSizeText: this.estimateSizeText(filteredContext, preview)
      }
    };
  }

  private buildCategories(
    rawContext: GuidanceContext,
    context: GuidanceContext,
    fileExcluded: boolean
  ): RequestPlanCategory[] {
    return [
      this.createCategory(
        "activeFile",
        "アクティブファイル断片",
        "現在編集中のファイルの内容",
        true,
        Boolean(context.activeFileExcerpt),
        this.describeFileCategoryNote(fileExcluded, rawContext.activeFilePath, context.activeFileExcerpt)
      ),
      this.createCategory(
        "selection",
        "選択範囲",
        "エディタで選択している範囲",
        true,
        Boolean(context.selectedText),
        this.describeSelectionCategoryNote(fileExcluded, rawContext.selectedText, context.selectedText)
      ),
      this.createCategory(
        "diagnostics",
        "診断情報",
        "エラーや警告の情報",
        true,
        context.diagnosticsSummary.length > 0,
        this.describeDiagnosticsCategoryNote(fileExcluded, rawContext.diagnosticsSummary, context.diagnosticsSummary)
      ),
      this.createCategory(
        "recentEdits",
        "最近の編集範囲",
        "直近で編集した箇所",
        true,
        context.recentEditsSummary.length > 0,
        this.describeCollectionNote(fileExcluded, rawContext.recentEditsSummary.length, context.recentEditsSummary, "最近の編集はまだ記録されていません")
      ),
      this.createCategory(
        "relatedSymbols",
        "関連シンボル",
        "現在位置から推定した関数や変数の候補",
        true,
        context.relatedSymbols.length > 0,
        this.describeCollectionNote(fileExcluded, rawContext.relatedSymbols.length, context.relatedSymbols, "関連シンボル候補はまだありません")
      ),
      this.createCategory(
        "additionalContext",
        "追加コンテキスト",
        "ユーザーが入力した補足文脈",
        true,
        Boolean(context.additionalContext),
        context.additionalContext ? "入力された補足文脈を送信します" : "追加コンテキストは入力されていません"
      )
    ];
  }

  private buildTargetFiles(
    rawContext: GuidanceContext,
    filteredContext: GuidanceContext,
    fileExcluded: boolean
  ): RequestPlanFile[] {
    if (!rawContext.activeFilePath) {
      return [];
    }

    const includedSize = this.byteLength(
      `${filteredContext.activeFileExcerpt ?? ""}${filteredContext.selectedText ?? ""}${filteredContext.diagnosticsSummary.map((item) => item.message).join("")}${filteredContext.recentEditsSummary.join("")}${filteredContext.relatedSymbols.join("")}`
    );

    const included = Boolean(
      !fileExcluded &&
        (filteredContext.activeFileExcerpt ||
          filteredContext.selectedText ||
          filteredContext.diagnosticsSummary.length > 0 ||
          filteredContext.recentEditsSummary.length > 0 ||
          filteredContext.relatedSymbols.length > 0)
    );

    return [
      {
        path: rawContext.activeFilePath,
        sizeText: this.toReadableSize(includedSize),
        included,
        excludedReason: included
          ? undefined
          : fileExcluded
            ? "除外 glob に一致したため送信しません"
            : "送信できる文脈がまだありません"
      }
    ];
  }

  private estimateSizeText(context: GuidanceContext, _preview: NavigatorContextPreview): string {
    const byteLength = this.byteLength(
      `${context.activeFileExcerpt ?? ""}${context.selectedText ?? ""}${context.diagnosticsSummary.map((item) => item.message).join("")}${context.recentEditsSummary.join("")}${context.relatedSymbols.join("")}${context.additionalContext ?? ""}`
    );

    const categories = [
      context.activeFileExcerpt ? "ファイル" : undefined,
      context.selectedText ? "選択範囲" : undefined,
      context.diagnosticsSummary.length > 0 ? "diagnostics" : undefined,
      context.recentEditsSummary.length > 0 ? "recentEdits" : undefined,
      context.relatedSymbols.length > 0 ? "symbols" : undefined,
      context.additionalContext ? "追加" : undefined
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

  private describeFileCategoryNote(fileExcluded: boolean, activeFilePath?: string, excerpt?: string): string | undefined {
    if (fileExcluded) {
      return "除外設定に一致したため、このファイルは送信対象外です";
    }

    if (!activeFilePath) {
      return "アクティブファイルがありません";
    }

    if (!excerpt) {
      return "本文抜粋がまだ取得できていません";
    }

    return "現在の表示範囲や選択範囲から本文を抜粋します";
  }

  private describeSelectionCategoryNote(fileExcluded: boolean, rawSelection?: string, selection?: string): string | undefined {
    if (fileExcluded) {
      return "除外設定に一致したため、選択範囲も送信しません";
    }

    if (!rawSelection) {
      return "選択範囲がないため送信しません";
    }

    return "現在の選択範囲を優先して送信します";
  }

  private describeDiagnosticsCategoryNote(
    fileExcluded: boolean,
    rawDiagnostics: GuidanceContext["diagnosticsSummary"],
    diagnostics: GuidanceContext["diagnosticsSummary"]
  ): string | undefined {
    if (fileExcluded) {
      return "除外設定に一致したため、診断情報も送信しません";
    }

    if (rawDiagnostics.length === 0) {
      return "現在のファイルに診断情報はありません";
    }

    return `${diagnostics.length}件の診断情報を送信します`;
  }

  private describeCollectionNote(
    fileExcluded: boolean,
    rawCount: number,
    values: string[],
    emptyMessage: string
  ): string | undefined {
    if (fileExcluded) {
      return "除外設定に一致したため送信しません";
    }

    if (rawCount === 0) {
      return emptyMessage;
    }

    return values.join(" / ");
  }

  private isPathExcluded(filePath: string, patterns: string[]): boolean {
    const normalizedPath = filePath.replaceAll("\\", "/");
    return patterns.some((pattern) => this.globToRegExp(pattern).test(normalizedPath));
  }

  private getEffectiveExcludedGlobs(settings: NavigatorSettings): string[] {
    return [...new Set([...settings.protectedExcludedGlobs, ...settings.excludedGlobs])];
  }

  private globToRegExp(pattern: string): RegExp {
    const escaped = pattern
      .replaceAll("\\", "/")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "__DOUBLE_STAR__")
      .replace(/\*/g, "[^/]*")
      .replace(/__DOUBLE_STAR__/g, ".*")
      .replace(/\?/g, ".");

    return new RegExp(`^${escaped}$`);
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
