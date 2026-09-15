import assert from "node:assert/strict";
import test from "node:test";
import { contextExcerpt } from "../src/services/ContextExcerpt";
import { buildGuidancePromptMessages } from "../src/services/PromptBuilder";
import { RequestPlanner } from "../src/services/RequestPlanner";
import type { GuidanceContext, NavigatorSettings } from "../src/shared/types";

test("bounded excerpts retain named middle evidence and both ends", () => {
  const text = "BEGIN\n" + "// filler\n".repeat(400) + "function calculateTax() { return 12; }\n" + "// filler\n".repeat(400) + "LATEST REQUIREMENT";
  const excerpt = contextExcerpt(text, 1800, "calculateTaxについて説明して");
  assert.ok(excerpt.length <= 1800);
  assert.ok(excerpt.startsWith("BEGIN"));
  assert.ok(excerpt.includes("function calculateTax() { return 12; }"));
  assert.ok(excerpt.endsWith("LATEST REQUIREMENT"));
  for (const size of [0, 30, 150, 500, 1000]) assert.ok(contextExcerpt(text, size).length <= size);
  assert.equal(contextExcerpt("short", 100), "short");
});

test("actual planner and prompt retain middle and tail code plus appended requirements", () => {
  const context: GuidanceContext = {
    activeFilePath: "main.ts", activeFileLanguage: "typescript",
    activeFileExcerpt: "// filler\n".repeat(250) + "function calculateTax() { return 12; }\n" + "// filler\n".repeat(200) + "const finished = true;",
    additionalContext: "old requirement\n" + "archived note\n".repeat(800) + "new requirement: 43 seconds",
    referencedFiles: [], diagnosticsSummary: [], recentEditsSummary: [], relatedSymbols: []
  };
  for (const providerId of ["lmStudio", "ollama"] as const) {
    const settings = {providerId, protectedExcludedGlobs: [], excludedGlobs: []} as unknown as NavigatorSettings;
    const planned = new RequestPlanner().prepareGuidanceRequest(context, {diagnosticsSummary: []}, settings, "manual", "low");
    const prompt = buildGuidancePromptMessages({context: planned.context, kind: "manual", userPrompt: "calculateTaxと末尾の最新要件を説明して"});
    assert.ok(prompt.userPrompt.includes("function calculateTax() { return 12; }"));
    assert.ok(prompt.userPrompt.includes("const finished = true;"));
    assert.ok(prompt.userPrompt.includes("new requirement: 43 seconds"));
    assert.ok(prompt.systemPrompt.length + prompt.userPrompt.length < 24000);
  }
});
