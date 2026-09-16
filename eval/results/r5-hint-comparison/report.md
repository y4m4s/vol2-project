# Pairwise evaluation

Baseline: eval/results/r4-context-v2

Candidate: eval/results/r5-hint-v3

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.423; case bootstrap 95% CI [0.269, 0.577]; ties 9/13.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.85 | 2.85 | 0.00 |
| groundedness | 3.15 | 3.15 | 0.00 |
| context_utilization | 3.15 | 3.23 | 0.08 |
| hallucination | 3.38 | 3.38 | 0.00 |
| instruction_following | 3.00 | 2.77 | -0.23 |
| pedagogical_usefulness | 2.69 | 2.54 | -0.15 |
| actionability | 2.85 | 2.85 | 0.00 |
| conciseness | 3.46 | 3.38 | -0.08 |
| japanese_quality | 3.54 | 3.62 | 0.08 |

Hard pass: 0.9230769230769231 → 0.9230769230769231. Median latency: 6844 → 7658 ms. p95: 32844 → 19348 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 13 pairs, win rate 0.4230769230769231. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- bug-boundary #0: candidate win=0. Bは変更後の具体式を提示し、ヒント範囲を超える。

- explain-reduce #0: candidate win=0.5. ともに初期値と合計を説明。

- long-additional-tail #0: candidate win=0.5. 両方最新17秒に正答。

- uncertain-external #0: candidate win=0.5. 両方DB検索を前提とし、不足する定義を明示しない。

- long-active-tail #0: candidate win=0.5. 両方Number空文字をNaNと誤説明。

- related-file #0: candidate win=0. Bは必要な根拠に絞り、Aの不要なimport確認がない。

- hint-only #0: candidate win=0.5. キーワードのみのヒントは双方とも許容。

- additional-requirement #0: candidate win=0.5. 値と1行1個の形式は同じ。

- compare-approaches #0: candidate win=0.5. 両方Set順序の中心的誤答。Bは計算量の理由も不正確。

- learn-next #0: candidate win=0. Aは既習filterへの回帰と不要な実装断片。Bも一つの次課題には絞れていない。

- auto-layout #0: candidate win=0.5. 双方とも配置の違いを見逃す。

- auto-complete #0: candidate win=0.5. 両方適切な沈黙。

- history-absent #0: candidate win=1. Bは履歴不足を明示し比較案を求める。
