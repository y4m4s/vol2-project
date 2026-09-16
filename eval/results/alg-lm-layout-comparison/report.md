# Pairwise evaluation

Baseline: eval/results/alg-lm-baseline-v2

Candidate: eval/results/alg-lm-sections

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.531; problem bootstrap 95% CI [0.417, 0.662]; ties 27/48. Problem-balanced win rate: 0.523.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 3.33 | 3.33 | 0.00 |
| groundedness | 3.40 | 3.42 | 0.02 |
| context_utilization | 3.69 | 3.67 | -0.02 |
| hallucination | 3.42 | 3.44 | 0.02 |
| instruction_following | 3.63 | 3.67 | 0.04 |
| pedagogical_usefulness | 3.02 | 3.04 | 0.02 |
| actionability | 3.48 | 3.42 | -0.06 |
| conciseness | 3.88 | 3.79 | -0.08 |
| japanese_quality | 3.92 | 3.90 | -0.02 |

Hard pass: 1 → 1. Median latency: 8476 → 7925 ms. p95: 13881 → 13646 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 48 pairs, win rate 0.53125. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- alg-lower-bound-py #2: candidate win=0.5. 両方とも探索方向を逆に説明。

- alg-sum-incomplete-js #0: candidate win=0.5. 両方とも不足処理を適切に案内。

- alg-unknown-transform-py #0: candidate win=0.5. 根拠不足の扱いは同等。

- alg-sum-bug-js #1: candidate win=0. Bは正確な着目点だけを示し、境界の曖昧な修正を避ける。

- alg-sum-bug-py #0: candidate win=0.5. 両方とも範囲のバグを正しく指摘。

- alg-frequency-bug-py #2: candidate win=0. Aの軽微な表記不備よりBの解答開示が重大。

- alg-pair-bug-js #0: candidate win=1. どちらも不合格。Aは一部の和と移動を正しく捉える。

- alg-frequency-bug-py #0: candidate win=0.5. 両方とも正しい修正式だがヒント依頼に違反。

- alg-lower-bound-js #1: candidate win=0.5. 両方とも値だけ正しく、説明は誤る。

- alg-frequency-bug-js #1: candidate win=0. Aは同じ短さで原因まで説明する。

- alg-sum-incomplete-js #1: candidate win=0.5. 両方とも適切な実装着手のヒント。

- alg-frequency-bug-js #2: candidate win=1. 両方に問題があるが、Bは明示された完成式禁止を守る。

- alg-pair-count-py #0: candidate win=0.5. どちらも次の検討方針として有用。

- alg-lower-bound-py #1: candidate win=1. Aは等値側の分岐に踏み込む。

- alg-unknown-transform-js #0: candidate win=0.5. 主な要求への応答は同等。

- alg-sum-correct-js #1: candidate win=0.5. 正解コードで両方とも適切に沈黙。

- alg-unknown-transform-js #2: candidate win=0. Bは情報不足への結論を明示する。

- alg-pair-bug-js #2: candidate win=1. 両方不正確だが、Bは欠陥自体を否定する重大な誤診。

- alg-pair-count-py #2: candidate win=0. Bは不正確な具体回数を追加しない。

- alg-pair-bug-js #1: candidate win=1. Aは現行分岐を参照するが、どちらも核心の説明不足。

- alg-frequency-bug-js #0: candidate win=0. Bは原因を説明しつつ解答を開示しない。

- alg-sum-incomplete-py #2: candidate win=1. Aは内容が正しく、不要な著者ラベルもない。

- alg-sum-correct-py #2: candidate win=0.5. 正解コードで適切に沈黙。

- alg-unknown-transform-js #1: candidate win=0.5. 不確実性の扱いは同等。

- alg-pair-count-js #0: candidate win=1. AはBにある具体的な計算回数の誤答を避ける。

- alg-lower-bound-js #0: candidate win=0. Aだけが重複時の方向を正しく説明。

- alg-sum-incomplete-js #2: candidate win=0.5. どちらも不足処理への適切なヒント。

- alg-sum-incomplete-py #1: candidate win=0.5. 概念の提案は許容範囲で、同等。

- alg-pair-count-py #1: candidate win=0. Bは時間制限を推測で断定しない。

- alg-sum-correct-js #2: candidate win=0.5. 正解コードで適切に沈黙。

- alg-sum-correct-py #0: candidate win=0.5. 正解コードで適切に沈黙。

- alg-lower-bound-js #2: candidate win=0.5. 両方とも重複時の説明が誤り。

- alg-frequency-bug-py #1: candidate win=0.5. どちらもヒントのみという条件に違反。

- alg-sum-bug-js #2: candidate win=0.5. 核心の指摘と解答の非開示は同等。

- alg-pair-count-js #2: candidate win=0.5. 方針提示として同程度。

- alg-sum-bug-py #1: candidate win=1. Bは着目点を伝え、具体的修正値の提示を避ける。

- alg-pair-bug-py #1: candidate win=1. Bも不合格だが、存在しない値によるAの誤診より部分的に近い。

- alg-unknown-transform-py #1: candidate win=0.5. Aは明示性、Bは簡潔さに利点があり主な結論は同等。

- alg-sum-bug-py #2: candidate win=1. Aは現行動作の説明に留める。

- alg-sum-incomplete-py #0: candidate win=0.5. どちらも次の実装へ進めるヒント。

- alg-pair-count-js #1: candidate win=1. Aは質問された次の方針を具体化する。

- alg-pair-bug-py #2: candidate win=0. 両方誤答。Bは少なくともバグの存在を否定しない。

- alg-sum-correct-py #1: candidate win=0.5. 正解コードで適切に沈黙。

- alg-sum-bug-js #0: candidate win=0.5. どちらもバグは見つけるが修正条件まで提示。

- alg-lower-bound-py #0: candidate win=0.5. 両方とも値だけ正答して理由を誤る。

- alg-pair-bug-py #0: candidate win=1. Aは実際の反例を追える。Bは昇順と移動方向の関係を誤る。

- alg-unknown-transform-py #2: candidate win=0.5. 両方とも根拠に沿った留保。

- alg-sum-correct-js #0: candidate win=0.5. 正解コードで適切に沈黙。
