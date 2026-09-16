# Pairwise evaluation

Baseline: eval/results/baseline-ollama

Candidate: eval/results/ollama-native

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.538; case bootstrap 95% CI [0.385, 0.692]; ties 8/13.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.92 | 3.00 | 0.08 |
| groundedness | 3.08 | 3.08 | 0.00 |
| context_utilization | 2.92 | 3.08 | 0.15 |
| hallucination | 3.23 | 3.31 | 0.08 |
| instruction_following | 2.46 | 2.77 | 0.31 |
| pedagogical_usefulness | 2.46 | 2.54 | 0.08 |
| actionability | 2.69 | 2.92 | 0.23 |
| conciseness | 3.15 | 3.00 | -0.15 |
| japanese_quality | 3.77 | 3.77 | 0.00 |

Hard pass: 0.8461538461538461 → 0.8461538461538461. Median latency: 6521 → 10491 ms. p95: 24242 → 23516 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":true,"qualityCI":false,"latency":false}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

## Cases

- explain-reduce #0: candidate win=0.5. 同じく2文で合計と初期値を説明。

- long-active-tail #0: candidate win=0.5. 両方ともnumberと0に正答。

- learn-next #0: candidate win=1. Aはmapで名前を抽出するという具体的な練習を示す。

- auto-complete #0: candidate win=0.5. 両方とも正しい沈黙。

- uncertain-external #0: candidate win=0. Bは長いDB限定の確認を増やし、未確認のDB前提に依存する。

- additional-requirement #0: candidate win=0.5. 両方とも要求する値と形式を正答。

- related-file #0: candidate win=1. Aも反復はあるがBより短く両定義を明示する。

- bug-boundary #0: candidate win=1. Bは範囲外アクセスを矛盾なく説明するが、修正式の漏洩は続く。

- compare-approaches #0: candidate win=0.5. Aは比較を避け、BはSetの順序と記録方式の計算量を誤説明。両方不十分。

- hint-only #0: candidate win=0.5. どちらもawaitの答えを漏らす。

- auto-layout #0: candidate win=0.5. 同じ縦横の見逃し。

- long-additional-tail #0: candidate win=0.5. 両方とも最新値を誤答し形式も不適合。

- history-absent #0: candidate win=0. 両方が履歴を求めるがBはenabledの説明が長い。
