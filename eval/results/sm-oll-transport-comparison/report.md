# Pairwise evaluation

Baseline: eval/results/sm-oll-file-openai

Candidate: eval/results/sm-oll-file4

Split: tuning; judge: Codex-manual

Win rate (ties=0.5): 0.444; case bootstrap 95% CI [0.333, 0.500]; ties 6/9.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 3.33 | 3.11 | -0.22 |
| groundedness | 3.33 | 3.33 | 0.00 |
| context_utilization | 3.67 | 3.67 | 0.00 |
| hallucination | 3.33 | 3.33 | 0.00 |
| instruction_following | 4.00 | 4.00 | 0.00 |
| pedagogical_usefulness | 3.33 | 3.11 | -0.22 |
| actionability | 3.56 | 3.56 | 0.00 |
| conciseness | 3.78 | 3.78 | 0.00 |
| japanese_quality | 4.00 | 3.78 | -0.22 |

Hard pass: 1 → 1. Median latency: 7805 → 8613 ms. p95: 28008 → 19455 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 9 pairs, win rate 0.4444444444444444. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- sm-format #1: candidate win=0. A: SKU-0027は正しいがString(id)を数字への変換と誤説明。 B: 文字列とゼロ埋めは正しいが同じ結論を繰り返す。

- sm-explain #0: candidate win=0.5. A: filter→mapの説明はあるがoutputを[4]とし、16を落とす。 B: filter→mapの説明はあるがoutputを[4]とし、16を落とす。

- sm-format #0: candidate win=0.5. A: 4桁ゼロ埋めとSKU-0027を正しく説明。 B: 4桁ゼロ埋めとSKU-0027を正しく説明。

- sm-explain #2: candidate win=0.5. A: filter→mapの説明はあるがoutputを[4]とし、16を落とす。 B: filter→mapの説明はあるがoutputを[4]とし、16を落とす。

- sm-format #2: candidate win=0.5. A: 4桁ゼロ埋めとSKU-0027を正しく説明。 B: 4桁ゼロ埋めとSKU-0027を正しく説明。

- sm-additional #1: candidate win=0.5. A: 初回を含む3回と1500msを正しく説明。 B: 初回を含む3回と1500msを正しく説明。

- sm-additional #0: candidate win=1. A: 3回・1500msは正しいが既知仕様を再確認させる文が余分。 B: 初回を含む3回と1500msを正しく説明。

- sm-additional #2: candidate win=0. A: 3回・1500msは正しいが75摘秒という誤記、冗長さ、不要な再確認がある。 B: 初回を含む3回と1500msを正しく説明。

- sm-explain #1: candidate win=0.5. A: filter→mapの説明はあるがoutputを[4]とし、16を落とす。 B: filter→mapの説明はあるがoutputを[4]とし、16を落とす。
