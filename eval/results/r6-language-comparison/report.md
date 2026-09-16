# Pairwise evaluation

Baseline: eval/results/r5-hint-v3

Candidate: eval/results/r6-language-v4

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.538; case bootstrap 95% CI [0.385, 0.692]; ties 8/13.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.85 | 3.00 | 0.15 |
| groundedness | 3.15 | 3.00 | -0.15 |
| context_utilization | 3.23 | 3.08 | -0.15 |
| hallucination | 3.38 | 3.31 | -0.08 |
| instruction_following | 2.77 | 2.77 | 0.00 |
| pedagogical_usefulness | 2.54 | 2.62 | 0.08 |
| actionability | 2.85 | 2.92 | 0.08 |
| conciseness | 3.38 | 3.38 | 0.00 |
| japanese_quality | 3.62 | 3.77 | 0.15 |

Hard pass: 0.9230769230769231 → 0.8461538461538461. Median latency: 7658 → 7576 ms. p95: 19348 → 28948 ms.

Gates: {"noNewHardFailures":false,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 13 pairs, win rate 0.5384615384615384. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- compare-approaches #0: candidate win=0.5. BはindexOfの計算量理由を改善するが、Set順序は矛盾したまま。

- history-absent #0: candidate win=0.5. 双方とも比較材料を求める。

- learn-next #0: candidate win=1. Bは完成コードを示さず一つの練習だが、既習filterの復習に留まる。

- bug-boundary #0: candidate win=1. Bはundefined加算を説明できる。双方とも変更後の式を漏らす。

- uncertain-external #0: candidate win=0.5. AはSQLを新たに仮定。双方ともDB前提の誘導。

- related-file #0: candidate win=0. Aは300文字のhard上限超過。内容は両者正しい。

- long-additional-tail #0: candidate win=0.5. 両方17秒に正答。

- hint-only #0: candidate win=0. Bは未awaitのPromise上のjson呼び出しを成立するかのように説明。

- auto-complete #0: candidate win=0.5. 双方適切な沈黙。

- auto-layout #0: candidate win=0.5. 双方不一致を見逃す。

- additional-requirement #0: candidate win=0.5. 両方値と配置を正しく説明。

- long-active-tail #0: candidate win=1. AはNumber空文字が0であると正答。

- explain-reduce #0: candidate win=0.5. 両者とも合計と初期値を説明。
