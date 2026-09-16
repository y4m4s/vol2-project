# Pairwise evaluation

Baseline: eval/results/af-oll-automatic-baseline

Candidate: eval/results/af-oll-automatic-candidate

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.518; problem bootstrap 95% CI [0.500, 0.575]; ties 21/28. Problem-balanced win rate: 0.525.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.71 | 2.82 | 0.11 |
| groundedness | 2.71 | 2.82 | 0.11 |
| context_utilization | 3.14 | 3.25 | 0.11 |
| hallucination | 3.39 | 3.57 | 0.18 |
| instruction_following | 2.39 | 2.39 | 0.00 |
| pedagogical_usefulness | 2.43 | 2.50 | 0.07 |
| actionability | 2.46 | 2.46 | 0.00 |
| conciseness | 3.75 | 3.79 | 0.04 |
| japanese_quality | 3.89 | 3.93 | 0.04 |

Hard pass: 0.5714285714285714 → 0.5714285714285714. Median latency: 5650 → 5423 ms. p95: 9806 → 11373 ms.

Gates: {"noNewHardFailures":false,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 28 pairs, win rate 0.5178571428571429. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- alg-stairs-bug-py #1: candidate win=1. Bも未達だが誤ったrange仕様と修正式はない。

- alg-prefix-correct-py #0: candidate win=0.5. 累積和の正解に両方沈黙。

- alg-bfs-correct-py #0: candidate win=0.5. どちらも正しいBFSを誤診。

- alg-sort-correct-py #0: candidate win=0.5. 正解を認識できても両方発話を控えられない。

- alg-sort-correct-py #1: candidate win=1. Bだけ適切に沈黙。

- alg-sort-bug-py #0: candidate win=0.5. 両方とも具体的引数まで開示。修正自体はこの整数入力で機能する。

- alg-prefix-correct-js #0: candidate win=0.5. 正しい累積和に両方沈黙。

- alg-sort-bug-js #1: candidate win=0.5. 同じ解答開示。

- alg-bfs-correct-py #1: candidate win=1. Aも不要で根拠が誤るがBは具体的な正常動作を否定。

- alg-prefix-bug-js #1: candidate win=0.5. 両方バグに沈黙。

- alg-bfs-correct-js #1: candidate win=1. Aは不要な確認だが有向グラフの誤診を避ける。

- alg-bfs-correct-js #0: candidate win=0. Bは無関係で長いが、実際の距離更新を誤診しない。

- alg-stairs-bug-js #1: candidate win=0.5. 両方沈黙で見逃し。

- alg-sum-incomplete-js #1: candidate win=0.5. 同等の適切なヒント。

- alg-sum-incomplete-py #0: candidate win=0.5. 同等の適切なヒント。

- alg-sort-correct-js #1: candidate win=0.5. 正しい数値sortに両方沈黙。

- alg-stairs-bug-py #0: candidate win=0. Bは失敗する具体例を示すが、両方診断不足。

- alg-sort-bug-py #1: candidate win=0. Aだけ具体的解答を開示しない。

- alg-stairs-bug-js #0: candidate win=0.5. 両方バグに沈黙。

- alg-prefix-correct-js #1: candidate win=0.5. 正しい累積和に両方沈黙。

- alg-prefix-bug-js #0: candidate win=0.5. 両方バグに沈黙。

- alg-prefix-correct-py #1: candidate win=0.5. 正しい累積和に両方沈黙。

- alg-sort-correct-js #0: candidate win=0.5. 正しい数値sortに両方沈黙。

- alg-prefix-bug-py #0: candidate win=0.5. 両方バグに沈黙。

- alg-sum-incomplete-js #0: candidate win=0.5. 同等の適切なヒント。

- alg-sort-bug-js #0: candidate win=0.5. Aは原因に届かずBは誤った対処。両方未達。

- alg-prefix-bug-py #1: candidate win=0.5. 両方バグに沈黙。

- alg-sum-incomplete-py #1: candidate win=0.5. 同等の適切なヒント。
