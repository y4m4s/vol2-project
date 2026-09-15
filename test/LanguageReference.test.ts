import assert from "node:assert/strict";
import test from "node:test";
import { languageReference } from "../src/services/LanguageReference";
import { buildGuidancePromptMessages } from "../src/services/PromptBuilder";
import { deriveModelProfile } from "../src/services/ModelProfile";

test("reference selection is language scoped and excludes unrelated notes", () => {
  assert.equal(languageReference("python", "Set Number fetch"), "");
  assert.equal(languageReference(undefined, "Number(x)"), "");
  const note = languageReference("typescript", "Number(value)");
  assert.match(note, /数値変換:/);
  assert.doesNotMatch(note, /Set\/Map:|非同期:|配列:/);
  assert.match(note, /独自定義・上書き・別の型には当てはめない/);
  assert.ok(languageReference("javascript", "Number Set .length fetch").length < 1400);
  assert.equal(languageReference("typescript", 'const Number = value => "custom:" + value; Number("")'), "");
  assert.equal(languageReference("javascript", 'function convert(Number) { return Number(""); }'), "");
  assert.equal(languageReference("javascript", 'const fn = (Number) => Number("");'), "");
  assert.match(languageReference("javascript", 'const values = [Number(" "), Number("19px")];'), /数値変換:/);
});

test("reference facts agree with independent runtime examples", async () => {
  assert.equal(Number(" \t\n"), 0);
  assert.equal(Number(null), 0);
  assert.ok(Number.isNaN(Number(undefined)));
  assert.ok(Number.isNaN(Number("12px")));
  assert.equal(parseInt("12px", 10), 12);
  const values = new Set([7, 2, 7]); values.add(7);
  assert.deepEqual([...values], [7, 2]); values.delete(7); values.add(7);
  assert.deepEqual([...values], [2, 7]);
  const mapping = new Map([["b", 1], ["a", 2]]); mapping.set("b", 3);
  assert.deepEqual([...mapping.keys()], ["b", "a"]);
  const xs = [6, 8];
  assert.equal(xs[xs.length], undefined);
  assert.ok(Number.isNaN(6 + xs[xs.length]));
  assert.deepEqual([8, 3, 8, 1].filter((x, i, all) => all.indexOf(x) === i), [8, 3, 1]);
  assert.equal([].reduce((a: number, b: number) => a + b, 17), 17);
  assert.throws(() => ([] as number[]).reduce((a, b) => a + b), TypeError);
  const response = new Response('{"ok":true}');
  assert.ok(response.json() instanceof Promise);
});

test("local provider prompts include bounded reference notes; cloud prompts do not", () => {
  const context = {activeFileLanguage: "typescript", activeFileExcerpt: "Number(value)",
    referencedFiles: [], diagnosticsSummary: [], recentEditsSummary: [], relatedSymbols: []};
  for (const vendor of ["lmstudio", "ollama", "copilot", "openai"]) {
    const modelProfile = deriveModelProfile({vendor});
    const prompt = buildGuidancePromptMessages({context, kind: "manual", modelProfile});
    assert.equal(prompt.systemPrompt.includes("数値変換:"), vendor === "lmstudio" || vendor === "ollama");
    assert.ok(prompt.systemPrompt.length + prompt.userPrompt.length < modelProfile.contextBudget * 3);
  }
});
