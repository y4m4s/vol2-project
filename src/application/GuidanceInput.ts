import { getSkill, isSlashCommand } from "../shared/skills";
import {
  AssistanceDepth,
  AutomaticGuidanceObservation,
  GuidanceContext,
  GuidanceKind,
  ProjectContextScope,
  SlashCommand,
  SlashCommandScope
} from "../shared/types";

export interface ParsedSlashInput {
  userPrompt?: string;
  slashCommand?: SlashCommand;
  slashCommandScope?: SlashCommandScope;
}

export function parseSlashInput(value?: string): ParsedSlashInput {
  const trimmed = value?.trim();
  if (!trimmed) {
    return {};
  }

  const match = /^\/([a-zA-Z][a-zA-Z0-9_-]*)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) {
    return { userPrompt: trimmed };
  }

  const normalized = match[1].toLowerCase();
  const slashCommand = isSlashCommand(normalized) ? normalized : undefined;
  if (!slashCommand) {
    return { userPrompt: trimmed };
  }

  const userPrompt = match[2]?.trim();
  if (getSkill(slashCommand).supportsScope) {
    const nextScope = parseNextSlashCommandScope(userPrompt);
    return {
      slashCommand,
      slashCommandScope: nextScope.scope,
      userPrompt: nextScope.userPrompt
    };
  }

  return {
    slashCommand,
    slashCommandScope: "standard",
    userPrompt: userPrompt || undefined
  };
}

export function resolveUserEntryText(
  kind: GuidanceKind,
  userPrompt?: string,
  slashCommand?: SlashCommand,
  slashCommandScope?: SlashCommandScope
): string | undefined {
  if (slashCommand) {
    return userPrompt?.trim() || getSkill(slashCommand).userEntryText(slashCommandScope);
  }

  if (userPrompt?.trim() && kind !== "always") {
    return userPrompt.trim();
  }

  return kind === "context" ? "この箇所を相談" : undefined;
}

export function resolveEffectiveAssistanceDepth(
  kind: GuidanceKind,
  assistanceDepth: AssistanceDepth,
  slashCommand?: SlashCommand
): AssistanceDepth {
  if (kind === "always") {
    return assistanceDepth;
  }

  const forced = slashCommand ? getSkill(slashCommand).forceDepth : undefined;
  return forced ?? assistanceDepth;
}

export function resolveNextProjectScope(
  assistanceDepth: AssistanceDepth,
  slashCommandScope?: SlashCommandScope
): ProjectContextScope {
  if (slashCommandScope === "deep") {
    return "deep";
  }

  return assistanceDepth === "high" ? "project" : "project-lite";
}

export function hasMeaningfulContext(context: GuidanceContext): boolean {
  return Boolean(
    context.activeFileExcerpt ||
      context.selectedText ||
      context.workspaceTree?.treeText ||
      context.referencedFiles.length > 0 ||
      context.diagnosticsSummary.length > 0 ||
      context.recentEditsSummary.length > 0 ||
      context.relatedSymbols.length > 0 ||
      context.projectSummary ||
      context.additionalContext
  );
}

export function withAdditionalContext(context: GuidanceContext, additionalContext?: string): GuidanceContext {
  const normalized = normalizeAdditionalContext(additionalContext);
  return normalized ? { ...context, additionalContext: normalized } : context;
}

export function resolveAdditionalContext(additionalContext: string | undefined, fallback?: string): string | undefined {
  return normalizeAdditionalContext(additionalContext) ?? normalizeAdditionalContext(fallback);
}

export function normalizeAdditionalContext(value?: string): string | undefined {
  const normalized = value?.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= 4000 ? normalized : `${normalized.slice(0, 4000)}...`;
}

/**
 * 自動助言の重複判定キー。
 *
 * 「同じ状況にもう一度助言しない」ための鍵なので、コードや診断など入力そのものの
 * 変化だけを見て、カーソル位置・表示範囲といった「どこを見ているか」は含めない。
 * 見ている場所が変わっただけで新しい助言を出す理由にはならず、含めると回答を読む
 * ための操作だけで自動助言が繰り返される。
 */
export function createAutomaticFingerprint(
  context: GuidanceContext,
  assistanceDepth: AssistanceDepth = "low",
  observation?: AutomaticGuidanceObservation,
  documentSnapshot?: string
): string {
  return JSON.stringify({
    observation: observation ? {
      selectionPresent: observation.selectionPresent
      // Event reasons are not input changes: repeated diagnostics/editor events
      // can describe exactly the same context. Also exclude time and previousFocus.
      // カーソル位置・周辺抜粋・lastEdit も除外する。lastEdit は 5 分の TTL で
      // 勝手に消えるので、含めると何も操作していなくても時間経過だけで鍵が変わる。
    } : undefined,
    assistanceDepth,
    file: context.activeFilePath,
    // activeFileExcerpt は表示範囲から作るため（ローカル推論以外）スクロールだけで変わる。
    // 同じファイルの同じ版数なら、どこを表示していても状況は同じとみなす。版数を取れない
    // ときだけ抜粋で代用する。
    source: documentSnapshot ?? context.activeFileExcerpt,
    selection: context.selectedText,
    diagnostics: context.diagnosticsSummary.map((item) => `${item.severity}:${item.line}:${item.message}`),
    // recentEditsSummary も 5 分の TTL で古い記録が落ちていくため除外する。コードが
    // 変わったかどうかは上の版数で分かるので、判定力は落ちない。
    // relatedSymbols はカーソル位置の単語とその行から作られる。別の行をクリックしただけで
    // 変わるので、これも使わない（どちらも AI への入力としてはそのまま送る）。
    workspaceTree: context.workspaceTree?.treeText,
    referencedFiles: context.referencedFiles.map((file) => ({
      path: file.path,
      reason: file.reason,
      excerpt: file.excerpt,
      diagnostics: file.diagnosticsSummary.map((item) => `${item.severity}:${item.line}:${item.message}`)
    })),
    additionalContext: context.additionalContext
  });
}

function parseNextSlashCommandScope(value: string | undefined): {
  scope: SlashCommandScope;
  userPrompt?: string;
} {
  const args = value?.trim();
  if (!args) {
    return { scope: "standard" };
  }

  const [firstArg, ...rest] = args.split(/\s+/);
  if (firstArg && /^(deep|wide|full)$/i.test(firstArg)) {
    const userPrompt = rest.join(" ").trim();
    return {
      scope: "deep",
      userPrompt: userPrompt || undefined
    };
  }

  return {
    scope: "standard",
    userPrompt: args
  };
}
