# Pairwise evaluation

Baseline: eval/results/r4-baseline-v2

Candidate: eval/results/final-numeric-context

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.423; case bootstrap 95% CI [0.231, 0.615]; ties 7/13.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.62 | 2.69 | 0.08 |
| groundedness | 2.92 | 2.77 | -0.15 |
| context_utilization | 2.46 | 3.00 | 0.54 |
| hallucination | 3.23 | 3.08 | -0.15 |
| instruction_following | 2.69 | 2.69 | 0.00 |
| pedagogical_usefulness | 2.38 | 2.38 | 0.00 |
| actionability | 2.69 | 2.85 | 0.15 |
| conciseness | 3.46 | 3.08 | -0.38 |
| japanese_quality | 3.62 | 3.69 | 0.08 |

Hard pass: 0.9230769230769231 → 0.9230769230769231. Median latency: 6355 → 7129 ms. p95: 21156 → 19769 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 13 pairs, win rate 0.4230769230769231. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- additional-requirement #0: candidate win=0.5. 値と1行1個の形式は両方正しい。

- long-additional-tail #0: candidate win=1. Bは末尾の17秒を回答。

- compare-approaches #0: candidate win=0.5. 双方Set順序を誤答。

- history-absent #0: candidate win=0. Aは比較案をtrue/falseへ勝手に狭める。

- learn-next #0: candidate win=0. 双方既習filterだがBは不要なログ実装例と説明が増える。

- auto-complete #0: candidate win=0.5. 双方同じ自動判定。

- auto-layout #0: candidate win=0.5. 双方同じ配置見逃し。

- hint-only #0: candidate win=0.5. 両方awaitの適切なキーワードヒント。

- bug-boundary #0: candidate win=0. Aは実際と逆の条件を推測し置換式も提示。

- uncertain-external #0: candidate win=0.5. 双方DB内部を前提にする。

- explain-reduce #0: candidate win=0.5. 合計と初期値は正しい。

- related-file #0: candidate win=0. Bは<=をstrict equalityと誤説明。

- long-active-tail #0: candidate win=1. Aはnumberと0に正答するがNumberコントローラーという誤用語がある。
