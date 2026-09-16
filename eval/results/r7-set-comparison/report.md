# Pairwise evaluation

Baseline: eval/results/r6-language-v4

Candidate: eval/results/r7-set-reference

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.500; case bootstrap 95% CI [0.346, 0.654]; ties 9/13.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 3.00 | 3.08 | 0.08 |
| groundedness | 3.00 | 3.08 | 0.08 |
| context_utilization | 3.08 | 3.31 | 0.23 |
| hallucination | 3.31 | 3.38 | 0.08 |
| instruction_following | 2.77 | 2.92 | 0.15 |
| pedagogical_usefulness | 2.62 | 2.69 | 0.08 |
| actionability | 2.92 | 3.15 | 0.23 |
| conciseness | 3.38 | 3.31 | -0.08 |
| japanese_quality | 3.77 | 3.92 | 0.15 |

Hard pass: 0.8461538461538461 → 0.9230769230769231. Median latency: 7576 → 8633 ms. p95: 28948 → 22189 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 13 pairs, win rate 0.5. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- history-absent #0: candidate win=0.5. 両方比較案を要求。Aのenabled説明は余分。

- uncertain-external #0: candidate win=1. Aは定義確認とDB以外の可能性にも触れる。

- hint-only #0: candidate win=0.5. どちらもPromise上のjson呼び出しを誤って説明。

- auto-complete #0: candidate win=0.5. 双方適切な沈黙。

- related-file #0: candidate win=0.5. Aは長さ超過、Bは未提示のL3を創作。双方に問題。

- compare-approaches #0: candidate win=1. Bは挿入順を正しく説明しindexOfの二乗コストも説明。

- explain-reduce #0: candidate win=0.5. 初期値は両者正しい。

- additional-requirement #0: candidate win=0.5. 値と形式は両者正しい。

- auto-layout #0: candidate win=0.5. 双方とも配置不一致を見逃す。

- bug-boundary #0: candidate win=0. Aは文字列加算までNaNと誤一般化。両者とも置換式を漏らす。

- learn-next #0: candidate win=0. Aは既習事項の再確認と具体コード。Bも新しい事項はないが一つの練習。

- long-active-tail #0: candidate win=0.5. 型と空文字0は双方正しい。

- long-additional-tail #0: candidate win=0.5. 両方17秒。
