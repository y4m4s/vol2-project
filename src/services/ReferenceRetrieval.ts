/** Provider-independent, bounded retrieval planning. File access stays in the host. */
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
