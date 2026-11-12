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
import { parseReferencePatterns, referenceQueryTerms, resolveReferenceContext } from "../../services/ReferenceContextResolver";
import { boundReferenceCatalog, type ReferenceCatalogItem, type ReferenceSearchRequest } from "../../services/ReferenceRetrieval";
import { ReferenceContextError } from "../../shared/referenceContext";
import { isReferenceTextPath, REFERENCE_TEXT_EXTENSIONS } from "../../shared/referenceFiles";

/**
 * A full rescan before sending is only needed to catch changes that watchers missed.
 * Within this window the cached catalog is used; the files actually sent are always re-hashed.
 */
export const REFERENCE_FULL_RESCAN_INTERVAL_MS = 30_000;

export class AdditionalContextCoordinator implements vscode.Disposable {
  private documents: ReferenceDocument[] = [];
  private errors = new Map<string, string[]>();
  private readonly watchers: vscode.Disposable[] = [];
  private readonly listeners: vscode.Disposable[] = [];
  private pending?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private dirty = true;
  private lastScanAt = 0;
  public revision = 0;
  public conversationId?: string;
  private readonly service = new ReferenceDocumentService();
  public constructor(private readonly registry: ContextSourceRegistry, private readonly changed: () => void,
    private readonly excluded: () => readonly string[]) {}

  public sources(): ContextSource[] { return this.registry.list(); }
  public async importLegacy(): Promise<void> {
    this.requireTrust();
    const items = this.registry.legacySources().filter(source => !this.sources().some(item => item.id === source.id));
    const selected = await vscode.window.showQuickPick(items.map(source => ({ label: source.label, description: source.kind === "skill" ? "Skills" : undefined, source })),
      { canPickMany: true, title: "この会話に添付" });
    if (!selected?.length) return;
    await this.registry.update(sources => [...sources, ...selected.map(item => item.source)]);
    this.invalidate(); this.installWatchers(); await this.refresh();
  }
  public activate(sources: readonly ContextSource[], conversationId?: string): void {
    this.conversationId = conversationId;
    this.registry.activate(sources);
    this.errors.clear(); this.invalidate(); this.installWatchers(); this.schedule();
  }

  public initialize(): void {
    this.listeners.push(vscode.workspace.onDidGrantWorkspaceTrust(() => { this.invalidate(); this.installWatchers(); this.schedule(); }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => { this.invalidate(); this.installWatchers(); this.schedule(); }));
    this.installWatchers();
    this.schedule();
  }
  public view(): ReferenceContextView {
    return { revision: this.revision, trusted: vscode.workspace.isTrusted, legacyAvailable: this.registry.legacySources().some(source => !this.sources().some(item => item.id === source.id)), workspaceAvailable: Boolean(vscode.workspace.workspaceFolders?.length), sources: this.registry.list().map(source => {
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
    const selected = await vscode.window.showOpenDialog({ canSelectFiles: !directory, canSelectFolders: directory, canSelectMany: false,
      openLabel: "添付", filters: directory ? undefined : { "テキスト・コード": REFERENCE_TEXT_EXTENSIONS } });
    if (!selected?.[0]) return;
    const uri = selected[0];
    if (uri.scheme !== "file") throw new ReferenceContextError("このバージョンはローカルファイルに対応しています。");
    if (!directory && path.basename(uri.fsPath) === "SKILL.md") kind = "skill";
    if (kind === "skill" && !directory && path.basename(uri.fsPath) !== "SKILL.md") throw new ReferenceContextError("Skillをファイル登録する場合はSKILL.mdを選択してください。");
    const source: ContextSource = { id: randomUUID(), uri: uri.toString(), label: path.basename(uri.fsPath), directory, kind, scope,
      enabled: true, localOnly: true, languages: [], appliesTo: [], selectedPaths: kind === "skill" && !directory ? ["SKILL.md"] : [], skillMode: kind === "skill" ? "procedure" : "reference" };
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
      ...(!source.directory && source.kind !== "skill" ? [{ label: "参照方法: 必要な箇所を検索", action: "search" }, { label: "参照方法: 常に全文を含める", action: "full" }] : []),
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
      alwaysInclude: option.action === "full" ? true : option.action === "search" ? false : item.alwaysInclude,
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
    const selected = await vscode.window.showQuickPick(items, { canPickMany: true, title: "常に含めるファイル・適用するSkills" });
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
  /** fresh: rescan only when watchers may have missed changes for longer than the rescan interval. */
  public async resolve(context: GuidanceContext, question: string, activePath?: string, fresh = false, search?: ReferenceSearchRequest): Promise<ReferenceExcerpt[]> {
    if (!vscode.workspace.isTrusted || !this.registry.list().some(source => source.enabled)) return [];
    await this.refresh(fresh && Date.now() - this.lastScanAt >= REFERENCE_FULL_RESCAN_INTERVAL_MS);
    const sources = this.registry.list();
    const requestedSkills = this.documents.filter(doc => doc.skill && search?.documentIds.includes(doc.id) &&
      sources.some(source => source.id === doc.sourceId && source.kind === "skill" && !source.selectedPaths.includes(doc.relativePath)));
    // Legacy Skill-only catalogs initially contain metadata. Load the requested bundles
    // in one bounded scan, without changing the conversation's persistent selection.
    if (requestedSkills.length) await this.refresh(true, requestedSkills);
    const uri = activePath && path.isAbsolute(activePath) ? vscode.Uri.file(activePath) : undefined;
    const root = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
    const relative = activePath && root ? path.relative(root.uri.fsPath, activePath).replaceAll("\\", "/") : "";
    return resolveReferenceContext(this.registry.list(), this.documents, context, [question, ...(search?.queries ?? [])].join("\n"), relative, root?.uri.fsPath, search?.documentIds);
  }
  public async catalog(context: GuidanceContext, question: string, verifiedLocal: boolean, maxChars: number): Promise<ReferenceCatalogItem[]> {
    if (!vscode.workspace.isTrusted) return [];
    await this.refresh();
    if (!vscode.workspace.isTrusted) return [];
    const terms = referenceQueryTerms(`${question}\n${context.additionalContext ?? ""}\n${context.activeFileLanguage ?? ""}`);
    const sources = this.registry.list().filter(source => source.enabled && (verifiedLocal || !source.localOnly));
    // Metadata can be confidential too. Never expose private paths or Skill descriptions to cloud models.
    const items = this.documents.filter(doc => sources.some(source => source.id === doc.sourceId && !source.alwaysInclude &&
      !source.selectedPaths.includes(doc.relativePath) && (source.kind !== "skill" || doc.skill))).map(doc => {
      const source = sources.find(source => source.id === doc.sourceId)!;
      const item = { id: doc.id, path: `${source.label}/${doc.relativePath}`, title: doc.title, description: doc.skill?.description, sourceId: source.id, localOnly: source.localOnly };
      const text = `${item.path}\n${item.title}\n${item.description ?? ""}`.normalize("NFKC").toLowerCase();
      return { item, score: terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0) };
    }).sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path));
    return boundReferenceCatalog(items.map(({ item }) => item), maxChars);
  }
  /** Re-hash only the files that are about to be sent instead of rescanning every registered source. */
  public async validate(excerpts: readonly ReferenceExcerpt[], revision: number): Promise<void> {
    if (!excerpts.length) return;
    if (!vscode.workspace.isTrusted) throw new ReferenceContextError("ワークスペースを信頼してから参照資料を利用してください。");
    if (this.pending) await this.pending;
    const stale = () => new ReferenceContextError("参照資料または許可設定が更新されました。送信内容を確認してもう一度お試しください。");
    if (revision !== this.revision || this.dirty) throw stale();
    const sources = this.registry.list();
    const targets = new Map<string, { source: ContextSource; documents: Map<string, ReferenceDocument> }>();
    for (const excerpt of excerpts) {
      const doc = this.documents.find(doc => doc.id === excerpt.id.slice(0, excerpt.id.lastIndexOf(":")) && doc.sourceId === excerpt.sourceId);
      const source = sources.find(source => source.id === excerpt.sourceId && source.enabled);
      if (!doc || !source || doc.hash !== excerpt.hash || source.localOnly !== excerpt.localOnly) throw stale();
      const target = targets.get(source.id) ?? { source, documents: new Map<string, ReferenceDocument>() };
      target.documents.set(doc.relativePath, doc);
      targets.set(source.id, target);
    }
    const roots = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
    for (const { source, documents } of targets.values()) {
      const hashes = await this.service.verify(source, [...documents.keys()], this.excluded(), roots);
      if ([...documents].some(([relativePath, doc]) => hashes.get(relativePath) !== doc.hash)) {
        // The cached catalog is outdated; rebuild it on the next preview or request.
        this.invalidate(); this.schedule();
        throw stale();
      }
    }
    if (revision !== this.revision) throw stale();
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
  public async refresh(force = false, requestedSkills: readonly ReferenceDocument[] = []): Promise<void> {
    if (this.disposed) return;
    if (this.pending) { await this.pending; await this.refresh(force, requestedSkills); return; }
    if (!force && !this.dirty) return;
    if (!vscode.workspace.isTrusted) { this.documents = []; this.changed(); return; }
    const generation = this.revision;
    const sources = this.registry.list().map(source => ({ ...source, selectedPaths: [...new Set([
      ...source.selectedPaths, ...requestedSkills.filter(doc => doc.sourceId === source.id).map(doc => doc.relativePath)
    ])] }));
    const operation = (async () => {
      const scanned = await this.service.scan(sources, this.excluded(), (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath));
      if (this.disposed || generation !== this.revision || !vscode.workspace.isTrusted) return;
      // Text, title, status and Skill metadata are derived from the content hash.
      if (documentSignature(scanned.documents) !== documentSignature(this.documents)) this.revision++;
      this.documents = scanned.documents; this.errors = scanned.errors;
      this.dirty = false; this.lastScanAt = Date.now();
    })();
    this.pending = operation; this.changed();
    try { await operation; }
    finally { this.pending = undefined; if (!this.disposed) this.changed(); }
    if (this.dirty) await this.refresh(false, requestedSkills);
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
            if (!structural && !isReferenceTextPath(target.fsPath)) return;
          }
          this.invalidate(); this.schedule();
        };
        this.watchers.push(watcher, watcher.onDidChange(uri => changed(uri, false)), watcher.onDidCreate(uri => changed(uri, true)), watcher.onDidDelete(uri => changed(uri, true)));
      } catch { /* Read/scan errors are reported by refresh; manual refresh remains available. */ }
    }
  }
  private requireTrust(): void { if (!vscode.workspace.isTrusted) throw new ReferenceContextError("ワークスペースを信頼してから参照資料を利用してください。"); }
  private parsePatterns(text: string): string[] { return parseReferencePatterns(text); }
  public dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    [...this.watchers, ...this.listeners].forEach(item => item.dispose());
    this.documents = [];
  }
}
function documentSignature(documents: readonly ReferenceDocument[]): string {
  return documents.map(doc => `${doc.sourceId}\0${doc.id}\0${doc.relativePath}\0${doc.hash}`).join("\n");
}
