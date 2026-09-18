# Pairwise evaluation

Baseline: eval/results/m917-oll-vulkan-baseline

Candidate: eval/results/m917-oll-vulkan-candidate

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.281; problem bootstrap 95% CI [0.083, 0.417]; ties 7/16. Problem-balanced win rate: 0.250.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.69 | 1.38 | -1.31 |
| groundedness | 2.94 | 1.44 | -1.50 |
| context_utilization | 2.75 | 1.44 | -1.31 |
| hallucination | 3.56 | 1.94 | -1.63 |
| instruction_following | 2.88 | 1.50 | -1.38 |
| pedagogical_usefulness | 2.63 | 1.38 | -1.25 |
| actionability | 2.69 | 1.50 | -1.19 |
| conciseness | 3.44 | 2.19 | -1.25 |
| japanese_quality | 4.00 | 2.44 | -1.56 |

Hard pass: 0.8125 → 0.375. Median latency: 38635 → 34865 ms. p95: 62241 → 73458 ms.

Gates: {"noNewHardFailures":false,"criticalAxes":false,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 16 pairs, win rate 0.28125. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- alg-pair-bug-js #0: candidate win=0.5. Aは誤った大小関係を教え、Bは未配信。どちらも求めた説明として使用できない。

- alg-lower-bound-js #0: candidate win=0. Bは結果と概略を配信できる。Aは形式修正後も受理できない。

- alg-sum-bug-py #0: candidate win=0. Bだけが実際の不具合を正しく診断する。

- alg-stairs-bug-js #0: candidate win=0. 両方不合格。Bは誤った実行結果を根拠としており、Aの見逃しより有害。

- alg-lower-bound-py #0: candidate win=0. Aに用語の省略はあるが、Bは具体的な配列位置を取り違える。

- alg-sum-bug-js #0: candidate win=0. Aは正しい診断を配信できる。Bは形式・負数の扱いを誤る。

- alg-sort-correct-js #0: candidate win=0.5. 同一の適切な沈黙。

- alg-sort-bug-py #0: candidate win=1. Aは実際の出力例で原因を明瞭に示し、修正方法を不必要に限定しない。

- alg-sum-correct-py #0: candidate win=0.5. 同一の適切な沈黙。

- alg-sort-bug-js #0: candidate win=0. Bは実際の比較規則を正しく診断する。

- alg-sum-correct-js #0: candidate win=0.5. 同一の適切な沈黙。

- alg-unknown-transform-py #0: candidate win=0. Aは必要情報と不確実性を適切に伝えられる。

- alg-sort-correct-py #0: candidate win=0.5. どちらも正しいコードに不要な確認を要求する。

- alg-pair-bug-py #0: candidate win=0.5. Aは未配信、Bは中心説明が逆。いずれも使える説明ではない。

- alg-unknown-transform-js #0: candidate win=0. Aは余分な条件を挙げるが、求められた判断不能という結論は配信できる。

- alg-stairs-bug-py #0: candidate win=0.5. 同じ初期条件の不具合を見逃している。
