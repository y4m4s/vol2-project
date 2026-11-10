import type * as vscode from "vscode";
import type { ContextSource } from "../shared/referenceContext";
import { SerialTaskQueue } from "./SerialTaskQueue";

const KEY = "aiPairNavigator.referenceSources.v1";
export class ContextSourceRegistry {
  private readonly queue = new SerialTaskQueue();
  private sources: ContextSource[];
  public constructor(private readonly workspace: vscode.Memento, private readonly global: vscode.Memento) {
    const read = (store: vscode.Memento, scope: ContextSource["scope"]) => {
      const value = store.get<unknown>(KEY);
      return Array.isArray(value) ? value.filter(isSource).map(source => ({ ...source, scope })) : [];
    };
    // The combined view can exceed the add limit when switching workspaces.
    // Never truncate persisted sources: editing a visible item would erase hidden ones.
    this.sources = [...read(workspace, "workspace"), ...read(global, "global")];
  }
  public list(): ContextSource[] { return this.sources.map(source => ({ ...source, languages: [...source.languages], appliesTo: [...source.appliesTo], selectedPaths: [...source.selectedPaths] })); }
  public async update(change: (sources: ContextSource[]) => ContextSource[]): Promise<void> {
    await this.queue.run(async () => {
      const next = change(this.list());
      // Each UI mutation affects only one scope. Avoid partial writes across two mementos.
      for (const scope of ["workspace", "global"] as const) {
        const before = this.sources.filter(source => source.scope === scope), after = next.filter(source => source.scope === scope);
        if (JSON.stringify(before) !== JSON.stringify(after)) await (scope === "workspace" ? this.workspace : this.global).update(KEY, after);
      }
      this.sources = next;
    });
  }
}
function isSource(value: unknown): value is ContextSource {
  if (!value || typeof value !== "object") return false;
  const source = value as ContextSource;
  return typeof source.id === "string" && typeof source.uri === "string" && source.uri.length < 4000 && typeof source.label === "string" &&
    ["rules", "adr", "document", "skill"].includes(source.kind) && typeof source.directory === "boolean" &&
    typeof source.enabled === "boolean" && typeof source.localOnly === "boolean" && ["reference", "procedure"].includes(source.skillMode) &&
    [source.languages, source.appliesTo, source.selectedPaths].every(items => Array.isArray(items) && items.length <= 1000 && items.every(item => typeof item === "string" && item.length <= 2000)) &&
    (source.workspaceRoot === undefined || typeof source.workspaceRoot === "string");
}
