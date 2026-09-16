# Pairwise evaluation

Baseline: eval/results/r7-set-reference

Candidate: eval/results/r8-focused-reference

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.462; case bootstrap 95% CI [0.269, 0.654]; ties 6/13.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 3.08 | 2.54 | -0.54 |
| groundedness | 3.08 | 2.69 | -0.38 |
| context_utilization | 3.31 | 2.62 | -0.69 |
| hallucination | 3.38 | 3.46 | 0.08 |
| instruction_following | 2.92 | 2.92 | 0.00 |
| pedagogical_usefulness | 2.69 | 2.54 | -0.15 |
| actionability | 3.15 | 2.69 | -0.46 |
| conciseness | 3.31 | 3.54 | 0.23 |
| japanese_quality | 3.92 | 3.46 | -0.46 |

Hard pass: 0.9230769230769231 → 0.8461538461538461. Median latency: 8633 → 7888 ms. p95: 22189 → 20179 ms.

Gates: {"noNewHardFailures":false,"criticalAxes":false,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 13 pairs, win rate 0.46153846153846156. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- explain-reduce #0: candidate win=0.5. 両者とも合計と初期値を説明。

- auto-layout #0: candidate win=0.5. 双方配置不一致を見逃す。

- auto-complete #0: candidate win=0.5. 双方適切な沈黙。

- long-active-tail #0: candidate win=0.5. 型と0は双方正しい。

- uncertain-external #0: candidate win=0. BはDB以外の原因と関数内部の確認に触れる。

- learn-next #0: candidate win=0. Bは形式不正により回答が届かない。

- history-absent #0: candidate win=1. Aは不要なenabled説明なく比較材料を求める。

- long-additional-tail #0: candidate win=0.5. どちらも最新17秒を示す。

- additional-requirement #0: candidate win=0.5. 値と形式は同じ。

- related-file #0: candidate win=1. Bは行番号の創作なく正しく説明。

- bug-boundary #0: candidate win=0. Bも誤一般化と式漏洩があるが、境界違反を特定する。

- compare-approaches #0: candidate win=0. Aは挿入順を示しながら順序は保持されないと矛盾。

- hint-only #0: candidate win=1. Aは主因を捉えないが、BのPromise上のjsonという誤知識はない。
