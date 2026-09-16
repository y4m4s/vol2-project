// Curated specification notes, not answers to evaluation cases. No user code is executed.
// Sources and coverage limits: docs/language-reference.md.
export const LANGUAGE_REFERENCE_REVISION = "ecmascript-numeric-2026-09-15-v4";

const NOTES = [
  {
    match: /\b(?:Number|NaN|parseInt|parseFloat)\b/,
    text: "数値変換: 標準Numberは空文字・空白だけの文字列・nullを0、undefinedや数値として不正な文字列をNaNに変換する。NaNもtypeofはnumber。parseInt/parseFloatの部分解析とNumberの文字列全体の変換は別。"
  }
];

export function languageReference(language: string | undefined, code: string, question = ""): string {
  if (!/^(?:javascript|typescript|javascriptreact|typescriptreact)$/.test(language ?? "")) return "";
  // Conservatively suppress notes when a numeric builtin might be locally bound.
  // This is not scope analysis: false positives merely omit optional reference text.
  const builtin = "(?:Number|parseInt|parseFloat)";
  const binding = new RegExp(`(?:\\b(?:const|let|var|function|class)\\s+${builtin}\\b|\\bimport\\b[^;\\n]*\\b${builtin}\\b|\\b(?:const|let|var)\\s*[\\[{][^=;\\n]*\\b${builtin}\\b|\\b${builtin}\\s*=(?!=)|\\([^)]*\\b${builtin}\\b[^)]*\\)\\s*=>|\\bfunction\\b[^({]*\\([^)]*\\b${builtin}\\b)`, "m");
  if (binding.test(code)) return "";
  const relevant = NOTES.filter(note => note.match.test(code + "\n" + question));
  if (!relevant.length) return "";
  return [
    "## Language reference (" + LANGUAGE_REFERENCE_REVISION + ")",
    "以下は標準組み込みAPIの仕様メモ。独自定義・上書き・別の型には当てはめない。対象コードの事実と区別して必要な部分だけ使い、質問への回答範囲やヒントの制約を守る。",
    ...relevant.map(note => "- " + note.text)
  ].join("\n");
}
