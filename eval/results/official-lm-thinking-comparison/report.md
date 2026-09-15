# Pairwise evaluation

Baseline: eval/results/official-reference-thinking

Candidate: eval/results/official-thinking-lmstudio

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.200; case bootstrap 95% CI [0.000, 0.600]; ties 0/5.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.80 | 2.20 | -0.60 |
| groundedness | 3.00 | 2.20 | -0.80 |
| context_utilization | 3.40 | 2.60 | -0.80 |
| hallucination | 3.40 | 2.20 | -1.20 |
| instruction_following | 2.40 | 2.20 | -0.20 |
| pedagogical_usefulness | 2.20 | 1.60 | -0.60 |
| actionability | 2.60 | 2.00 | -0.60 |
| conciseness | 3.60 | 2.60 | -1.00 |
| japanese_quality | 2.80 | 2.40 | -0.40 |

Hard pass: 1 → 0.6. Median latency: 30596 → 27740 ms. p95: 36099 → 30384 ms.

Gates: {"noNewHardFailures":false,"criticalAxes":false,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 4 pairs, win rate 0.25. 1 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- bug-boundary #0: candidate win=0. Aの方が有効添字を明示。Bは提供されていないadditional_contextにコードがあると記す。

- hint-only #0: candidate win=0. Aはbackend内部エラーで回答なし。能力比較には使わず、delivery failureとしてのみ評価。

- auto-layout #0: candidate win=0. Aも縦横を認識するがfocus=explainで期待continueに不合格。両方とも解決方法の提示が強い。

- compare-approaches #0: candidate win=0. 両方ともSetの順序を誤る。Aはfilterの方式を指定せずO(n)と断定し補助配列も決めつける。

- explain-reduce #0: candidate win=1. 意味は同じだがAは自然な日本語で説明する。
