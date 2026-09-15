# Pairwise evaluation

Baseline: eval/results/r4-baseline-v2

Candidate: eval/results/champion-context-numeric

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.538; case bootstrap 95% CI [0.423, 0.654]; ties 10/13.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.62 | 2.85 | 0.23 |
| groundedness | 2.92 | 3.08 | 0.15 |
| context_utilization | 2.46 | 2.77 | 0.31 |
| hallucination | 3.23 | 3.46 | 0.23 |
| instruction_following | 2.69 | 3.00 | 0.31 |
| pedagogical_usefulness | 2.38 | 2.54 | 0.15 |
| actionability | 2.69 | 2.92 | 0.23 |
| conciseness | 3.46 | 3.46 | 0.00 |
| japanese_quality | 3.62 | 3.77 | 0.15 |

Hard pass: 0.9230769230769231 → 0.9230769230769231. Median latency: 6355 → 7291 ms. p95: 21156 → 25552 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 13 pairs, win rate 0.5384615384615384. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- auto-layout #0: candidate win=0.5. 双方配置不一致を見逃す。

- hint-only #0: candidate win=0. Aは主因のPromiseとawaitを示す。Bは成功確認へ逸れる。

- additional-requirement #0: candidate win=0.5. 出力値と改行は同じ。

- uncertain-external #0: candidate win=0.5. 双方DB内部を前提とする。

- learn-next #0: candidate win=0.5. 双方既習filterの復習に留まる。

- explain-reduce #0: candidate win=0.5. 同じ回答。

- related-file #0: candidate win=0.5. 両方真偽と定義を正しく説明。

- bug-boundary #0: candidate win=0.5. Bは条件式に触れるがundefined/nullの仮定へ逸れ、双方主因の因果を説明しない。

- long-additional-tail #0: candidate win=1. 末尾の17秒を正答。

- compare-approaches #0: candidate win=0.5. 両方Set順序の誤答。

- long-active-tail #0: candidate win=1. 型numberと空文字0に正答。

- auto-complete #0: candidate win=0.5. 双方適切な沈黙。

- history-absent #0: candidate win=0.5. 双方比較材料を求めるがenabledの説明が余分。
