import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGuidanceFormatRepairPrompt,
  validateGuidanceResponse
} from "../src/services/GuidanceResponsePolicy";

test("/flowの有効なMermaidブロックを受け入れる", () => {
  const text = "要点です。\n\n```mermaid\nflowchart TD\n  A[\"入力\"] --> B[\"出力\"]\n```";
  assert.deepEqual(validateGuidanceResponse("flow", text), { ok: true, text, normalized: false });
});

test("フェンスなしのflowchartだけなら安全にMermaidブロックへ補正する", () => {
  const text = "入力から出力へ流れます。\n\nflowchart TD\n  A[\"入力\"] --> B[\"出力\"]";
  assert.deepEqual(validateGuidanceResponse("flow", text), {
    ok: true,
    text: "入力から出力へ流れます。\n\n```mermaid\nflowchart TD\n  A[\"入力\"] --> B[\"出力\"]\n```",
    normalized: true
  });
});

test("Mermaid欠落・未閉鎖・複数ブロックを拒否する", () => {
  assert.deepEqual(validateGuidanceResponse("flow", "説明だけです"), {
    ok: false,
    reason: "missingMermaidBlock"
  });
  assert.deepEqual(validateGuidanceResponse("flow", "```mermaid\nflowchart TD\nA --> B"), {
    ok: false,
    reason: "unclosedMermaidBlock"
  });
  const twice = "```mermaid\nflowchart TD\nA --> B\n```\n```mermaid\nflowchart TD\nC --> D\n```";
  assert.deepEqual(validateGuidanceResponse("flow", twice), {
    ok: false,
    reason: "multipleMermaidBlocks"
  });
});

test("/flowでは別種の図と空のflowchartを拒否する", () => {
  assert.deepEqual(validateGuidanceResponse("flow", "```mermaid\nsequenceDiagram\nA->>B: test\n```"), {
    ok: false,
    reason: "wrongDiagramType"
  });
  assert.deepEqual(validateGuidanceResponse("flow", "```mermaid\nflowchart TD\n```"), {
    ok: false,
    reason: "emptyDiagram"
  });
});

test("/flow以外の応答には形式制約を適用しない", () => {
  assert.deepEqual(validateGuidanceResponse("hint", "説明だけです"), {
    ok: true,
    text: "説明だけです",
    normalized: false
  });
});

test("修正再生成プロンプトは元の文脈と完全なflowchart契約を保持する", () => {
  const prompt = buildGuidanceFormatRepairPrompt("original", "missingMermaidBlock");
  assert.match(prompt, /^original/);
  assert.match(prompt, /exactly one closed ```mermaid code block/);
  assert.match(prompt, /flowchart TD/);
  assert.match(prompt, /missingMermaidBlock/);
});
