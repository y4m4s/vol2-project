# Pairwise evaluation

Baseline: eval/results/sm-oll-file4

Candidate: eval/results/sm-oll-file8

Split: tuning; judge: Codex-manual

Win rate (ties=0.5): 0.556; case bootstrap 95% CI [0.500, 0.667]; ties 6/9.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 3.11 | 3.33 | 0.22 |
| groundedness | 3.33 | 3.33 | 0.00 |
| context_utilization | 3.67 | 3.67 | 0.00 |
| hallucination | 3.33 | 3.33 | 0.00 |
| instruction_following | 4.00 | 4.00 | 0.00 |
| pedagogical_usefulness | 3.11 | 3.33 | 0.22 |
| actionability | 3.56 | 3.67 | 0.11 |
| conciseness | 3.78 | 3.78 | 0.00 |
| japanese_quality | 3.78 | 4.00 | 0.22 |

Hard pass: 1 → 1. Median latency: 8613 → 9515 ms. p95: 19455 → 39063 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 9 pairs, win rate 0.5555555555555556. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- sm-explain #1: candidate win=0.5. A: filter→mapの説明はあるがoutputを[4]とし、16を落とす。 B: filter→mapの説明はあるがoutputを[4]とし、16を落とす。

- sm-additional #0: candidate win=0.5. A: 初回を含む3回と1500msを正しく説明。 B: 初回を含む3回と1500msを正しく説明。

- sm-additional #2: candidate win=1. A: 3回・1500msは正しいが75摘秒という誤記、冗長さ、不要な再確認がある。 B: 初回を含む3回と1500msを正しく説明。

- sm-format #0: candidate win=0. A: 文字列とゼロ埋めは正しいが同じ結論を繰り返す。 B: 4桁ゼロ埋めとSKU-0027を正しく説明。

- sm-explain #0: candidate win=0.5. A: filter→mapの説明はあるがoutputを[4]とし、16を落とす。 B: filter→mapの説明はあるがoutputを[4]とし、16を落とす。

- sm-additional #1: candidate win=0.5. A: 初回を含む3回と1500msを正しく説明。 B: 初回を含む3回と1500msを正しく説明。

- sm-format #2: candidate win=0.5. A: 4桁ゼロ埋めとSKU-0027を正しく説明。 B: 4桁ゼロ埋めとSKU-0027を正しく説明。

- sm-explain #2: candidate win=0.5. A: filter→mapの説明はあるがoutputを[4]とし、16を落とす。 B: filter→mapの説明はあるがoutputを[4]とし、16を落とす。

- sm-format #1: candidate win=1. A: SKU-0027は正しいがString(id)を数字への変換と誤説明。 B: 4桁ゼロ埋めとSKU-0027を正しく説明。
