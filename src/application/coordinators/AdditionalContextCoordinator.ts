import * as vscode from "vscode";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { ContextSource, ReferenceContextView, ReferenceDocument, ReferenceExcerpt, ReferenceKind, ReferenceScope } from "../../shared/referenceContext";
import type { ConversationEntry, GuidanceContext } from "../../shared/types";
import { ContextSourceRegistry } from "../../services/ContextSourceRegistry";
import { ReferenceDocumentService } from "../../services/ReferenceDocumentService";
import { isPathExcluded, PATH_CASE_INSENSITIVE } from "../../services/globMatch";
import { PROTECTED_EXCLUDED_GLOBS } from "../../services/protectedGlobs";
import { parseReferencePatterns, resolveReferenceContext } from "../../services/ReferenceContextResolver";

export class AdditionalContextCoordinator implements vscode.Disposable {
  private documents: ReferenceDocument[] = [];
  private errors = new Map<string, string[]>();
  private readonly watchers: vscode.Disposable[] = [];
  private readonly listeners: vscode.Disposable[] = [];
  private pending?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private dirty = true;
  public revision = 0;
  private readonly service = new ReferenceDocumentService();
  public constructor(private readonly registry: ContextSourceRegistry, private readonly changed: () => void,
    private readonly excluded: () => readonly string[]) {}

  public initialize(): void {
    this.listeners.push(vscode.workspace.onDidGrantWorkspaceTrust(() => { this.invalidate(); this.installWatchers(); this.schedule(); }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => { this.invalidate(); this.installWatchers(); this.schedule(); }));
    this.installWatchers();
    this.schedule();
  }
  public view(): ReferenceContextView {
    return { revision: this.revision, trusted: vscode.workspace.isTrusted, sources: this.registry.list().map(source => {
      const { uri: _uri, workspaceRoot: _root, ...safeSource } = source;
      let location: string | undefined;
      try { location = fileURLToPath(source.uri); } catch { /* Invalid saved URI is reported by scanning. */ }
      return { source: safeSource, location, status: !source.enabled ? "disabled" : !vscode.workspace.isTrusted ? "restricted" : this.pending ? "scanning" : this.errors.get(source.id)?.length ? "error" : "ready",
        documentCount: this.documents.filter(doc => doc.sourceId === source.id).length, errors: this.errors.get(source.id) ?? [],
        documents: this.documents.filter(doc => doc.sourceId === source.id && (source.kind !== "skill" || doc.skill)).map(doc => ({
          id: doc.id, path: doc.relativePath, title: doc.title, description: doc.skill?.description,
          selected: source.selectedPaths.includes(doc.relativePath)
        })) };
    }) };
  }
  public async add(kind: ReferenceKind, directory: boolean, scope: ReferenceScope): Promise<void> {
    this.requireTrust();
    if (this.registry.list().length >= 20) throw new Error("参照先は最大20件です。");
    if (scope === "workspace" && !vscode.workspace.workspaceFolders?.length) throw new Error("ワークスペースを開くか、共通の参照先として登録してください。");
    const selected = await vscode.window.showOpenDialog({ canSelectFiles: !directory, canSelectFolders: directory, canSelectMany: false,
      openLabel: "参照先に登録", filters: directory ? undefined : { "テキスト資料": ["md", "markdown", "txt", "json"] } });
    if (!selected?.[0]) return;
    const uri = selected[0];
    if (uri.scheme !== "file") throw new Error("このバージョンはローカルファイルに対応しています。");
    if (kind === "skill" && !directory && path.basename(uri.fsPath) !== "SKILL.md") throw new Error("Skillをファイル登録する場合はSKILL.mdを選択してください。");
    const source: ContextSource = { id: randomUUID(), uri: uri.toString(), label: path.basename(uri.fsPath), directory, kind, scope,
      enabled: true, localOnly: true, languages: [], appliesTo: [], selectedPaths: [], skillMode: "reference" };
    if (kind === "rules") {
      const languages = await vscode.window.showInputBox({ title: "規約の対象言語", prompt: "言語IDをカンマ区切りで指定（例: typescript,typescriptreact）。空欄は全言語。", value: "", ignoreFocusOut: true });
      if (languages === undefined) return;
      const appliesTo = await vscode.window.showInputBox({ title: "規約の対象パス", prompt: "ワークスペース相対globをカンマ区切りで指定（例: src/**）。空欄は全パス。", value: "", ignoreFocusOut: true });
      if (appliesTo === undefined) return;
      source.languages = this.parsePatterns(languages); source.appliesTo = this.parsePatterns(appliesTo);
      const roots = vscode.workspace.workspaceFolders ?? [];
      if (roots.length > 1) {
        const root = await vscode.window.showQuickPick([{ label: "すべてのルート", root: undefined as string | undefined }, ...roots.map(root => ({ label: root.name, description: root.uri.fsPath, root: root.uri.fsPath }))], { title: "規約の適用先" });
        if (!root) return;
        source.workspaceRoot = root.root;
      }
    }
    this.requireTrust();
    await this.registry.update(sources => sources.some(item => item.uri === source.uri && item.kind === source.kind && item.scope === scope) ? sources : [...sources, source]);
    this.invalidate(); this.installWatchers(); await this.refresh();
  }
  public async remove(id: string): Promise<void> {
    await this.registry.update(sources => sources.filter(source => source.id !== id));
    this.invalidate(); this.installWatchers(); await this.refresh();
  }
  public async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (enabled) this.requireTrust();
    await this.registry.update(sources => sources.map(source => source.id === id ? { ...source, enabled } : source));
    this.invalidate(); this.installWatchers(); await this.refresh();
  }
  public async configure(id: string): Promise<void> {
    this.requireTrust();
    const source = this.registry.list().find(source => source.id === id);
    if (!source) return;
    const option = await vscode.window.showQuickPick([
      { label: "送信範囲: ローカル限定", action: "local" }, { label: "送信範囲: 外部AIへの送信を許可", action: "external" },
      ...(source.kind === "skill" ? [{ label: "Skills: 参考資料として利用", action: "reference" }, { label: "Skills: 学習・説明の手順として適用", action: "procedure" }] : []),
      ...(source.kind === "rules" ? [{ label: "規約: 対象言語・パスを変更", action: "scope" }] : [])
    ], { title: `${source.label} の利用方法` });
    if (!option) return;
    if (option.action === "scope") {
      const languages = await vscode.window.showInputBox({ title: "規約の対象言語", value: source.languages.join(","), prompt: "言語IDをカンマ区切り（空欄は全言語）" });
      if (languages === undefined) return;
      const appliesTo = await vscode.window.showInputBox({ title: "規約の対象パス", value: source.appliesTo.join(","), prompt: "ワークスペース相対globをカンマ区切り（空欄は全パス）" });
      if (appliesTo === undefined) return;
      await this.registry.update(sources => sources.map(item => item.id === id ? { ...item, languages: this.parsePatterns(languages), appliesTo: this.parsePatterns(appliesTo) } : item));
      this.invalidate(); await this.refresh(); return;
    }
    if (option.action === "external" && await vscode.window.showWarningMessage(
      `${source.label} の選択箇所と、その内容を含む回答・履歴が接続先の外部AIに送信されます。`, { modal: true }, "外部送信を許可") !== "外部送信を許可") return;
    await this.registry.update(sources => sources.map(item => item.id !== id ? item : { ...item,
      localOnly: option.action === "external" ? false : option.action === "local" ? true : item.localOnly,
      skillMode: option.action === "procedure" ? "procedure" : option.action === "reference" ? "reference" : item.skillMode }));
    this.invalidate(); await this.refresh();
  }
  public async selectDocuments(id: string): Promise<void> {
    this.requireTrust(); await this.refresh();
    const source = this.registry.list().find(source => source.id === id);
    if (!source) return;
    const items = this.documents.filter(doc => doc.sourceId === id && (source.kind !== "skill" || doc.skill)).map(doc => ({
      label: doc.title, description: doc.relativePath, detail: doc.skill?.description,
      picked: source.selectedPaths.includes(doc.relativePath), relativePath: doc.relativePath
    }));
    const selected = await vscode.window.showQuickPick(items, { canPickMany: true, title: source.kind === "skill" ? "有効にするSkillsを選択（次回以降の相談に反映）" : "優先して参照する資料を選択（未選択の資料も関連検索されます）" });
    if (!selected) return;
    await this.registry.update(sources => sources.map(item => item.id === id ? { ...item, selectedPaths: selected.map(item => item.relativePath) } : item));
    this.invalidate(); await this.refresh();
  }
  public async openDocument(id: string): Promise<void> {
    this.requireTrust(); await this.refresh(true);
    const doc = this.documents.find(doc => doc.id === id);
    const source = this.registry.list().find(source => source.id === doc?.sourceId && source.enabled);
    if (!doc || !source) throw new Error("参照資料が削除されたか、利用できなくなりました。");
    const base = fileURLToPath(source.uri);
    const file = path.resolve(source.directory ? base : path.dirname(base), doc.relativePath);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(document, { preview: true });
  }
  public async resolve(context: GuidanceContext, question: string, activePath?: string, force = false): Promise<ReferenceExcerpt[]> {
    if (!vscode.workspace.isTrusted || !this.registry.list().some(source => source.enabled)) return [];
    await this.refresh(force);
    const uri = activePath && path.isAbsolute(activePath) ? vscode.Uri.file(activePath) : undefined;
    const root = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
    const relative = activePath && root ? path.relative(root.uri.fsPath, activePath).replaceAll("\\", "/") : "";
    return resolveReferenceContext(this.registry.list(), this.documents, context, question, relative, root?.uri.fsPath);
  }
  public async validate(excerpts: readonly ReferenceExcerpt[], revision: number): Promise<void> {
    if (!excerpts.length) return;
    this.requireTrust();
    await this.refresh(true);
    if (revision !== this.revision || excerpts.some(item => !this.documents.some(doc => doc.sourceId === item.sourceId && doc.hash === item.hash))) {
      throw new Error("参照資料または許可設定が更新されました。送信内容を確認してもう一度お試しください。");
    }
  }
  /** Recheck current permissions for prior answers as well as current excerpts. */
  public protectHistory(entries: readonly ConversationEntry[]): ConversationEntry[] {
    const sources = this.registry.list();
    return entries.map(entry => {
      if (entry.transmissionClass === "excluded") return entry;
      const ids = entry.requestPlan?.referenceSourceIds ?? entry.requestPlan?.referenceDocuments?.map(doc => doc.sourceId) ?? [];
      const restricted = ids.some(id => {
        const source = sources.find(source => source.id === id);
        return !source || !source.enabled || source.localOnly;
      });
      return restricted && entry.requestPlan ? { ...entry, transmissionClass: "localOnly", requestPlan: { ...entry.requestPlan, referenceLocalOnly: true } } : entry;
    });
  }
  public canReuseReferenceSources(ids: readonly string[]): boolean {
    const sources = this.registry.list();
    return ids.every(id => sources.some(source => source.id === id && source.enabled && !source.localOnly));
  }
  public async refresh(force = false): Promise<void> {
    if (this.disposed) return;
    if (this.pending) { await this.pending; if (this.dirty) await this.refresh(); return; }
    if (!force && !this.dirty) return;
    if (!vscode.workspace.isTrusted) { this.documents = []; this.changed(); return; }
    const generation = this.revision;
    const operation = (async () => {
      const scanned = await this.service.scan(this.registry.list(), this.excluded(), (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath));
      if (this.disposed || generation !== this.revision || !vscode.workspace.isTrusted) return;
      if (JSON.stringify(scanned.documents) !== JSON.stringify(this.documents)) this.revision++;
      this.documents = scanned.documents; this.errors = scanned.errors;
      this.dirty = false;
    })();
    this.pending = operation; this.changed();
    try { await operation; }
    finally { this.pending = undefined; if (!this.disposed) this.changed(); }
    if (this.dirty) await this.refresh();
  }
  public invalidate(): void { this.revision++; this.dirty = true; this.documents = []; this.changed(); }
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.refresh().catch(() => {}); }, 600);
  }
  private installWatchers(): void {
    this.watchers.splice(0).forEach(watcher => watcher.dispose());
    if (!vscode.workspace.isTrusted) return;
    for (const source of this.registry.list().filter(source => source.enabled)) {
      try {
        const uri = vscode.Uri.parse(source.uri);
        const base = source.directory ? uri : vscode.Uri.file(path.dirname(fileURLToPath(source.uri)));
        // Broad patterns plus a literal callback filter handle uppercase extensions
        // and registered filenames containing glob metacharacters such as [guide].md.
        const pattern = source.directory || source.kind === "skill" ? "**/*" : "*";
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, pattern));
        const changed = (target: vscode.Uri | undefined, structural: boolean) => {
          if (target) {
            const normalize = (value: string) => PATH_CASE_INSENSITIVE ? path.resolve(value).toLowerCase() : path.resolve(value);
            const bundledReference = source.kind === "skill" && /^references\//i.test(path.relative(base.fsPath, target.fsPath).replaceAll("\\", "/"));
            if (!source.directory && !bundledReference && normalize(target.fsPath) !== normalize(uri.fsPath) && normalize(target.fsPath) !== normalize(base.fsPath)) return;
            if (isPathExcluded(target.fsPath, PROTECTED_EXCLUDED_GLOBS) || isPathExcluded(`${target.fsPath}/__reference__`, PROTECTED_EXCLUDED_GLOBS)) return;
            if (!structural && !/\.(md|markdown|txt|json)$/i.test(target.fsPath)) return;
          }
          this.invalidate(); this.schedule();
        };
        this.watchers.push(watcher, watcher.onDidChange(uri => changed(uri, false)), watcher.onDidCreate(uri => changed(uri, true)), watcher.onDidDelete(uri => changed(uri, true)));
      } catch { /* Read/scan errors are reported by refresh; manual refresh remains available. */ }
    }
  }
  private requireTrust(): void { if (!vscode.workspace.isTrusted) throw new Error("ワークスペースを信頼してから参照資料を利用してください。"); }
  private parsePatterns(text: string): string[] { return parseReferencePatterns(text); }
  public dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    [...this.watchers, ...this.listeners].forEach(item => item.dispose());
    this.documents = [];
  }
}
