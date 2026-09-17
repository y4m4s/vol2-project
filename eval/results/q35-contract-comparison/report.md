# Pairwise evaluation

Baseline: eval/results/q35-src-baseline

Candidate: eval/results/q35-src-contract

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.500; problem bootstrap 95% CI [0.438, 0.563]; ties 8/16. Problem-balanced win rate: 0.500.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.63 | 2.50 | -0.13 |
| groundedness | 2.63 | 2.56 | -0.06 |
| context_utilization | 2.88 | 2.63 | -0.25 |
| hallucination | 2.81 | 2.81 | 0.00 |
| instruction_following | 2.44 | 2.56 | 0.13 |
| pedagogical_usefulness | 2.63 | 2.56 | -0.06 |
| actionability | 2.56 | 2.63 | 0.06 |
| conciseness | 3.06 | 2.94 | -0.13 |
| japanese_quality | 3.88 | 3.69 | -0.19 |

Hard pass: 0.75 → 0.75. Median latency: 14434 → 12525 ms. p95: 44913 → 29952 ms.

Gates: {"noNewHardFailures":false,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 16 pairs, win rate 0.5. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- alg-sort-bug-js #0: candidate win=0.5. Aは誤った変換へ誘導、Bは見逃し。いずれも有効なヒントを届けない。

- alg-sum-bug-js #0: candidate win=0. Aにも漏洩があるが、コード挙動の説明は正しい。双方タスク失敗。

- alg-lower-bound-js #0: candidate win=0.5. 双方とも数値を回答せず、要求を満たさない。

- alg-sort-bug-py #0: candidate win=0. Aは配信可能。Bは正しい説明を含むが形式不正で利用者へ届かない。

- alg-sum-correct-js #0: candidate win=0.5. 正しい総和への沈黙。

- alg-stairs-bug-js #0: candidate win=0. Aは具体的な不一致を正しく述べ、Bは存在しない配列参照を診断。

- alg-pair-bug-py #0: candidate win=0. Bの増減の説明は有用。どちらも片方だけ動かすこと自体を原因にしてしまう。

- alg-sum-bug-py #0: candidate win=0.5. どちらも正しい短いヒント。

- alg-lower-bound-py #0: candidate win=0.5. 双方とも直接質問への数値回答がない。

- alg-sort-correct-js #0: candidate win=1. Aは正しいコードに沈黙、Bは誤指摘。

- alg-sort-correct-py #0: candidate win=1. Aは適切な沈黙、Bはsortedの誤認。

- alg-unknown-transform-js #0: candidate win=0.5. 双方とも実装の未提示を理由に断定を避ける。

- alg-sum-correct-py #0: candidate win=0.5. 正しい総和への沈黙。

- alg-stairs-bug-py #0: candidate win=1. Bは実際の戻り値の不一致へ進むが原因は誤診。改善しても成功とは数えない。

- alg-pair-bug-js #0: candidate win=1. Bは単調性と具体例の核心を説明。

- alg-unknown-transform-py #0: candidate win=0.5. 中心回答は双方適切、付随する推測の誘導には弱さ。
