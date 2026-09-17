# Pairwise evaluation

Baseline: eval/results/m917-oll-production-baseline

Candidate: eval/results/m917-oll-production-candidate

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.000; problem bootstrap 95% CI [0.000, 0.000]; ties 0/2. Problem-balanced win rate: 0.000.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 3.00 | 1.50 | -1.50 |
| groundedness | 3.00 | 1.50 | -1.50 |
| context_utilization | 3.00 | 1.00 | -2.00 |
| hallucination | 3.50 | 2.00 | -1.50 |
| instruction_following | 3.00 | 0.50 | -2.50 |
| pedagogical_usefulness | 3.00 | 0.50 | -2.50 |
| actionability | 3.00 | 0.50 | -2.50 |
| conciseness | 3.50 | 1.00 | -2.50 |
| japanese_quality | 4.00 | 2.00 | -2.00 |

Hard pass: 1 → 0. Median latency: 33258 → 34990 ms. p95: 33757 → 37873 ms.

Gates: {"noNewHardFailures":false,"criticalAxes":false,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 2 pairs, win rate 0. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- alg-lower-bound-py #0: candidate win=0. Aは値を配信できるが説明は不十分。Bは形式修正後も未配信。両方ともタスク全体には不合格。

- alg-sort-correct-js #0: candidate win=0. Aだけが正しいコードへの自動介入を控える。
