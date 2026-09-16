# Pairwise evaluation

Baseline: eval/results/r8-focused-reference

Candidate: eval/results/r9-keyword-hints

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.538; case bootstrap 95% CI [0.385, 0.692]; ties 8/13.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.54 | 2.92 | 0.38 |
| groundedness | 2.69 | 3.23 | 0.54 |
| context_utilization | 2.62 | 3.15 | 0.54 |
| hallucination | 3.46 | 3.54 | 0.08 |
| instruction_following | 2.92 | 3.15 | 0.23 |
| pedagogical_usefulness | 2.54 | 2.62 | 0.08 |
| actionability | 2.69 | 3.08 | 0.38 |
| conciseness | 3.54 | 3.38 | -0.15 |
| japanese_quality | 3.46 | 3.62 | 0.15 |

Hard pass: 0.8461538461538461 → 0.9230769230769231. Median latency: 7888 → 6299 ms. p95: 20179 → 29005 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 13 pairs, win rate 0.5384615384615384. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- bug-boundary #0: candidate win=1. Aは境界条件と添字範囲を示し、完成式を提示しない。

- related-file #0: candidate win=0. Bは直接説明のみ、Aは不要な検証を足す。

- explain-reduce #0: candidate win=0.5. 合計と初期値は両方正しい。

- learn-next #0: candidate win=1. Bは不適切な復習だが回答は届く。Aは形式不正。

- hint-only #0: candidate win=0. BはJSON形式をステータスで確認できるように示し誤誘導。双方主因を見逃す。

- auto-complete #0: candidate win=0.5. 双方適切な沈黙。

- long-active-tail #0: candidate win=0.5. 0は正しい。BのNumber型という表記はprimitiveとwrapperの区別が曖昧。

- long-additional-tail #0: candidate win=0.5. 両方17秒に正答。

- compare-approaches #0: candidate win=1. AはSet挿入順を正しく説明するが、filter+Setの計算量は誤る。

- history-absent #0: candidate win=0.5. どちらも比較案を求める。

- auto-layout #0: candidate win=0.5. 双方配置不一致を見逃す。

- additional-requirement #0: candidate win=0.5. 値と配置は両方正しい。

- uncertain-external #0: candidate win=0.5. 双方未提示のDB検索を前提にする。
