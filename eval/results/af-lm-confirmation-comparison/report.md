# Pairwise evaluation

Baseline: eval/results/af-lm-confirmation-baseline

Candidate: eval/results/af-lm-confirmation-candidate

Split: holdout; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.469; problem bootstrap 95% CI [0.250, 0.625]; ties 7/16. Problem-balanced win rate: 0.469.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.38 | 2.69 | 0.31 |
| groundedness | 2.50 | 2.69 | 0.19 |
| context_utilization | 3.00 | 3.06 | 0.06 |
| hallucination | 3.25 | 3.44 | 0.19 |
| instruction_following | 2.50 | 2.69 | 0.19 |
| pedagogical_usefulness | 2.31 | 2.44 | 0.13 |
| actionability | 2.44 | 2.56 | 0.13 |
| conciseness | 3.81 | 3.75 | -0.06 |
| japanese_quality | 3.94 | 3.94 | 0.00 |

Hard pass: 0.625 → 0.625. Median latency: 7517 → 6155 ms. p95: 11942 → 15719 ms.

Gates: {"noNewHardFailures":false,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 16 pairs, win rate 0.46875. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- alg-paren-correct-py #0: candidate win=1. Bは先行括弧の誤診を避けるが、両方沈黙すべき。

- alg-max-subarray-bug-js #0: candidate win=0. 両方見逃しだがBは誤った正解保証も与える。

- alg-paren-bug-py #0: candidate win=1. 両方根本原因に届くがAの説明が明瞭。

- alg-max-subarray-correct-js #0: candidate win=0. Bは非空という理由が明示的。

- alg-max-subarray-correct-py #0: candidate win=0. Aは制約と初期化の関係が明瞭。

- alg-gcd-bug-js #0: candidate win=1. Bだけが終了時の値とreturnを結び付ける。

- alg-merge-bug-js #0: candidate win=1. 両方未達。Aは存在しない重複/展開の問題へ誤誘導。Bの沈黙も見逃しとして計上。

- alg-gcd-correct-py #0: candidate win=0.5. 同等の正しい説明。

- alg-paren-correct-js #0: candidate win=0. 両方誤診だがBは文字集合の制約まで無視。

- alg-paren-bug-js #0: candidate win=0.5. どちらも適切に不足条件をヒントにする。

- alg-gcd-correct-js #0: candidate win=0. Bだけが質問された終了時の変数関係を正答。

- alg-merge-correct-js #0: candidate win=0.5. 正しいmergeに両方沈黙。

- alg-max-subarray-bug-py #0: candidate win=0.5. 両方バグに沈黙。

- alg-gcd-bug-py #0: candidate win=0.5. 両方バグに沈黙。

- alg-merge-correct-py #0: candidate win=0.5. 正しいmergeに両方沈黙。

- alg-merge-bug-py #0: candidate win=0.5. 両方バグに沈黙。
