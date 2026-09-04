import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGuidanceFormatRepairPrompt,
  userExplicitlyRequestedImplementationCode,
  validateGuidanceResponse
} from "../src/services/GuidanceResponsePolicy";

function advice(text: string): string {
  return JSON.stringify({ kind: "advice", text });
}

test("/flowの有効なMermaidブロックを受け入れる", () => {
  const text = "要点です。\n\n```mermaid\nflowchart TD\n  A[\"入力\"] --> B[\"出力\"]\n```";
  assert.deepEqual(validateGuidanceResponse("flow", advice(text)), {
    ok: true, outcome: "advice", text, normalized: false
  });
});

test("コード未依頼でも/flowのMermaidだけは許可する", () => {
  const text = "要点です。\n\n```mermaid\nflowchart TD\n  A[\"入力\"] --> B[\"出力\"]\n```";
  assert.equal(validateGuidanceResponse("flow", advice(text), {
    kind: "manual",
    allowImplementationCode: false
  }).ok, true);
});

test("フェンスなしのflowchartだけなら安全にMermaidブロックへ補正する", () => {
  const text = "入力から出力へ流れます。\n\nflowchart TD\n  A[\"入力\"] --> B[\"出力\"]";
  assert.deepEqual(validateGuidanceResponse("flow", advice(text)), {
    ok: true,
    outcome: "advice",
    text: "入力から出力へ流れます。\n\n```mermaid\nflowchart TD\n  A[\"入力\"] --> B[\"出力\"]\n```",
    normalized: true
  });
});

test("Mermaid欠落・未閉鎖・複数ブロックを拒否する", () => {
  assert.deepEqual(validateGuidanceResponse("flow", advice("説明だけです")), {
    ok: false,
    reason: "missingMermaidBlock"
  });
  assert.deepEqual(validateGuidanceResponse("flow", advice("```mermaid\nflowchart TD\nA --> B")), {
    ok: false,
    reason: "unclosedMermaidBlock"
  });
  const twice = "```mermaid\nflowchart TD\nA --> B\n```\n```mermaid\nflowchart TD\nC --> D\n```";
  assert.deepEqual(validateGuidanceResponse("flow", advice(twice)), {
    ok: false,
    reason: "multipleMermaidBlocks"
  });
});

test("/flowでは別種の図と空のflowchartを拒否する", () => {
  assert.deepEqual(validateGuidanceResponse("flow", advice("```mermaid\nsequenceDiagram\nA->>B: test\n```")), {
    ok: false,
    reason: "wrongDiagramType"
  });
  assert.deepEqual(validateGuidanceResponse("flow", advice("```mermaid\nflowchart TD\n```")), {
    ok: false,
    reason: "emptyDiagram"
  });
});

test("/flow以外でもJSON契約を検証する", () => {
  assert.deepEqual(validateGuidanceResponse("hint", advice("説明だけです")), {
    ok: true,
    outcome: "advice",
    text: "説明だけです",
    normalized: false
  });
});

test("修正再生成プロンプトは元の文脈と完全なflowchart契約を保持する", () => {
  const prompt = buildGuidanceFormatRepairPrompt("original", "missingMermaidBlock");
  assert.match(prompt, /^original/);
  assert.match(prompt, /exactly one closed ```mermaid block/);
  assert.match(prompt, /flowchart TD/);
  assert.match(prompt, /missingMermaidBlock/);
});

test("常時モードのno_adviceを正常結果として扱い、手動では拒否する", () => {
  const response = JSON.stringify({ kind: "no_advice" });
  assert.deepEqual(validateGuidanceResponse(undefined, response, { kind: "always" }), {
    ok: true,
    outcome: "no_advice",
    text: "",
    normalized: false
  });
  assert.deepEqual(validateGuidanceResponse(undefined, response, { kind: "manual" }), {
    ok: false,
    reason: "unexpectedNoAdvice"
  });
});

test("JSON外のテキストと未依頼の実装コードを拒否する", () => {
  assert.deepEqual(validateGuidanceResponse(undefined, "説明だけです"), {
    ok: false,
    reason: "invalidEnvelope"
  });
  assert.deepEqual(validateGuidanceResponse(undefined, advice("```ts\nconst x = 1;\n```"), {
    allowImplementationCode: false
  }), {
    ok: false,
    reason: "implementationCodeNotRequested"
  });
  assert.deepEqual(validateGuidanceResponse(undefined, advice("~~~ts\nconst x = 1;\n~~~"), {
    allowImplementationCode: false
  }), {
    ok: false,
    reason: "implementationCodeNotRequested"
  });
});

test("Mermaidは/flowだけで許可し、未閉鎖フェンスは拒否する", () => {
  const mermaid = "```mermaid\nflowchart TD\nA --> B\n```";
  assert.deepEqual(validateGuidanceResponse("hint", advice(mermaid), {
    allowImplementationCode: false
  }), {
    ok: false,
    reason: "implementationCodeNotRequested"
  });
  assert.deepEqual(validateGuidanceResponse("flow", advice("```mermaid\nflowchart TD\nA --> B"), {
    allowImplementationCode: false
  }), {
    ok: false,
    reason: "unclosedMermaidBlock"
  });
});

test("コードへの言及だけでは実装コード出力を許可しない", () => {
  assert.equal(userExplicitlyRequestedImplementationCode("このコードの問題点を教えて"), false);
  assert.equal(userExplicitlyRequestedImplementationCode("コードを修正して書いてください"), true);
  assert.equal(userExplicitlyRequestedImplementationCode("Please provide a code example"), true);
  assert.equal(userExplicitlyRequestedImplementationCode("Explain what this code does"), false);
});
