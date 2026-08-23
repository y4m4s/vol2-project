import { getSkill, isSlashCommand } from "../shared/skills";
import {
  AssistanceDepth,
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
    return "low";
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

export function createAutomaticFingerprint(context: GuidanceContext): string {
  return JSON.stringify({
    file: context.activeFilePath,
    excerpt: context.activeFileExcerpt,
    selection: context.selectedText,
    diagnostics: context.diagnosticsSummary.map((item) => `${item.severity}:${item.line}:${item.message}`),
    recentEdits: context.recentEditsSummary,
    relatedSymbols: context.relatedSymbols,
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
