# Pairwise evaluation

Baseline: eval/results/m917-lm-baseline

Candidate: eval/results/m917-lm-candidate

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.438; problem bootstrap 95% CI [0.250, 0.500]; ties 4/16. Problem-balanced win rate: 0.417.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.81 | 2.75 | -0.06 |
| groundedness | 3.00 | 3.13 | 0.13 |
| context_utilization | 2.75 | 3.00 | 0.25 |
| hallucination | 3.69 | 3.13 | -0.56 |
| instruction_following | 2.81 | 2.56 | -0.25 |
| pedagogical_usefulness | 2.50 | 2.50 | 0.00 |
| actionability | 2.50 | 2.81 | 0.31 |
| conciseness | 3.63 | 2.75 | -0.88 |
| japanese_quality | 4.00 | 3.50 | -0.50 |

Hard pass: 0.8125 → 0.6875. Median latency: 11150 → 14404 ms. p95: 28192 → 39320 ms.

Gates: {"noNewHardFailures":false,"criticalAxes":true,"qualityCI":false,"latency":false}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 16 pairs, win rate 0.4375. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- alg-lower-bound-py #0: candidate win=1. Aはラベルを欠くが探索の説明は具体的。Bはラベルを守る一方、範囲変化に答えていない。

- alg-sort-correct-py #0: candidate win=0.5. どちらも正しいコードへの不要な介入であり、有用な差は小さい。

- alg-sort-bug-py #0: candidate win=0.5. 両方とも数値順にならない原因を短く正しく示す。

- alg-pair-bug-py #0: candidate win=1. Bの小さい和と右移動の説明が一歩具体的だが、両回答とも指定例の説明には不足。

- alg-sort-correct-js #0: candidate win=0. Bは正しいコードに介入しない。Aは形式不正に加え、提示済みの比較関数を無視。

- alg-stairs-bug-py #0: candidate win=0. 両方失敗。Bは見逃し、Aは見逃しに加え不要な表示処理を要求するため、より有害。

- alg-stairs-bug-js #0: candidate win=1. Bは実際の反例で初期化の誤りに誘導する。

- alg-sort-bug-js #0: candidate win=1. Bだけが実際のバグ原因を特定する。

- alg-sum-bug-js #0: candidate win=0. 両方有効だが、Bは一般的な原因を短く示す。

- alg-unknown-transform-js #0: candidate win=0. Aは不足情報と結論を短く過不足なく示す。

- alg-pair-bug-js #0: candidate win=0. 両方不合格。Aは利用可能な応答がなく、Bも中心の説明が誤っているため差は小さい。

- alg-unknown-transform-py #0: candidate win=0. Aは必要情報を絞れている。Bは回答自体は慎重だが不要な条件を広げる。

- alg-lower-bound-js #0: candidate win=0. Aに変数名の省略があるものの、Bは求められた直接回答を差し控えている。

- alg-sum-bug-py #0: candidate win=1. Bは確認場所と原因を明確にする。

- alg-sum-correct-js #0: candidate win=0.5. 同一の適切な沈黙。

- alg-sum-correct-py #0: candidate win=0.5. 同一の適切な沈黙。
