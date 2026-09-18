# Pairwise evaluation

Baseline: eval/results/q35-src-baseline

Candidate: eval/results/q35-src-factual

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.656; problem bootstrap 95% CI [0.354, 0.854]; ties 7/16. Problem-balanced win rate: 0.625.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.63 | 2.69 | 0.06 |
| groundedness | 2.63 | 2.81 | 0.19 |
| context_utilization | 2.88 | 2.94 | 0.06 |
| hallucination | 2.81 | 3.00 | 0.19 |
| instruction_following | 2.44 | 2.94 | 0.50 |
| pedagogical_usefulness | 2.63 | 2.56 | -0.06 |
| actionability | 2.56 | 2.50 | -0.06 |
| conciseness | 3.06 | 2.94 | -0.13 |
| japanese_quality | 3.88 | 3.50 | -0.38 |

Hard pass: 0.75 → 0.8125. Median latency: 14434 → 12081 ms. p95: 44913 → 120025 ms.

Gates: {"noNewHardFailures":false,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 15 pairs, win rate 0.7. 1 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- alg-unknown-transform-py #0: candidate win=0.5. 双方とも断定不能に回答。Aの余分な断定とBの冗長さを踏まえ決定的差なし。

- alg-sum-correct-py #0: candidate win=0.5. 両者とも正しい総和関数に沈黙。

- alg-sort-correct-js #0: candidate win=1. 双方とも不要介入。Aは既存コードを正しく読み、Bは存在する比較関数を無視。

- alg-stairs-bug-js #0: candidate win=0.5. どちらも具体的な不一致と初期化へのヒント。

- alg-sum-bug-py #0: candidate win=0.5. 両者とも末尾欠落に有効なヒント。追加確認の差は小さい。

- alg-sort-correct-py #0: candidate win=0.5. 同じ標準APIの誤認。

- alg-lower-bound-js #0: candidate win=1. Aは要求された結果と重複時の境界更新を示す。Bは結果を出さない。Aにも表現の不正確さが残る。

- alg-sum-correct-js #0: candidate win=0.5. 両者とも正しい総和関数に沈黙。

- alg-sort-bug-js #0: candidate win=1. Bは比較規則を指す。Aは整数要素を変換する不要な方向へ誘導。

- alg-lower-bound-py #0: candidate win=1. Aは数値の質問に答える分だけ改善。ただし境界の定義が誤っておりタスク達成とは数えない。

- alg-unknown-transform-js #0: candidate win=0.5. 両者とも断定不能という中心回答は適切で、仮定の説明に弱さがある。

- alg-sum-bug-js #0: candidate win=1. Aは完成条件を漏らす。Bは具体例を保ちヒントの範囲を守る。

- alg-stairs-bug-py #0: candidate win=1. 両者とも誤診。Aは不要な完成コードまでは出さない。

- alg-pair-bug-py #0: candidate win=0. Bは単調性の中心部分を正しく説明する点で良いが、最後の総括に誤りが残る。

- alg-sort-bug-py #0: candidate win=1. Aの比較基準へのヒントがより簡潔で自然。Bの数値変換という実装誘導は余分。

- alg-pair-bug-js #0: candidate win=0. Aは未配信。Bも誤診でタスク失敗だが応答はある。配信込みの比較で僅差B、意味評価ではAを除外。
