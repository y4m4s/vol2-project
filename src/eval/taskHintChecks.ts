import type { Check } from "./assertions";

// Scenario-specific quality checks, not a general semantic judge or runtime filter.
// Keep separate checks so a focus match cannot conceal an incorrect explanation.
export function taskHintChecks(vertical: boolean): Check[] {
  return [
    ...(vertical ? [
      check("describes current line breaks", text => /改行|縦|複数行|各行|5行|５行/.test(text)),
      check("contrasts output with horizontal requirement", text => /横|同じ行|同一行|1行|一行/.test(text)
        && !/要件を満たしています|要件を満たしている|修正は不要|変更は不要/.test(text)),
      check("points to the newline behavior", text => /改行|行末|末尾|end/.test(text)
        && /着目|確認|見直|考|扱|調整|抑制|なくす/.test(text))
    ] : []),
    check("does not impose an implementation method", text => {
      const compact = text.replace(/\s|`/g, "");
      return !/(?:複数(?:の)?print(?:文)?ではなく|print(?:文)?を(?:1つ|一つ|ひとつ)に(?:統合|まとめ)(?!る?必要は(?:ありません|ない))|(?:1回|一回|1つ|一つ)のprint.{0,35}(?:必要|してください|すべき)|(?:リスト|ループ|for文).{0,15}(?:必須|必要|使ってください|活用してください)|(?:行|print文).{0,20}(?:コピー|複製)|(?:コピー|複製).{0,20}(?:行|print))/.test(compact);
    }),
    check("does not supply a completed expression or argument", text => {
      const normalized = text.replace(/\\([*_])/g, "$1");
      return !/print\s*\(\s*[^)\s]|["'「]■["'」]\s*[*×]\s*5|end\s*=\s*(?:"[^"]*"|'[^']*')|range\s*\(\s*5\s*\)/.test(normalized);
    })
  ];
}

function check(name: string, predicate: (text: string) => boolean): Check {
  return { name, run: text => ({ passed: predicate(text) }) };
}
