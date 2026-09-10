import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGuidanceFormatRepairPrompt,
  guidanceResponseValidationOptions,
  userExplicitlyRequestedImplementationCode,
  validateGuidanceResponse
} from "../src/services/GuidanceResponsePolicy";

const repeatedAnswer = '「■」を5つ並べて表示させるためには、print("■" * 5)のように文字列を繰り返し表示する必要があります。';
const automaticInput = {
  kind: "always" as const,
  context: { activeFileExcerpt: 'print("■" * 5)', additionalContext: "■を横に5つ表示", referencedFiles: [],
    diagnosticsSummary: [], recentEditsSummary: [], relatedSymbols: [] }
};

test("再報告の既存コード再提案をモデルの生成に依存せず表示前に抑制する", () => {
  for (const code of ['print("■" * 5)', "print( '■' * 5 )"]) {
    for (const text of [repeatedAnswer, repeatedAnswer.replace("*", "\\*")]) {
      const result = validateGuidanceResponse(undefined, JSON.stringify({ kind: "advice", focus: "continue", text }),
        guidanceResponseValidationOptions({ ...automaticInput, context: { ...automaticInput.context, activeFileExcerpt: code } }));
      assert.deepEqual(result, { ok: true, outcome: "no_advice", text: "", focus: "none", normalized: false,
        suppressionReason: "existingCodeProposal" });
    }
  }
});

test("現在のコードと違う提案・コメント・文字列中の例・関数定義を既存の呼び出しと誤認しない", () => {
  for (const code of ['print("■")', 'print("■" * 4)', '# print("■" * 5)',
    '// print("■" * 5)', '/* print("■" * 5) */', `example = 'print("■" * 5)'`,
    'print("■ " * 5)']) {
    const result = validateGuidanceResponse(undefined, JSON.stringify({ kind: "advice", focus: "continue", text: repeatedAnswer }),
      guidanceResponseValidationOptions({ ...automaticInput, context: { ...automaticInput.context, activeFileExcerpt: code } }));
    assert.ok(result.ok && result.outcome === "advice", code);
  }
  const result = validateGuidanceResponse(undefined, JSON.stringify({ kind: "advice", focus: "continue", text: "render()のように呼び出してください。" }),
    guidanceResponseValidationOptions({ ...automaticInput, context: { ...automaticInput.context, activeFileExcerpt: "def render():\n    pass" } }));
  assert.ok(result.ok && result.outcome === "advice");
  const literalMarker = validateGuidanceResponse(undefined, JSON.stringify({ kind: "advice", focus: "continue", text: 'print("")のように表示してください。' }),
    guidanceResponseValidationOptions({ ...automaticInput, context: { ...automaticInput.context, activeFileExcerpt: 'print("<<<NAVICOM_CURSOR>>>")' } }));
  assert.ok(literalMarker.ok && literalMarker.outcome === "advice");
});

test("手動・解説・レビュー・明示的コード依頼と別の処理を含む提案は抑制しない", () => {
  for (const focus of ["explain", "review"] as const) {
    const result = validateGuidanceResponse(undefined, JSON.stringify({ kind: "advice", focus, text: repeatedAnswer }), guidanceResponseValidationOptions(automaticInput));
    assert.ok(result.ok && result.outcome === "advice");
  }
  for (const extra of [{ kind: "manual" as const }, { userPrompt: "コードを書いてください" },
    { context: { ...automaticInput.context, additionalContext: undefined } }]) {
    const options = guidanceResponseValidationOptions({ ...automaticInput, ...extra });
    const result = validateGuidanceResponse(undefined, JSON.stringify({ kind: "advice", text: repeatedAnswer,
      ...(options.kind === "always" ? { focus: "continue" } : {}) }), options);
    assert.ok(result.ok && result.outcome === "advice");
  }
  for (const text of [repeatedAnswer + "ただしエラーの場合は入力を確認します。",
    'print("■" * 5)のように表示し、save()を実行してください。', 'print("■" * 5)ではなく別の出力を考えましょう。',
    'print("■" * 5)を実行して結果を記録してください。']) {
    const result = validateGuidanceResponse(undefined, JSON.stringify({ kind: "advice", focus: "continue", text }), guidanceResponseValidationOptions(automaticInput));
    assert.ok(result.ok && result.outcome === "advice");
  }
});

test("過去の編集だけにあるコードは抑制根拠にせず、現在のカーソル周辺は根拠にする", () => {
  const current = { ...automaticInput, context: { ...automaticInput.context, activeFileExcerpt: 'print("■")',
    recentEditsSummary: ['変更前 print("■" * 5)'] } };
  const raw = JSON.stringify({ kind: "advice", focus: "continue", text: repeatedAnswer });
  const first = validateGuidanceResponse(undefined, raw, guidanceResponseValidationOptions(current));
  assert.ok(first.ok && first.outcome === "advice");
  const second = validateGuidanceResponse(undefined, raw, guidanceResponseValidationOptions({ ...current,
    automaticObservation: { triggerReasons: ["text_edit"], idleDurationMs: 10000, selectionPresent: true,
      cursorExcerpt: 'print("■" * 5<<<NAVICOM_CURSOR>>>)' } }));
  assert.ok(second.ok && second.outcome === "no_advice");
});

test("同じ呼び出しをもう一度行う必要がある助言は既存コードというだけで抑制しない", () => {
  for (const text of ['print("Hi")のように出力する行をもう一度書いてみてください。',
    'print("Hi")を追加してください。', 'print("Hi")のように2回表示してみてください。']) {
    const result = validateGuidanceResponse(undefined, JSON.stringify({ kind: "advice", focus: "continue", text }),
      guidanceResponseValidationOptions({ ...automaticInput, context: { ...automaticInput.context,
        activeFileExcerpt: 'print("Hi")', additionalContext: "Hiを2回表示する" } }));
    assert.ok(result.ok && result.outcome === "advice");
  }
});

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
  const response = JSON.stringify({ kind: "no_advice", focus: "none" });
  assert.deepEqual(validateGuidanceResponse(undefined, response, { kind: "always" }), {
    ok: true,
    outcome: "no_advice",
    focus: "none",
    text: "",
    normalized: false
  });
  assert.deepEqual(validateGuidanceResponse(undefined, response, { kind: "manual" }), {
    ok: false,
    reason: "invalidEnvelope"
  });
});

test("自動focusを厳密に検証し、手動への混入と不正な組み合わせを拒否する", () => {
  for (const focus of ["continue", "review", "explain", "overview"]) {
    const json = JSON.stringify({ kind: "advice", focus, text: "確認の観点です。" });
    const result = validateGuidanceResponse(undefined, json, { kind: "always" });
    assert.ok(result.ok);
    assert.equal(result.focus, focus);
    assert.equal(validateGuidanceResponse(undefined, json, { kind: "manual" }).ok, false);
  }
  for (const value of [
    { kind: "advice", text: "missing focus" },
    { kind: "advice", focus: "none", text: "bad" },
    { kind: "advice", focus: "unknown", text: "bad" },
    { kind: "advice", focus: "constructor", text: "bad" },
    { kind: "advice", focus: "continue", text: "" },
    { kind: "advice", focus: "continue", text: "text", extra: true },
    { kind: "no_advice", focus: "review" },
    { kind: "no_advice", focus: "none", text: "" }
  ]) assert.equal(validateGuidanceResponse(undefined, JSON.stringify(value), { kind: "always" }).ok, false);
  const repair = buildGuidanceFormatRepairPrompt("original", "invalidEnvelope", "always");
  assert.match(repair, /"focus":"none"/);
  assert.match(repair, /continue\|review\|explain\|overview/);
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
