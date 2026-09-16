# Pairwise evaluation

Baseline: eval/results/r4-baseline-v2

Candidate: eval/results/r9-keyword-hints

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.577; case bootstrap 95% CI [0.385, 0.769]; ties 5/13.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.62 | 2.92 | 0.31 |
| groundedness | 2.92 | 3.23 | 0.31 |
| context_utilization | 2.46 | 3.15 | 0.69 |
| hallucination | 3.23 | 3.54 | 0.31 |
| instruction_following | 2.69 | 3.15 | 0.46 |
| pedagogical_usefulness | 2.38 | 2.62 | 0.23 |
| actionability | 2.69 | 3.08 | 0.38 |
| conciseness | 3.46 | 3.38 | -0.08 |
| japanese_quality | 3.62 | 3.62 | 0.00 |

Hard pass: 0.9230769230769231 → 0.9230769230769231. Median latency: 6355 → 6299 ms. p95: 21156 → 29005 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 13 pairs, win rate 0.5769230769230769. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- bug-boundary #0: candidate win=1. Bは境界条件を特定し、Aの入力型の推測より有用。

- long-additional-tail #0: candidate win=1. 末尾の最新仕様が届き17秒に回答できた。

- learn-next #0: candidate win=0. 双方新事項なしだがAのpractice混在とログ実装例が余分。

- additional-requirement #0: candidate win=0.5. 値と改行の説明は同じ。

- long-active-tail #0: candidate win=1. Bは定義を参照し0と正答。Aは欠落した定義を推測。

- auto-complete #0: candidate win=0.5. 同じ自動判定結果。

- auto-layout #0: candidate win=0.5. 同じ自動判定結果。

- compare-approaches #0: candidate win=1. AはSet順序を改善するがfilter+Setの計算量は誤る。

- hint-only #0: candidate win=0. Bは許容されるawaitヒントで主因を示す。AはJSON形式とstatusを混同。

- history-absent #0: candidate win=1. Aは比較案を求める説明にまとまる。

- related-file #0: candidate win=0. Aは値と根拠に集中しBの余分な検証提案がない。

- explain-reduce #0: candidate win=0.5. 回答が同一。

- uncertain-external #0: candidate win=0.5. 双方未提示のDB検索を前提とする。
