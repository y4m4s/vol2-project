/** Portable reference data; filesystem locations stay in the Extension Host. */
export type ReferenceKind = "rules" | "adr" | "document" | "skill";
export type ReferenceScope = "workspace" | "global";
export type ReferenceAction =
  | { type: "addContextSource"; kind: ReferenceKind; directory: boolean; scope: ReferenceScope }
  | { type: "removeContextSource"; id: string }
  | { type: "setContextSourceEnabled"; id: string; enabled: boolean }
  | { type: "configureContextSource"; id: string }
  | { type: "selectContextDocuments"; id: string }
  | { type: "openContextDocument"; id: string }
  | { type: "refreshContextSources" };
export interface ContextSource {
  id: string;
  uri: string;
  label: string;
  directory: boolean;
  kind: ReferenceKind;
  scope: ReferenceScope;
  enabled: boolean;
  localOnly: boolean;
  languages: string[];
  appliesTo: string[];
  workspaceRoot?: string;
  selectedPaths: string[];
  skillMode: "reference" | "procedure";
}
export interface ReferenceDocument {
  id: string;
  sourceId: string;
  relativePath: string;
  title: string;
  text: string;
  hash: string;
  kind: ReferenceKind;
  status?: string;
  skill?: { name: string; description: string; compatibility?: string; resources: string[] };
}
export interface ReferenceExcerpt {
  id: string;
  sourceId: string;
  path: string;
  title: string;
  kind: ReferenceKind;
  hash: string;
  text: string;
  startLine: number;
  endLine: number;
  reason: string;
  localOnly: boolean;
  mode: "reference" | "procedure";
}
export type ReferenceProvenance = Omit<ReferenceExcerpt, "text"> & { included: boolean; note?: string };
export interface ContextSourceView {
  location?: string;
  source: Omit<ContextSource, "uri" | "workspaceRoot">;
  status: "ready" | "scanning" | "error" | "disabled" | "restricted";
  documentCount: number;
  errors: string[];
  documents: { id: string; path: string; title: string; description?: string; selected: boolean }[];
}
export interface ReferenceContextView {
  revision: number;
  trusted: boolean;
  sources: ContextSourceView[];
}

/** Reference-specific stops that the guidance flow reports as a status instead of an unexpected failure. */
export class ReferenceContextError extends Error {
  public override readonly name = "ReferenceContextError";
}

export const REFERENCE_WITHHELD_LOCAL_NOTE = "ローカル限定の資料のため、この接続先には送信しません";

/**
 * Local-only excerpts never leave a verified local model. For any other destination they are
 * withheld from the prompt (provenance only, no text) instead of stopping the whole request.
 */
export function splitReferencesForDestination(excerpts: readonly ReferenceExcerpt[], destinationIsVerifiedLocal: boolean): {
  sent: ReferenceExcerpt[]; withheld: ReferenceProvenance[];
} {
  if (destinationIsVerifiedLocal) return { sent: [...excerpts], withheld: [] };
  return {
    sent: excerpts.filter(item => !item.localOnly),
    withheld: excerpts.filter(item => item.localOnly).map(({ text: _text, ...item }) => ({ ...item, included: false, note: REFERENCE_WITHHELD_LOCAL_NOTE }))
  };
}

export function isVerifiedReferenceLocalModel(model?: { providerId: string; endpoint?: string; modelId: string }): boolean {
  return Boolean(model && (model.providerId === "lmStudio" || model.providerId === "ollama") &&
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/i.test(model.endpoint ?? "") && !/cloud/i.test(model.modelId));
}
