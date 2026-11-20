/** Provider-independent, bounded retrieval planning. File access stays in the host. */
import type { GuidanceContext } from "../shared/types";

export interface ReferenceSearchEvidence {
  language?: string;
  codeSource: "selection" | "activeFile";
  code: string;
  codeTruncated: boolean;
  diagnostics: { severity: string; line: number; message: string }[];
}

/** Accept only the context already filtered for the selected provider; omit file paths and other metadata. */
export function buildReferenceSearchEvidence(context: GuidanceContext, maxChars: number): ReferenceSearchEvidence | undefined {
  const code = context.selectedText || context.activeFileExcerpt || "";
  const result: ReferenceSearchEvidence = { language: context.activeFileLanguage?.slice(0, 100),
    codeSource: context.selectedText ? "selection" : "activeFile", code: "", codeTruncated: code.length > 0, diagnostics: [] };
  // Reserve a short diagnostic summary before filling the remaining room with code.
  for (const diagnostic of context.diagnosticsSummary.slice(0, 3)) {
    result.diagnostics.push({ severity: diagnostic.severity, line: diagnostic.line, message: diagnostic.message.slice(0, 200) });
  }
  while (JSON.stringify(result).length > maxChars && result.diagnostics.length) result.diagnostics.pop();
  if (JSON.stringify(result).length > maxChars) return undefined;
  let low = 0, high = Math.min(1200, code.length);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    result.code = code.slice(0, middle); result.codeTruncated = middle < code.length;
    if (JSON.stringify(result).length <= maxChars) low = middle;
    else high = middle - 1;
  }
  result.code = code.slice(0, low); result.codeTruncated = low < code.length;
  return result;
}

export interface ReferenceCatalogItem {
  id: string;
  path: string;
  title: string;
  description?: string;
  sourceId?: string;
  localOnly?: boolean;
}
export interface ReferenceSearchRequest { queries: string[]; documentIds: string[] }

export const REFERENCE_SEARCH_LIMITS = { queries: 3, documents: 5, catalogChars: 8000, responseChars: 4000 } as const;

export function parseReferenceSearchRequest(text: string, catalog: readonly ReferenceCatalogItem[]): ReferenceSearchRequest | undefined {
  if (text.length > REFERENCE_SEARCH_LIMITS.responseChars) return undefined;
  try {
    const value: unknown = JSON.parse(text.replace(/^\s*```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim());
    if (!value || typeof value !== "object") return undefined;
    const { queries, documentIds } = value as Record<string, unknown>;
    if (!Array.isArray(queries) || !Array.isArray(documentIds) || queries.length > REFERENCE_SEARCH_LIMITS.queries || documentIds.length > REFERENCE_SEARCH_LIMITS.documents ||
      !queries.every(query => typeof query === "string" && query.trim().length > 0 && query.length <= 200) ||
      !documentIds.every(id => typeof id === "string" && catalog.some(item => item.id === id))) return undefined;
    return { queries: [...new Set(queries.map(query => query.trim()))], documentIds: [...new Set(documentIds)] };
  } catch { return undefined; }
}

export function boundReferenceCatalog(items: readonly ReferenceCatalogItem[], maxChars: number): ReferenceCatalogItem[] {
  const result: ReferenceCatalogItem[] = [];
  let remaining = maxChars - 2;
  for (const item of items) {
    const safe = { ...item, title: item.title.slice(0, 160), description: item.description?.slice(0, 240) };
    const length = JSON.stringify(safe).length + 1;
    if (length > remaining) continue;
    result.push(safe); remaining -= length;
  }
  return result;
}
