import type { EvalScenario } from "./fixtures";
import { hasNoFencedCode, includes, maxBulletLines } from "./assertions";

const problem = 'Q001 横に並べる（繰り返し） 文字「■」を横に5つ並べて表示させてください。';

// Synthetic editor snapshots: never read a user's workspace in the live eval.
export const TASK_COMPLETION_SCENARIOS: EvalScenario[] = [
  { id: "single", code: 'print("■")', expected: "continue" },
  { id: "complete", code: 'print("■" * 5)', before: 'print("■")', expected: "none" },
  { id: "complete-repeat", code: 'print("■" * 5)', before: 'print("■")', expected: "none", previousFocus: "continue" },
  { id: "complete-insert-delta", code: 'print("■" * 5)', delta: " * 5", expected: "none" },
  { id: "complete-cursor-inside", code: 'print("■" * 5)', cursorCode: 'print(<<<NAVICOM_CURSOR>>>"■" * 5)', expected: "none" },
  { id: "complete-selection", code: 'print("■" * 5)', selected: '"■" * 5', expected: "none" },
  { id: "complete-next-line", code: 'print("■" * 5)\n', expected: "none" },
  { id: "complete-initial-read", code: 'print("■" * 5)', openOnly: true, expected: "none" },
  { id: "complete-initial-read-start", code: 'print("■" * 5)', cursorCode: '<<<NAVICOM_CURSOR>>>print("■" * 5)', openOnly: true, expected: "none" },
  { id: "complete-initial-read-next-line", code: 'print("■" * 5)\n', openOnly: true, expected: "none" },
  { id: "complete-initial-read-hello", code: 'print("Hello")', problem: "Helloを表示してください。", openOnly: true, expected: "none" },
  { id: "complete-initial-read-hello-reported", code: 'print("Hello")', problem: "Helloと表示するコードを書きなさい。", openOnly: true, expected: "none" },
  { id: "incomplete-initial-read", code: 'print("■")', openOnly: true, expected: "continue" },
  { id: "wrong-count", code: 'print("■" * 4)', expected: "continue" },
  { id: "vertical-five", code: Array(5).fill('print("■")').join('\n'), before: 'print("■")', previousFocus: "continue", expected: "continue" },
  { id: "vertical-five-initial", code: Array(5).fill('print("■")').join('\n'), openOnly: true, expected: "continue" },
  { id: "vertical-loop", code: 'for i in range(5):\n    print("■")', expected: "continue" },
  { id: "horizontal-five", code: Array(5).fill('print("■", end="")').join('\n'), expected: "none" },
  { id: "missing-output", code: 'squares = "■" * 5', expected: "continue" },
  { id: "complete-loop", code: 'for i in range(5):\n    print("■", end="")', expected: "none" },
  { id: "complete-high", code: 'print("■" * 5)', expected: "none", high: true },
  { id: "complete-other-task", code: 'print(2 + 3)', expected: "none", problem: "2と3の合計を表示させてください。" }
].map((sample) => ({
  id: `task-completion-${sample.id}`,
  description: `課題達成判定: ${sample.id}`,
  expectedFocus: [sample.expected as "continue" | "none"],
  input: {
    kind: "always",
    assistanceDepth: sample.high ? "high" : "low",
    context: {
      activeFilePath: "main.py", activeFileLanguage: "python", activeFileExcerpt: sample.selected ?? sample.code,
      selectedText: sample.selected,
      additionalContext: sample.problem ?? problem,
      referencedFiles: [], diagnosticsSummary: [], relatedSymbols: [],
      recentEditsSummary: sample.before ? [`L1: 変更前「${sample.before}」 -> 変更後「${sample.code}」`] : []
    },
    automaticObservation: {
      triggerReasons: [sample.openOnly ? "editor_change" : "text_edit"], idleDurationMs: 12000,
      cursor: { line: sample.code.split("\n").length,
        column: sample.cursorCode ? sample.cursorCode.indexOf("<<<NAVICOM_CURSOR>>>") + 1 : sample.code.split("\n").at(-1)!.length + 1 },
      cursorExcerpt: sample.cursorCode ?? sample.code + "<<<NAVICOM_CURSOR>>>", selectionPresent: Boolean(sample.selected),
      selectionLineCount: sample.selected ? 1 : undefined,
      previousFocus: sample.previousFocus as "continue" | undefined,
      lastEdit: sample.openOnly ? undefined : {
        lineStart: 1, lineEnd: sample.code.split("\n").length, cursorDistanceLines: 0,
        changedLineCount: sample.code.split("\n").length,
        insertedCharCount: (sample.delta ?? sample.code).length, deletedCharCount: sample.before?.length ?? 0,
        beforePreview: sample.before ?? "", afterPreview: sample.delta ?? sample.code
      },
      diagnostics: { added: [], resolvedCount: 0, remainingCount: 0 }
    }
  },
  promptChecks: [includes(sample.selected ?? sample.code), includes(sample.problem ?? problem)],
  responseChecks: [hasNoFencedCode(), maxBulletLines(3), ...(sample.id.startsWith("vertical") ? [{
    name: "identifies output layout rather than only counting symbols",
    run: (text: string) => ({ passed: /改行|縦|横|同じ行|同一行|1行|一行|end/.test(text)
      && !/要件を満たしています|要件を満たしている|要件を満たす[。です]|修正は不要|変更は不要/.test(text) })
  }] : []), ...(sample.expected === "continue" ? [{
    name: "hint does not prescribe duplicated lines or a completed expression",
    run: (text: string) => ({ passed: !/(?:行|print文).{0,20}(?:コピー|複製)|(?:コピー|複製).{0,20}(?:行|print)|print\s*\(\s*[^)\s]|["'「]■["'」]\s*\*\s*5/.test(text) })
  }] : [])]
}));
