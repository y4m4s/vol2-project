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
const loader = Module as unknown as { _load(id: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
const fileUri = (file: string) => ({ scheme: "file", fsPath: file, toString: () => pathToFileURL(file).href });
loader._load = (id, parent, isMain) => id === "vscode" ? {
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

test("uppercase documents invalidate previews while ordinary source-file edits do not", async t => {
  const h = await setup(t); h.coordinator.initialize();
  await h.coordinator.resolve(context, "TypeScript");
  const revision = h.coordinator.revision;
  events[0]({ fsPath: path.join(h.root, "code.ts") });
  assert.equal(h.coordinator.revision, revision);
  events[0]({ fsPath: path.join(h.root, "GUIDE.MD") });
  assert.ok(h.coordinator.revision > revision);
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
