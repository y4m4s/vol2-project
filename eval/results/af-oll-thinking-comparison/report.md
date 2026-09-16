# Pairwise evaluation

Baseline: eval/results/af-oll-thinking-pilot-baseline

Candidate: eval/results/af-oll-thinking-pilot-candidate

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.625; problem bootstrap 95% CI [0.500, 1.000]; ties 3/4. Problem-balanced win rate: 0.667.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 3.75 | 3.75 | 0.00 |
| groundedness | 3.75 | 3.75 | 0.00 |
| context_utilization | 4.00 | 3.75 | -0.25 |
| hallucination | 4.00 | 3.75 | -0.25 |
| instruction_following | 2.50 | 3.25 | 0.75 |
| pedagogical_usefulness | 3.00 | 3.25 | 0.25 |
| actionability | 3.75 | 3.75 | 0.00 |
| conciseness | 4.00 | 3.50 | -0.50 |
| japanese_quality | 4.00 | 4.00 | 0.00 |

Hard pass: 1 → 1. Median latency: 10616 → 37403 ms. p95: 17611 → 72785 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":true,"qualityCI":false,"latency":false}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 4 pairs, win rate 0.625. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- alg-pair-bug-js #0: candidate win=1. Aは例の実際の動きを追えているが終了説明に誤り。Bは例の原因説明が不足し具体的な修正も提示。両方未達。

- alg-lower-bound-py #0: candidate win=0.5. 両方とも重複時の探索と戻り値を満たす。

- alg-sum-correct-py #0: candidate win=0.5. どちらも不要な介入なし。

- alg-sum-bug-js #0: candidate win=0.5. 原因は両方正しいが、同じ解答開示でヒント制約未達。
