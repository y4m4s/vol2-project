# Pairwise evaluation

Baseline: eval/results/reference-transfer-off

Candidate: eval/results/reference-transfer-production

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.438; case bootstrap 95% CI [0.125, 0.813]; ties 1/8.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.00 | 2.25 | 0.25 |
| groundedness | 2.13 | 2.63 | 0.50 |
| context_utilization | 2.75 | 2.75 | 0.00 |
| hallucination | 2.63 | 2.88 | 0.25 |
| instruction_following | 3.00 | 2.88 | -0.13 |
| pedagogical_usefulness | 1.75 | 2.25 | 0.50 |
| actionability | 2.25 | 2.25 | 0.00 |
| conciseness | 3.38 | 3.13 | -0.25 |
| japanese_quality | 3.63 | 3.50 | -0.13 |

Hard pass: 0.875 → 0.875. Median latency: 8184 → 8437 ms. p95: 21720 → 11798 ms.

Gates: {"noNewHardFailures":false,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 8 pairs, win rate 0.4375. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- transfer-map-update #1: candidate win=1. Bはx:9,y:2を正しく説明。Aは形式不正。

- transfer-map-update #0: candidate win=0. Aは更新後の9を明示。Bは初期値に重心があり最終値を曖昧にする。

- transfer-shadowed #1: candidate win=0. Aは末尾の空白を創作し値を誤る。

- transfer-numeric #1: candidate win=1. Bは0,NaN,19を正しく区別。Aは二つ誤る。

- transfer-set-reinsert #1: candidate win=0.5. 双方最終結果を[1]と誤答。Bも正しい再追加説明を結果へ反映しない。

- transfer-set-reinsert #0: candidate win=0. Bの途中の並びは誤るが最終結果1,3は正しい。

- transfer-numeric #0: candidate win=1. Bは三つの値を正答。Aは空白をNaNと誤る。

- transfer-shadowed #0: candidate win=0. Aは不格好だが正しい値。Bは形式不正で届かない。
