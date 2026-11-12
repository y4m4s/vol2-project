import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Module from "node:module";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { ContextSourceRegistry } from "../src/services/ContextSourceRegistry";
import type { ContextSource } from "../src/shared/referenceContext";
import type { ConversationEntry, GuidanceContext } from "../src/shared/types";

let trusted = true;
const events: ((uri?: { fsPath: string }) => void)[] = [];
let watches = 0, disposed = 0;
const openDialogs: { canSelectFiles: boolean; canSelectFolders: boolean }[] = [];
const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
const fileUri = (file: string) => ({ scheme: "file", fsPath: file, toString: () => pathToFileURL(file).href });
loader._load = (id, parent, isMain) => id === "vscode" ? {
  window: { showOpenDialog: async (options: { canSelectFiles: boolean; canSelectFolders: boolean }) => { openDialogs.push(options); return undefined; } },
  Uri: { file: fileUri, parse: (uri: string) => fileUri(fileURLToPath(uri)) },
  RelativePattern: class { constructor(public base: unknown, public pattern: unknown) {} },
  workspace: {
    get isTrusted() { return trusted; }, workspaceFolders: [], getWorkspaceFolder: () => undefined,
    onDidGrantWorkspaceTrust: () => ({ dispose() {} }), onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    createFileSystemWatcher: () => { watches++; return { dispose: () => { disposed++; },
      onDidChange: (fn: () => void) => { events.push(fn); return { dispose() {} }; },
      onDidCreate: (fn: () => void) => { events.push(fn); return { dispose() {} }; },
      onDidDelete: (fn: () => void) => { events.push(fn); return { dispose() {} }; } }; }
  }
} : originalLoad(id, parent, isMain);
const { AdditionalContextCoordinator } = require("../src/application/coordinators/AdditionalContextCoordinator") as typeof import("../src/application/coordinators/AdditionalContextCoordinator");
loader._load = originalLoad;

const context: GuidanceContext = { referencedFiles: [], diagnosticsSummary: [], recentEditsSummary: [], relatedSymbols: [] };
async function setup(t: TestContext, localOnly = true) {
  openDialogs.splice(0);
  trusted = true; watches = 0; disposed = 0; events.splice(0);
  const parent = path.resolve(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, "navicom-coordinator-"));
  assert.equal(path.dirname(root), parent);
  t.after(async () => { assert.equal(path.dirname(root), parent); await fs.rm(root, { recursive: true, force: true }); trusted = true; });
  await fs.writeFile(path.join(root, "guide.md"), "# TypeScript\n命名規約");
  const source: ContextSource = { id: "source", uri: pathToFileURL(root).href, label: "docs", directory: true, kind: "document", scope: "workspace",
    enabled: true, localOnly, languages: [], appliesTo: [], selectedPaths: [], skillMode: "reference" };
  const data = new Map<string, unknown>([["aiPairNavigator.referenceSources.v1", [source]]]);
  const storage = { get: <T>(key: string) => data.get(key) as T | undefined, update: async (key: string, value: unknown) => { data.set(key, value); }, keys: () => [...data.keys()] };
  const empty = { ...storage, get: <T>() => undefined as T | undefined };
  let notifications = 0;
  const coordinator = new AdditionalContextCoordinator(new ContextSourceRegistry(storage, empty), () => { notifications++; }, () => []);
  t.after(() => coordinator.dispose());
  return { root, coordinator, data, notifications: () => notifications };
}

test("conversation attachments can open file and folder pickers without a workspace", async t => {
  const h = await setup(t);
  assert.equal(h.coordinator.view().workspaceAvailable, false);
  await h.coordinator.add("document", false, "global");
  await h.coordinator.add("document", true, "global");
  assert.deepEqual(openDialogs.map(options => [options.canSelectFiles, options.canSelectFolders]), [[true, false], [false, true]]);
  await h.coordinator.add("document", false, "workspace");
  assert.equal(openDialogs.length, 3);
});

test("untrusted workspaces cannot scan or resolve saved sources", async t => {
  const h = await setup(t);
  trusted = false;
  assert.deepEqual(await h.coordinator.resolve(context, "TypeScript"), []);
  await h.coordinator.refresh();
  assert.equal(h.coordinator.view().sources[0].documentCount, 0);
  assert.equal(h.coordinator.view().sources[0].status, "restricted");
  await assert.rejects(h.coordinator.add("document", true, "workspace"), /信頼/);
});

test("cache avoids preview rescans while forced validation detects changes without watcher events", async t => {
  const h = await setup(t);
  const selected = await h.coordinator.resolve(context, "TypeScript"), revision = h.coordinator.revision;
  const notifications = h.notifications();
  await h.coordinator.resolve(context, "命名");
  assert.equal(h.notifications(), notifications, "typing only searches the in-memory catalog");
  await fs.writeFile(path.join(h.root, "guide.md"), "# TypeScript\nNEW_VERSION");
  await assert.rejects(h.coordinator.validate(selected, revision), /更新/);
  const updated = await h.coordinator.resolve(context, "TypeScript");
  assert.notEqual(updated[0].hash, selected[0].hash);
  assert.equal("uri" in h.coordinator.view().sources[0].source, false);
});

test("watcher events invalidate cached previews and new/delete changes appear", async t => {
  const h = await setup(t); h.coordinator.initialize();
  assert.equal(watches, 1);
  await h.coordinator.resolve(context, "TypeScript");
  const revision = h.coordinator.revision;
  await fs.writeFile(path.join(h.root, "new.md"), "TypeScript NEW_FILE"); events[1]();
  assert.ok(h.coordinator.revision > revision);
  assert.equal((await h.coordinator.resolve(context, "NEW_FILE")).some(doc => doc.path.endsWith("new.md")), true);
  await fs.unlink(path.join(h.root, "new.md")); events[2]();
  assert.equal((await h.coordinator.resolve(context, "NEW_FILE")).some(doc => doc.path.endsWith("new.md")), false);
});

test("code and uppercase documents invalidate previews while binary edits do not", async t => {
  const h = await setup(t); h.coordinator.initialize();
  await h.coordinator.resolve(context, "TypeScript");
  const revision = h.coordinator.revision;
  events[0]({ fsPath: path.join(h.root, "image.png") });
  assert.equal(h.coordinator.revision, revision);
  events[0]({ fsPath: path.join(h.root, "GUIDE.MD") });
  assert.ok(h.coordinator.revision > revision);
  const afterMarkdown = h.coordinator.revision;
  events[0]({ fsPath: path.join(h.root, "code.ts") });
  assert.ok(h.coordinator.revision > afterMarkdown);
});

test("catalog metadata respects destination permissions and conversation activation", async t => {
  const h = await setup(t);
  assert.deepEqual(await h.coordinator.catalog(context, "TypeScript", false, 8000), []);
  assert.equal((await h.coordinator.catalog(context, "TypeScript", true, 8000)).length, 1);
  h.coordinator.activate([]);
  assert.deepEqual(await h.coordinator.catalog(context, "TypeScript", true, 8000), []);
  assert.equal(h.coordinator.view().legacyAvailable, true);
  assert.equal((h.data.get("aiPairNavigator.referenceSources.v1") as ContextSource[]).length, 1);
});

test("permitted catalog exposes metadata without file bodies", async t => {
  const h = await setup(t, false);
  const catalog = await h.coordinator.catalog(context, "TypeScript", false, 8000);
  assert.equal(catalog.length, 1);
  assert.equal("text" in catalog[0], false);
  assert.equal(JSON.stringify(catalog).includes("命名規約"), false);
});

test("nested Skill catalogs and per-request selection include bundled files without persisting selection", async t => {
  const h = await setup(t, false), skillRoot = path.join(h.root, "team", "frontend", "review");
  await fs.mkdir(path.join(skillRoot, "references", "typescript"), { recursive: true });
  await fs.writeFile(path.join(skillRoot, "SKILL.md"), "---\nname: review\ndescription: Review TypeScript code\n---\nRead [guides](references/).\nNESTED_SKILL_STEPS");
  await fs.writeFile(path.join(skillRoot, "references", "typescript", "guide.md"), "RetryPolicy NESTED_REFERENCE_BODY");
  const original = h.coordinator.sources()[0];
  h.coordinator.activate([{ ...original, kind: "skill" }]);
  const catalog = await h.coordinator.catalog(context, "Review TypeScript", false, 8000);
  const skill = catalog.find(item => item.path.endsWith("team/frontend/review/SKILL.md"));
  assert.ok(skill);
  assert.equal(skill.description, "Review TypeScript code");
  assert.equal(JSON.stringify(catalog).includes("NESTED_SKILL_STEPS"), false);
  const selected = await h.coordinator.resolve(context, "RetryPolicy", undefined, false, { queries: ["RetryPolicy"], documentIds: [skill.id] });
  assert.equal(selected.length, 2);
  assert.match(selected[1].text, /NESTED_REFERENCE_BODY/);
  await h.coordinator.validate(selected, h.coordinator.revision);
  assert.deepEqual(h.coordinator.sources()[0].selectedPaths, []);
  assert.deepEqual(await h.coordinator.resolve(context, "RetryPolicy"), [], "a one-request Skill never stays applied");
});

test("private nested Skill metadata is withheld from cloud catalogs", async t => {
  const h = await setup(t), skillRoot = path.join(h.root, "team", "review");
  await fs.mkdir(skillRoot, { recursive: true });
  await fs.writeFile(path.join(skillRoot, "SKILL.md"), "---\nname: review\ndescription: PRIVATE_SKILL_DESCRIPTION\n---\nPRIVATE_SKILL_STEPS");
  assert.deepEqual(await h.coordinator.catalog(context, "review", false, 8000), []);
  assert.ok((await h.coordinator.catalog(context, "review", true, 8000)).some(item => item.description === "PRIVATE_SKILL_DESCRIPTION"));
});

test("disabling or removing a source stops selection and disposes watchers", async t => {
  const h = await setup(t); h.coordinator.initialize();
  const selected = await h.coordinator.resolve(context, "TypeScript"), revision = h.coordinator.revision;
  await h.coordinator.setEnabled("source", false);
  assert.equal(disposed, 1);
  assert.deepEqual(await h.coordinator.resolve(context, "TypeScript"), []);
  await assert.rejects(h.coordinator.validate(selected, revision), /更新/);
  await h.coordinator.remove("source");
  assert.equal(h.coordinator.view().sources.length, 0);
});

test("an in-flight scan cannot restore a disabled source", async t => {
  const h = await setup(t);
  const initial = h.coordinator.refresh();
  await h.coordinator.setEnabled("source", false);
  await initial;
  assert.equal(h.coordinator.view().sources[0].documentCount, 0);
  assert.equal(h.coordinator.view().sources[0].status, "disabled");
});

test("revoking a source also restricts prior and derived answers that carry its provenance", async t => {
  const h = await setup(t, false);
  const entries: ConversationEntry[] = [{ id: "answer", role: "assistant", text: "DERIVED_DATA", createdAt: "2026-11-10", kind: "manual", transmissionClass: "cloudAllowed",
    requestPlan: { kind: "manual", referenceSourceIds: ["source"], categories: [], targetFiles: [], excludedGlobs: [], estimatedSizeText: "" } }];
  assert.equal(h.coordinator.protectHistory(entries)[0].transmissionClass, "cloudAllowed");
  assert.equal(h.coordinator.canReuseReferenceSources(["source"]), true);
  assert.equal(h.coordinator.canReuseReferenceSources(["unknown"]), false);
  await h.coordinator.setEnabled("source", false);
  assert.equal(h.coordinator.canReuseReferenceSources(["source"]), false);
  assert.equal(h.coordinator.protectHistory(entries)[0].transmissionClass, "localOnly");
  assert.equal(h.coordinator.protectHistory(entries)[0].requestPlan?.referenceLocalOnly, true);
  await h.coordinator.remove("source");
  assert.equal(h.coordinator.protectHistory(entries)[0].transmissionClass, "localOnly");
  assert.equal(h.coordinator.protectHistory([{ ...entries[0], transmissionClass: "excluded" }])[0].transmissionClass, "excluded");
});

test("sending re-hashes only the selected files instead of rescanning every registered document", async t => {
  const h = await setup(t);
  await fs.writeFile(path.join(h.root, "other.md"), "# Other\nunrelated");
  const internals = h.coordinator as unknown as { service: { scan: (...args: unknown[]) => Promise<unknown> }; lastScanAt: number };
  const originalScan = internals.service.scan.bind(internals.service);
  let scans = 0;
  internals.service.scan = async (...args: unknown[]) => { scans++; return originalScan(...args); };
  const selected = await h.coordinator.resolve(context, "TypeScript", undefined, true), revision = h.coordinator.revision;
  assert.equal(scans, 1);
  assert.deepEqual(selected.map(item => item.path), ["docs/guide.md"]);
  await h.coordinator.resolve(context, "TypeScript", undefined, true);
  await h.coordinator.validate(selected, revision);
  assert.equal(scans, 1, "fresh resolves within the interval and validation reuse the catalog");
  await fs.writeFile(path.join(h.root, "other.md"), "# Other\nchanged without a watcher event");
  await h.coordinator.validate(selected, revision);
  assert.equal(scans, 1, "unsent documents are not read before sending");
  internals.lastScanAt = 0;
  await h.coordinator.resolve(context, "TypeScript", undefined, true);
  assert.equal(scans, 2, "a stale catalog is rescanned to catch missed watcher events");
  const current = await h.coordinator.resolve(context, "TypeScript"), currentRevision = h.coordinator.revision;
  await fs.writeFile(path.join(h.root, "guide.md"), "# TypeScript\nEDITED");
  await assert.rejects(h.coordinator.validate(current, currentRevision), (error: Error) => error.name === "ReferenceContextError" && /更新/.test(error.message));
  assert.match((await h.coordinator.resolve(context, "TypeScript"))[0].text, /EDITED/);
});

test("validation rejects excerpts whose source permission changed since selection", async t => {
  const h = await setup(t, false);
  const selected = await h.coordinator.resolve(context, "TypeScript"), revision = h.coordinator.revision;
  const sources = h.data.get("aiPairNavigator.referenceSources.v1") as ContextSource[];
  // Simulate another writer: the in-memory registry is the authority used at send time.
  const registry = (h.coordinator as unknown as { registry: { update(change: (items: ContextSource[]) => ContextSource[]): Promise<void> } }).registry;
  await registry.update(items => items.map(item => ({ ...item, localOnly: true })));
  assert.equal(sources.length, 1);
  await assert.rejects(h.coordinator.validate(selected, revision), /更新/);
});
