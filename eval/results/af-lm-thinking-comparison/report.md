# Pairwise evaluation

Baseline: eval/results/af-lm-thinking-pilot-baseline

Candidate: eval/results/af-lm-thinking-pilot-candidate

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.625; problem bootstrap 95% CI [0.000, 1.000]; ties 1/4. Problem-balanced win rate: 0.583.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.50 | 3.00 | 0.50 |
| groundedness | 2.50 | 3.00 | 0.50 |
| context_utilization | 3.25 | 3.00 | -0.25 |
| hallucination | 2.50 | 3.00 | 0.50 |
| instruction_following | 3.25 | 2.25 | -1.00 |
| pedagogical_usefulness | 2.50 | 2.50 | 0.00 |
| actionability | 3.25 | 3.00 | -0.25 |
| conciseness | 3.50 | 3.00 | -0.50 |
| japanese_quality | 4.00 | 3.00 | -1.00 |

Hard pass: 1 → 0.75. Median latency: 6649 → 43235 ms. p95: 20900 → 120049 ms.

Gates: {"noNewHardFailures":false,"criticalAxes":false,"qualityCI":false,"latency":false}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 3 pairs, win rate 0.8333333333333334. 1 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- alg-sum-bug-js #0: candidate win=1. 両方解答開示があるが、Aは誤った範囲外診断を含まない。

- alg-sum-correct-py #0: candidate win=0.5. どちらも不要な介入なし。

- alg-pair-bug-js #0: candidate win=0. Aにも誤答はあるが一部の動作情報が届く。Bは未配信。

- alg-lower-bound-py #0: candidate win=1. Bだけが重複時の探索方向を正答。
