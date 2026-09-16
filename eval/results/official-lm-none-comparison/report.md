# Pairwise evaluation

Baseline: eval/results/official-reference-none

Candidate: eval/results/official-nonthinking-lmstudio-retry

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.600; case bootstrap 95% CI [0.500, 0.800]; ties 4/5.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 1.60 | 2.60 | 1.00 |
| groundedness | 1.80 | 2.80 | 1.00 |
| context_utilization | 2.00 | 2.80 | 0.80 |
| hallucination | 2.80 | 3.40 | 0.60 |
| instruction_following | 3.00 | 2.40 | -0.60 |
| pedagogical_usefulness | 1.20 | 2.00 | 0.80 |
| actionability | 1.60 | 2.20 | 0.60 |
| conciseness | 3.60 | 3.60 | 0.00 |
| japanese_quality | 3.60 | 3.60 | 0.00 |

Hard pass: 0.8 → 0.8. Median latency: 5476 → 6229 ms. p95: 8603 → 7147 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":false,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

## Cases

- compare-approaches #0: candidate win=0.5. 両方ともSetの挿入順を誤説明。

- auto-layout #0: candidate win=0.5. 両方とも縦横の見逃し。

- bug-boundary #0: candidate win=1. Aは配列範囲を超えるアクセスとundefinedの加算を正しく説明。

- explain-reduce #0: candidate win=0.5. 同じく合計と初期値を2文で説明。

- hint-only #0: candidate win=0.5. Bは正しいPromiseの話だがthen/awaitの答えを漏らし、Aは本質に届かないヒント。
