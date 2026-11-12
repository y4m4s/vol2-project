import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { pathToFileURL } from "node:url";
import { loadAgentSkill, parseReferenceFrontmatter } from "../src/services/AgentSkillLoader";
import { ReferenceDocumentService, REFERENCE_LIMITS, isInsideReferenceRoot } from "../src/services/ReferenceDocumentService";
import { resolveReferenceContext, chunkReferenceText, parseReferencePatterns } from "../src/services/ReferenceContextResolver";
import { ContextSourceRegistry } from "../src/services/ContextSourceRegistry";
import { isVerifiedReferenceLocalModel, splitReferencesForDestination, type ContextSource, type ReferenceDocument, type ReferenceExcerpt } from "../src/shared/referenceContext";
import type { GuidanceContext, NavigatorSettings } from "../src/shared/types";
import { RequestPlanner } from "../src/services/RequestPlanner";
import { reconcileRequestPlan } from "../src/services/RequestPlanTransmission";
import { buildGuidancePromptMessages, REFERENCE_PROMPT_BUDGET } from "../src/services/PromptBuilder";
import { createAutomaticFingerprint, hasMeaningfulContext } from "../src/application/GuidanceInput";
import { KnowledgeCoordinator } from "../src/application/coordinators/KnowledgeCoordinator";
import type { NavigatorSessionState } from "../src/shared/types";

const source = (patch: Partial<ContextSource> = {}): ContextSource => ({ id: "source", uri: "file:///reference", label: "資料", directory: true,
  kind: "document", scope: "workspace", enabled: true, localOnly: true, languages: [], appliesTo: [], selectedPaths: [], skillMode: "reference", ...patch });
const context = (patch: Partial<GuidanceContext> = {}): GuidanceContext => ({ referencedFiles: [], diagnosticsSummary: [], recentEditsSummary: [], relatedSymbols: [], ...patch });
const document = (patch: Partial<ReferenceDocument> = {}): ReferenceDocument => ({ id: "doc", sourceId: "source", relativePath: "guide.md", title: "ガイド", text: "TypeScriptの命名規約です。", hash: "v1", kind: "document", ...patch });
const excerpt = (patch: Partial<ReferenceExcerpt> = {}): ReferenceExcerpt => ({ id: "doc:1", sourceId: "source", path: "資料/guide.md", title: "ガイド", kind: "document", hash: "v1",
  text: "REFERENCE_MARKER", startLine: 1, endLine: 1, reason: "明示選択", localOnly: true, mode: "reference", ...patch });

async function fixture(t: TestContext) {
  const parent = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, "navicom-reference-"));
  assert.equal(path.dirname(path.resolve(root)), parent);
  t.after(async () => { assert.equal(path.dirname(path.resolve(root)), parent); await fs.rm(root, { recursive: true, force: true }); });
  return root;
}

test("reference pattern lists preserve brace alternatives instead of splitting valid globs", () => {
  const patterns = parseReferencePatterns(" src/**/*.{ts,tsx}, test/** ");
  assert.deepEqual(patterns, ["src/**/*.{ts,tsx}", "test/**"]);
  const rules = source({ kind: "rules", appliesTo: patterns });
  for (const file of ["src/app.ts", "src/ui/page.tsx", "test/main.py"]) {
    assert.equal(resolveReferenceContext([rules], [document()], context(), "", file).length, 1);
  }
  assert.equal(resolveReferenceContext([rules], [document()], context(), "", "src/main.py").length, 0);
  assert.throws(() => parseReferencePatterns("src/*.{ts,tsx"));
  assert.throws(() => parseReferencePatterns("x".repeat(201)));
});

test("long pinned documents cannot evict another explicitly selected Skill", () => {
  const docs = source({ selectedPaths: ["a.md"] }), skills = source({ id: "skills", kind: "skill", selectedPaths: ["SKILL.md"] });
  const long = document({ relativePath: "a.md", text: Array.from({ length: 10 }, (_, i) => `# Section ${i}\n${"content ".repeat(200)}`).join("\n") });
  const skill = document({ id: "skill", sourceId: "skills", relativePath: "SKILL.md", text: "Skill instructions", skill: { name: "guide", description: "Guide", resources: [] } });
  const selected = resolveReferenceContext([docs, skills], [long, skill], context(), "content", "");
  assert.ok(selected.some(doc => doc.kind === "skill")); assert.ok(selected.some(doc => doc.sourceId === "source"));
});

test("Skill references choose the relevant section and retain its actual line range", () => {
  const skills = source({ kind: "skill", selectedPaths: ["SKILL.md"] });
  const skill = document({ id: "skill", relativePath: "SKILL.md", text: "Instructions", skill: { name: "guide", description: "Guide", resources: ["references/guide.md"] } });
  const resource = document({ id: "resource", relativePath: "references/guide.md", text: `# Introduction\n${"background ".repeat(500)}\n# RetryPolicy\nRELEVANT_SECTION` });
  const selected = resolveReferenceContext([skills], [skill, resource], context(), "RetryPolicy", "");
  assert.match(selected[1].text, /RELEVANT_SECTION/);
  assert.ok(selected[1].startLine > 1); assert.equal(selected[1].id, `resource:${selected[1].startLine}`);
});

test("four-backtick code fences are not closed by embedded triple-backtick examples", () => {
  const text = ["````md", "```ts", "x".repeat(3000), "```", "# still in example", "````", "# Outside", "after"].join("\n");
  const chunks = chunkReferenceText(text);
  assert.ok(chunks[0].text.startsWith("````md")); assert.ok(chunks[0].text.endsWith("````"));
  assert.match(chunks[0].text, /# still in example/);
});

test("explicitly applied Skills are not evicted by the five search excerpt limit", () => {
  const skills = source({ selectedPaths: Array.from({ length: 7 }, (_, i) => `skill${i}/SKILL.md`) });
  const docs = skills.selectedPaths.map((relativePath, i) => document({ id: `skill${i}`, relativePath, text: `STEP_${i}`,
    kind: "skill", skill: { name: `skill${i}`, description: "Guide", resources: [] } }));
  const selected = resolveReferenceContext([skills], docs, context(), "unrelated", "");
  assert.equal(selected.length, 7);
  assert.ok(selected.every(item => item.required && item.kind === "skill" && item.mode === "procedure"));
});

test("always-include files retain the final condition and cannot be silently clipped", () => {
  const text = "# Task\n" + "details ".repeat(700) + "\nFINAL_REQUIREMENT";
  const selected = resolveReferenceContext([source({ alwaysInclude: true })], [document({ text })], context(), "unrelated", "");
  assert.equal(selected[0].text, text);
  assert.equal(selected[0].required, true);
  const input = { kind: "manual" as const, context: context({ referenceDocuments: selected }),
    modelProfile: { delimiter: "xml" as const, contextBudget: 16000, terse: false } };
  assert.match(buildGuidancePromptMessages(input).userPrompt, /FINAL_REQUIREMENT/);
  assert.throws(() => buildGuidancePromptMessages({ ...input, modelProfile: { ...input.modelProfile, contextBudget: 1000 } }), /入力予算/);
});

test("model-selected documents can be retrieved without becoming permanently pinned", () => {
  const doc = document({ text: "requested body" });
  const sources = [source()];
  assert.equal(resolveReferenceContext(sources, [doc], context(), "unrelated", "").length, 0);
  const selected = resolveReferenceContext(sources, [doc], context(), "unrelated", "", undefined, [doc.id]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].required, false);
  assert.match(selected[0].reason, /AI/);
  assert.deepEqual(sources[0].selectedPaths, []);
});

test("ordinary attachments detect Skills, read code, and do not scan Skill scripts", async t => {
  const root = await fixture(t), skillRoot = path.join(root, "test-skill");
  await fs.mkdir(path.join(skillRoot, "scripts"), { recursive: true });
  await fs.writeFile(path.join(skillRoot, "SKILL.md"), "---\nname: test-skill\ndescription: Test procedure\n---\nFollow these steps.");
  await fs.writeFile(path.join(skillRoot, "scripts", "run.py"), "SCRIPT_BODY");
  await fs.writeFile(path.join(root, "app.ts"), "const value = 1;");
  const registered = source({ uri: pathToFileURL(root).href });
  const result = await new ReferenceDocumentService().scan([registered]);
  assert.ok(result.documents.some(doc => doc.skill?.name === "test-skill" && doc.kind === "skill"));
  assert.ok(result.documents.some(doc => doc.relativePath === "app.ts"));
  assert.ok(result.documents.every(doc => !doc.text.includes("SCRIPT_BODY")));
});

test("directory attachments discover and search ordinary files through multiple nested directories", async t => {
  const root = await fixture(t), nested = path.join(root, "team", "frontend", "typescript");
  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(path.join(root, "top.md"), "Top level overview");
  await fs.writeFile(path.join(nested, "guide.md"), "# DeepRetryPolicy\nNESTED_REFERENCE_BODY");
  const registered = source({ uri: pathToFileURL(root).href });
  const result = await new ReferenceDocumentService().scan([registered]);
  assert.deepEqual(result.documents.map(doc => doc.relativePath), ["team/frontend/typescript/guide.md", "top.md"]);
  const selected = resolveReferenceContext([registered], result.documents, context(), "DeepRetryPolicy", "");
  assert.equal(selected.length, 1);
  assert.match(selected[0].path, /team\/frontend\/typescript\/guide\.md$/);
  assert.match(selected[0].text, /NESTED_REFERENCE_BODY/);
});

test("nested Skills can be chosen for one request without pinning every Skill in the directory", () => {
  const registered = source(), skill = document({ relativePath: "team/frontend/review/SKILL.md", text: "NESTED_SKILL_STEPS",
    kind: "skill", skill: { name: "review", description: "Review TypeScript", resources: [] } });
  assert.deepEqual(resolveReferenceContext([registered], [skill], context(), "Review TypeScript", ""), []);
  const selected = resolveReferenceContext([registered], [skill], context(), "Review TypeScript", "", undefined, [skill.id]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].text, "NESTED_SKILL_STEPS");
  assert.equal(selected[0].required, true);
  assert.match(selected[0].reason, /AI/);
  assert.deepEqual(registered.selectedPaths, []);
});

test("selected nested Skills recursively include linked reference directories", async t => {
  const root = await fixture(t), skillRoot = path.join(root, "team", "frontend", "review");
  const referenceRoot = path.join(skillRoot, "references", "languages", "typescript");
  await fs.mkdir(referenceRoot, { recursive: true });
  await fs.writeFile(path.join(skillRoot, "SKILL.md"), "---\nname: review\ndescription: Review TypeScript\n---\nRead [guides](references/).\n");
  await fs.writeFile(path.join(referenceRoot, "guide.md"), "# DeepRetryPolicy\nNESTED_SKILL_REFERENCE");
  const registered = source({ kind: "skill", uri: pathToFileURL(root).href, selectedPaths: ["team/frontend/review/SKILL.md"] });
  const result = await new ReferenceDocumentService().scan([registered]);
  const selected = resolveReferenceContext([registered], result.documents, context(), "DeepRetryPolicy", "");
  assert.equal(selected.length, 2);
  assert.match(selected[1].text, /NESTED_SKILL_REFERENCE/);
  assert.equal(selected[1].kind, "document");
  assert.match(selected[1].path, /references\/languages\/typescript\/guide.md$/);
  assert.equal(result.errors.get("source")?.length, 0);
});

test("Skills inside a grouping directory named references are still discovered", async t => {
  const root = await fixture(t), skillRoot = path.join(root, "references", "team", "review");
  await fs.mkdir(skillRoot, { recursive: true });
  await fs.writeFile(path.join(skillRoot, "SKILL.md"), "---\nname: review\ndescription: Review code\n---\nReview steps.");
  const result = await new ReferenceDocumentService().scan([source({ kind: "skill", uri: pathToFileURL(root).href })]);
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].relativePath, "references/team/review/SKILL.md");
});

test("direct SKILL.md attachments resolve linked nested rule directories", async t => {
  const root = await fixture(t), skillRoot = path.join(root, "review"), rules = path.join(skillRoot, "rules", "typescript", "async");
  await fs.mkdir(rules, { recursive: true });
  await fs.writeFile(path.join(skillRoot, "SKILL.md"), "---\nname: review\ndescription: Review code\n---\nRead [rules](rules/typescript/).\n");
  await fs.writeFile(path.join(rules, "retry.md"), "RetryPolicy NESTED_RULE_BODY");
  const registered = source({ kind: "skill", directory: false, uri: pathToFileURL(path.join(skillRoot, "SKILL.md")).href, selectedPaths: ["SKILL.md"] });
  const result = await new ReferenceDocumentService().scan([registered]);
  const selected = resolveReferenceContext([registered], result.documents, context(), "RetryPolicy", "");
  assert.equal(selected.length, 2);
  assert.match(selected[1].text, /NESTED_RULE_BODY/);
});

test("directory links rank all nested files before applying the excerpt limit", () => {
  const registered = source({ kind: "skill", selectedPaths: ["review/SKILL.md"] });
  const skill = document({ relativePath: "review/SKILL.md", skill: { name: "review", description: "Review", resources: ["references/"] } });
  const docs = Array.from({ length: 10 }, (_, index) => document({ id: `linked${index}`, relativePath: `review/references/a${index}.md`, text: "General notes" }));
  docs.push(document({ id: "best", relativePath: "review/references/typescript/z-retry.md", text: "RetryPolicy RELEVANT_NESTED_FILE" }));
  const selected = resolveReferenceContext([registered], [skill, ...docs], context(), "RetryPolicy", "");
  assert.equal(selected[1].id, "best:1");
  assert.ok(selected.length <= 9);
});

test("explicit deeply nested links cannot bypass the recursion depth limit", async t => {
  const root = await fixture(t), skillRoot = path.join(root, "review");
  const deepParts = ["references", ...Array.from({ length: REFERENCE_LIMITS.depth }, (_, index) => `d${index}`)];
  const deep = path.join(skillRoot, ...deepParts);
  await fs.mkdir(deep, { recursive: true });
  await fs.writeFile(path.join(skillRoot, "SKILL.md"), `---\nname: review\ndescription: Review\n---\n[deep](${deepParts.join("/")}/guide.md)`);
  await fs.writeFile(path.join(deep, "guide.md"), "TOO_DEEP");
  const result = await new ReferenceDocumentService().scan([source({ kind: "skill", directory: false,
    uri: pathToFileURL(path.join(skillRoot, "SKILL.md")).href, selectedPaths: ["SKILL.md"] })]);
  assert.deepEqual(result.documents.map(doc => doc.relativePath), ["SKILL.md"]);
  assert.match(result.errors.get("source")!.join(""), /深度/);
});

test("nested directory links preserve exclusions and never read scripts, assets or escaped paths", async t => {
  const root = await fixture(t), skillRoot = path.join(root, "review"), resources = path.join(skillRoot, "references");
  for (const dir of ["typescript", "private", "Scripts", "assets", "node_modules"]) await fs.mkdir(path.join(resources, dir), { recursive: true });
  await fs.writeFile(path.join(skillRoot, "SKILL.md"), "---\nname: review\ndescription: Review\n---\n[all](references/)\n[script](references/Scripts/run.py)\n[escaped](%2e%2e/outside.md)\n[external](https://example.com/guide.md)");
  for (const dir of ["typescript", "private", "Scripts", "assets", "node_modules"]) await fs.writeFile(path.join(resources, dir, "guide.md"), dir);
  const result = await new ReferenceDocumentService().scan([source({ kind: "skill", uri: pathToFileURL(skillRoot).href, selectedPaths: ["SKILL.md"] })], ["**/private/**"]);
  assert.deepEqual(result.documents.map(doc => doc.relativePath), ["references/typescript/guide.md", "SKILL.md"]);
  assert.match(result.errors.get("source")!.join(""), /範囲外/);
});

test("ordinary Markdown horizontal rules are readable even when they are not YAML frontmatter", async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "guide.md"), "---\n# Guide\nORDINARY_MARKDOWN");
  const result = await new ReferenceDocumentService().scan([source({ uri: pathToFileURL(root).href })]);
  assert.equal(result.documents.length, 1); assert.match(result.documents[0].text, /ORDINARY_MARKDOWN/);
  assert.match(result.errors.get("source")!.join(""), /本文のみ/);
});

test("explicit Skill links cannot traverse a junction even when its target remains inside the Skill", async t => {
  const root = await fixture(t), dir = path.join(root, "test-skill");
  await fs.mkdir(path.join(dir, "assets"), { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), "---\nname: test-skill\ndescription: Guide\n---\n[link](references/hidden.md)");
  await fs.writeFile(path.join(dir, "assets", "hidden.md"), "MUST_NOT_READ");
  await fs.symlink(path.join(dir, "assets"), path.join(dir, "references"), process.platform === "win32" ? "junction" : "dir");
  const result = await new ReferenceDocumentService().scan([source({ kind: "skill", uri: pathToFileURL(dir).href, selectedPaths: ["SKILL.md"] })]);
  assert.deepEqual(result.documents.map(doc => doc.relativePath), ["SKILL.md"]);
  assert.match(result.errors.get("source")!.join(""), /関連資料を読み込めません/);
});

test("Skills parse multiline YAML and retain resource paths without granting tools", () => {
  const skill = loadAgentSkill("---\nname: test-skill\ndescription: >\n  TypeScript guidance\n  for learners\nallowed-tools: Bash\nmetadata:\n  author: team\n---\n# Guide\nRead [guide](references/guide.md).", "test-skill");
  assert.match(skill.description, /TypeScript guidance for learners/);
  assert.deepEqual(skill.resources, ["references/guide.md"]);
  assert.match(skill.body, /# Guide/);
});

test("Skills reject malformed YAML, aliases, custom tags, invalid metadata and names", () => {
  for (const frontmatter of ["name: wrong\ndescription: ok", "name: test-skill\ndescription: [invalid]", "name: test-skill\ndescription: ok\nmetadata: { count: 2 }",
    "name: test-skill\ndescription: &a hi\nlicense: *a", "name: test-skill\ndescription: !unknown hi", "name: test-skill\ndescription: use: invalid"]) {
    assert.throws(() => loadAgentSkill(`---\n${frontmatter}\n---\nBody`, "test-skill"));
  }
  assert.throws(() => parseReferenceFrontmatter("---\nname: invalid\n---bad\nbody"));
});

test("rules use scope, ADRs filter obsolete decisions, documents require relevance, Skills require selection", () => {
  const rules = source({ kind: "rules", languages: ["typescript"], appliesTo: ["src/**"], workspaceRoot: "root-a" });
  assert.equal(resolveReferenceContext([rules], [document()], context({ activeFileLanguage: "typescript" }), "", "src/app.ts", "root-a").length, 1);
  assert.equal(resolveReferenceContext([rules], [document()], context({ activeFileLanguage: "python" }), "", "src/app.ts", "root-a").length, 0);
  assert.equal(resolveReferenceContext([rules], [document()], context({ activeFileLanguage: "typescript" }), "", "test/app.ts", "root-a").length, 0);
  assert.equal(resolveReferenceContext([rules], [document()], context({ activeFileLanguage: "typescript" }), "", "src/app.ts", "root-b").length, 0);
  assert.equal(resolveReferenceContext([source()], [document()], context(), "命名について", "").length, 1);
  assert.equal(resolveReferenceContext([source()], [document()], context(), "unrelated", "").length, 0);
  const adr = document({ status: "superseded" });
  assert.equal(resolveReferenceContext([source({ kind: "adr" })], [adr], context(), "TypeScript", "").length, 0);
  assert.equal(resolveReferenceContext([source({ kind: "adr" })], [adr], context(), "TypeScriptの過去の経緯", "").length, 1);
  const skill = document({ skill: { name: "guide", description: "TypeScript", resources: [] } });
  assert.equal(resolveReferenceContext([source({ kind: "skill" })], [skill], context(), "TypeScript", "").length, 0);
  assert.equal(resolveReferenceContext([source({ kind: "skill", selectedPaths: [skill.relativePath], skillMode: "procedure" })], [skill], context(), "", "")[0].mode, "procedure");
});

test("disabled and unselected Skills never leak their bundled documents through ordinary search", () => {
  assert.equal(resolveReferenceContext([source({ enabled: false, selectedPaths: ["guide.md"] })], [document()], context(), "TypeScript", "").length, 0);
  assert.equal(resolveReferenceContext([source({ kind: "skill", selectedPaths: ["guide.md"] })], [document()], context(), "TypeScript", "").length, 0);
});

test("scan excludes protected/custom paths, binary, invalid UTF8 and oversized files", async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, "node_modules")); await fs.mkdir(path.join(root, "private"));
  await Promise.all([
    fs.writeFile(path.join(root, "guide.md"), "# Public\n命名規約"), fs.writeFile(path.join(root, ".env.md"), "SECRET"),
    fs.writeFile(path.join(root, "node_modules", "guide.md"), "DEPENDENCY"), fs.writeFile(path.join(root, "private", "guide.md"), "PRIVATE"),
    fs.writeFile(path.join(root, "binary.txt"), Buffer.from([0, 1])), fs.writeFile(path.join(root, "bad.txt"), Buffer.from([255, 255])),
    fs.writeFile(path.join(root, "large.md"), "x".repeat(REFERENCE_LIMITS.fileBytes + 1))
  ]);
  const result = await new ReferenceDocumentService().scan([source({ uri: pathToFileURL(root).href })], ["**/private/**"]);
  assert.deepEqual(result.documents.map(doc => doc.relativePath), ["guide.md"]);
  assert.ok(result.errors.get("source")!.length >= 3);
});

test("scan handles file registration, content changes, deletion and disappearing roots", async t => {
  const root = await fixture(t), file = path.join(root, "guide.md");
  await fs.writeFile(file, "# One\nfirst");
  const service = new ReferenceDocumentService(), registered = source({ uri: pathToFileURL(file).href, directory: false });
  const first = await service.scan([registered]);
  await fs.writeFile(file, "# Two\nsecond");
  const second = await service.scan([registered]);
  assert.equal(first.documents[0].id, second.documents[0].id);
  assert.notEqual(first.documents[0].hash, second.documents[0].hash);
  await fs.unlink(file);
  const deleted = await service.scan([registered]);
  assert.equal(deleted.documents.length, 0); assert.ok(deleted.errors.get("source")!.length);
});

test("workspace-relative exclusions apply even when a nested directory is registered", async t => {
  const root = await fixture(t), docs = path.join(root, "docs");
  await fs.mkdir(path.join(docs, "internal"), { recursive: true });
  await fs.writeFile(path.join(docs, "internal", "guide.md"), "PRIVATE");
  await fs.writeFile(path.join(docs, "public.md"), "PUBLIC");
  const result = await new ReferenceDocumentService().scan([source({ uri: pathToFileURL(docs).href })], ["docs/internal/**"], [root]);
  assert.deepEqual(result.documents.map(doc => doc.relativePath), ["public.md"]);
});

test("scan does not follow junctions outside the registered root", async t => {
  const root = await fixture(t);
  const inner = path.join(root, "docs"), outside = path.join(root, "outside");
  await fs.mkdir(inner); await fs.mkdir(outside); await fs.writeFile(path.join(outside, "private.md"), "OUTSIDE");
  await fs.symlink(outside, path.join(inner, "link"), process.platform === "win32" ? "junction" : "dir");
  const result = await new ReferenceDocumentService().scan([source({ uri: pathToFileURL(inner).href })]);
  assert.equal(result.documents.length, 0); assert.match(result.errors.get("source")!.join(""), /リンク/);
  assert.equal(isInsideReferenceRoot(`${inner}-other`, inner), false);
});

test("Skills discover metadata first and load only selected explicit bundled references", async t => {
  const root = await fixture(t), dir = path.join(root, "test-skill");
  await fs.mkdir(path.join(dir, "references"), { recursive: true }); await fs.mkdir(path.join(dir, "scripts"));
  await fs.writeFile(path.join(dir, "SKILL.md"), "---\nname: test-skill\ndescription: TypeScript\n---\nRead [guide](references/guide.md).\n[bad](references/../../outside.md)");
  await fs.writeFile(path.join(dir, "references", "guide.md"), "# Reference\nRESOURCE_BODY");
  await fs.writeFile(path.join(dir, "scripts", "danger.md"), "DO_NOT_RUN");
  const service = new ReferenceDocumentService(), registered = source({ uri: pathToFileURL(dir).href, kind: "skill" });
  const unselected = await service.scan([registered]);
  assert.deepEqual(unselected.documents.map(doc => doc.relativePath), ["SKILL.md"]);
  const selected = await service.scan([{ ...registered, selectedPaths: ["SKILL.md"] }]);
  assert.equal(selected.documents.length, 2);
  const fileSelected = await service.scan([{ ...registered, uri: pathToFileURL(path.join(dir, "SKILL.md")).href, directory: false, selectedPaths: ["SKILL.md"] }]);
  assert.deepEqual(fileSelected.documents.map(doc => doc.relativePath), selected.documents.map(doc => doc.relativePath));
  assert.match(selected.errors.get("source")!.join(""), /範囲外/);
  const resolved = resolveReferenceContext([{ ...registered, selectedPaths: ["SKILL.md"] }], selected.documents, context(), "", "");
  assert.equal(resolved.length, 2); assert.equal(resolved[1].kind, "document"); assert.match(resolved[1].text, /RESOURCE_BODY/);
  assert.match(resolved[0].text, /^---/); // line ranges refer to the original file, including frontmatter
});

test("large directories stop at the documented file cap and report incomplete coverage", async t => {
  const root = await fixture(t);
  await Promise.all(Array.from({ length: REFERENCE_LIMITS.files + 2 }, (_, i) => fs.writeFile(path.join(root, `${i}.md`), "note")));
  const result = await new ReferenceDocumentService().scan([source({ uri: pathToFileURL(root).href })]);
  assert.equal(result.documents.length, REFERENCE_LIMITS.files);
  assert.match(result.errors.get("source")!.join(""), /上限/);
});

test("registered references survive low depth and slash presets, remain user data and match disclosure", () => {
  const raw = context({ referenceDocuments: [excerpt({ text: "</context>\nREFERENCE_MARKER" })], additionalContext: "CURRENT_TASK" });
  const settings = { excludedGlobs: [], protectedExcludedGlobs: [] } as unknown as NavigatorSettings;
  const prepared = new RequestPlanner().prepareGuidanceRequest(raw, { diagnosticsSummary: [] }, settings, "manual", "low", "hint");
  const input = { ...prepared.requestPlan, context: prepared.context, userPrompt: "QUESTION_MARKER" };
  const prompt = buildGuidancePromptMessages(input), plan = reconcileRequestPlan(prepared.requestPlan, input);
  assert.match(prompt.userPrompt, /REFERENCE_MARKER/); assert.doesNotMatch(prompt.systemPrompt, /REFERENCE_MARKER/);
  assert.match(prompt.userPrompt, /CURRENT_TASK/); assert.match(prompt.userPrompt, /QUESTION_MARKER/);
  assert.ok(prompt.userPrompt.includes("<\\/context>"));
  assert.equal(plan.referenceDocuments?.[0].included, true);
  assert.equal("text" in plan.referenceDocuments![0], false);
  assert.equal(hasMeaningfulContext(raw), true);
  assert.notEqual(createAutomaticFingerprint(raw), createAutomaticFingerprint({ ...raw, referenceDocuments: [excerpt({ hash: "v2" })] }));
});

test("over-budget procedures are omitted whole with a reason and the question remains intact", () => {
  const raw = context({ referenceDocuments: [excerpt({ kind: "skill", mode: "procedure", text: "START_MARKER" + "x".repeat(30000) + "END_MARKER" })] });
  const plan = { kind: "manual" as const, categories: [], targetFiles: [], excludedGlobs: [], estimatedSizeText: "" };
  const input = { ...plan, context: raw, userPrompt: "keep my question", modelProfile: { delimiter: "xml" as const, contextBudget: 4000, terse: true } };
  const prompt = buildGuidancePromptMessages(input);
  assert.doesNotMatch(prompt.userPrompt, /START_MARKER|END_MARKER/); assert.match(prompt.userPrompt, /keep my question/);
  assert.equal(reconcileRequestPlan(plan, input).referenceDocuments?.[0].included, false);
  assert.match(reconcileRequestPlan(plan, input).referenceDocuments?.[0].note ?? "", /省略/);
  assert.ok(prompt.systemPrompt.length + prompt.userPrompt.length < 12000);
});

test("chunking preserves code blocks and source line ranges", () => {
  const lines = ["# A", "a".repeat(600), "# B", "```ts", "x".repeat(3000), "```", "# C", "end"];
  for (const chunk of chunkReferenceText(lines.join("\n"))) assert.equal(chunk.text, lines.slice(chunk.start - 1, chunk.end).join("\n"));
  const code = chunkReferenceText(lines.join("\n")).find(chunk => chunk.text.includes("```ts"));
  assert.ok(code?.text.includes("```\n") || code?.text.endsWith("```"));
});

test("only loopback local providers qualify; provider names and remote endpoints do not", () => {
  assert.equal(isVerifiedReferenceLocalModel({ providerId: "lmStudio", modelId: "local", endpoint: "http://127.0.0.1:1234" }), true);
  for (const model of [{ providerId: "lmStudio", modelId: "local", endpoint: "https://remote.example" }, { providerId: "ollama", modelId: "test-cloud", endpoint: "http://localhost:11434" },
    { providerId: "copilot", modelId: "test", endpoint: "http://localhost" }]) assert.equal(isVerifiedReferenceLocalModel(model), false);
});

test("registry separates workspace/global state, validates persisted data and serializes changes", async () => {
  const create = () => { const data = new Map<string, unknown>(); return { data, get: <T>(key: string) => data.get(key) as T | undefined, update: async (key: string, value: unknown) => { data.set(key, value); }, keys: () => [...data.keys()] }; };
  const workspace = create(), global = create();
  const registry = new ContextSourceRegistry(workspace, global);
  await Promise.all([registry.update(items => [...items, source()]), registry.update(items => [...items, source({ id: "global", scope: "global" })])]);
  assert.equal(new ContextSourceRegistry(workspace, global).list().length, 2);
  const snapshot = registry.list(); snapshot[0].selectedPaths.push("injected"); assert.deepEqual(registry.list()[0].selectedPaths, []);
  workspace.data.set("aiPairNavigator.referenceSources.v1", [{ id: "malformed" }]);
  assert.deepEqual(new ContextSourceRegistry(workspace, global).list().map(item => item.id), ["global"]);
});

test("editing a combined workspace/global registry never drops sources beyond the add limit", async () => {
  const create = (scope: ContextSource["scope"]) => {
    const data = new Map<string, unknown>([["aiPairNavigator.referenceSources.v1", Array.from({ length: 12 }, (_, i) => source({ id: `${scope}-${i}`, scope }))]]);
    return { data, get: <T>(key: string) => data.get(key) as T | undefined, update: async (key: string, value: unknown) => { data.set(key, value); }, keys: () => [...data.keys()] };
  };
  const workspace = create("workspace"), global = create("global"), registry = new ContextSourceRegistry(workspace, global);
  assert.equal(registry.list().length, 24);
  await registry.update(items => items.map(item => item.id === "global-0" ? { ...item, enabled: false } : item));
  assert.equal(new ContextSourceRegistry(workspace, global).list().length, 24);
  assert.equal((global.data.get("aiPairNavigator.referenceSources.v1") as ContextSource[]).length, 12);
});

test("reference-local-only answers cannot enter global reusable knowledge", async () => {
  const state = { requestState: "idle", conversationHistory: [{ requestPlan: { referenceLocalOnly: true } }] } as unknown as NavigatorSessionState;
  let modelCalls = 0;
  const coordinator = new KnowledgeCoordinator({} as never, {} as never, {} as never, { createKnowledgeDraft: async () => { modelCalls++; } } as never, {
    getState: () => state, patchSession: patch => Object.assign(state, patch), getCurrentModelLabel: () => "local", getGuidanceContext: () => undefined
  });
  await coordinator.save();
  assert.equal(modelCalls, 0); assert.match(state.statusMessage?.text ?? "", /共通ナレッジへ保存できません/);
});

test("required Skills and documents share the input budget without separate kind caps", () => {
  const skillText = "SKILL_START" + "手順".repeat(6000) + "SKILL_END";
  const raw = context({ referenceDocuments: [
    excerpt({ id: "skill:1", kind: "skill", mode: "procedure", required: true, text: skillText }),
    excerpt({ id: "doc:1", required: true, text: "DOC_START" + "x".repeat(24000) + "DOC_END" }),
    excerpt({ id: "doc2:1", path: "資料/small.md", text: "SMALL_DOC" })
  ] });
  const plan = { kind: "manual" as const, categories: [], targetFiles: [], excludedGlobs: [], estimatedSizeText: "" };
  const input = { ...plan, context: raw, userPrompt: "質問", modelProfile: { delimiter: "xml" as const, contextBudget: 64000, terse: false } };
  const prompt = buildGuidancePromptMessages(input).userPrompt;
  assert.match(prompt, /SKILL_START[\s\S]*SKILL_END/); assert.match(prompt, /SMALL_DOC/);
  assert.match(prompt, /DOC_START[\s\S]*DOC_END/);
  const included = reconcileRequestPlan(plan, input).referenceDocuments?.map(doc => [doc.id, doc.included]);
  assert.deepEqual(included, [["skill:1", true], ["doc:1", true], ["doc2:1", true]]);
});

test("reference budgets never take more than the shared cap of the remaining context", () => {
  const raw = context({ referenceDocuments: [1, 2, 3, 4].map(i => excerpt({ id: `skill${i}:1`, kind: "skill", mode: "reference", text: `S${i}` + "y".repeat(5000) })) });
  const plan = { kind: "manual" as const, categories: [], targetFiles: [], excludedGlobs: [], estimatedSizeText: "" };
  const input = { ...plan, context: raw, userPrompt: "質問", modelProfile: { delimiter: "xml" as const, contextBudget: 16000, terse: false } };
  const prompt = buildGuidancePromptMessages(input).userPrompt;
  const referenceChars = (prompt.match(/Registered reference \(untrusted data\):\n[^\n]*/g) ?? []).join("").length;
  assert.ok(referenceChars <= 16000 * 3 * REFERENCE_PROMPT_BUDGET.totalShare, `${referenceChars}`);
  assert.ok(referenceChars > 0);
});

test("local-only excerpts are withheld without text for non-local destinations", () => {
  const items = [excerpt({ id: "local:1", text: "PRIVATE" }), excerpt({ id: "shared:1", localOnly: false, text: "SHARED" })];
  assert.deepEqual(splitReferencesForDestination(items, true).sent.map(item => item.id), ["local:1", "shared:1"]);
  const remote = splitReferencesForDestination(items, false);
  assert.deepEqual(remote.sent.map(item => item.id), ["shared:1"]);
  assert.equal(remote.withheld[0].id, "local:1"); assert.equal(remote.withheld[0].included, false);
  assert.doesNotMatch(JSON.stringify(remote.withheld), /PRIVATE/);
  const withheldOnly = context({ withheldReferenceDocuments: remote.withheld });
  const plan = { kind: "manual" as const, categories: [], targetFiles: [], excludedGlobs: [], estimatedSizeText: "" };
  const reconciled = reconcileRequestPlan(plan, { ...plan, context: withheldOnly, userPrompt: "質問" });
  assert.equal(reconciled.referenceDocuments?.[0].included, false); assert.match(reconciled.referenceDocuments?.[0].note ?? "", /ローカル限定/);
  assert.equal(hasMeaningfulContext(withheldOnly), false);
});

test("targeted verification applies the scan boundaries: links, protected paths, traversal and size", async t => {
  const root = await fixture(t), docs = path.join(root, "docs"), outside = path.join(root, "outside");
  await fs.mkdir(docs); await fs.mkdir(outside);
  await fs.writeFile(path.join(docs, "guide.md"), "GUIDE"); await fs.writeFile(path.join(docs, ".env.md"), "SECRET");
  await fs.writeFile(path.join(outside, "private.md"), "OUTSIDE");
  await fs.writeFile(path.join(docs, "big.md"), "x".repeat(REFERENCE_LIMITS.fileBytes + 1));
  await fs.symlink(outside, path.join(docs, "link"), process.platform === "win32" ? "junction" : "dir");
  const service = new ReferenceDocumentService(), registered = source({ uri: pathToFileURL(docs).href });
  const scanned = await service.scan([registered], ["**/.env*"]);
  const hashes = await service.verify(registered, ["guide.md", ".env.md", "link/private.md", "../outside/private.md", "big.md", "missing.md"], ["**/.env*"]);
  assert.equal(hashes.get("guide.md"), scanned.documents.find(doc => doc.relativePath === "guide.md")?.hash);
  for (const blocked of [".env.md", "link/private.md", "../outside/private.md", "big.md", "missing.md"]) assert.equal(hashes.get(blocked), undefined, blocked);
});
