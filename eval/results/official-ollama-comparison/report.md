# Pairwise evaluation

Baseline: eval/results/official-reference-ollama

Candidate: eval/results/official-nonthinking-ollama

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.400; case bootstrap 95% CI [0.200, 0.500]; ties 4/5.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.60 | 2.60 | 0.00 |
| groundedness | 2.80 | 3.00 | 0.20 |
| context_utilization | 2.80 | 2.40 | -0.40 |
| hallucination | 3.40 | 3.80 | 0.40 |
| instruction_following | 1.80 | 1.20 | -0.60 |
| pedagogical_usefulness | 1.60 | 1.40 | -0.20 |
| actionability | 2.20 | 2.00 | -0.20 |
| conciseness | 3.00 | 3.40 | 0.40 |
| japanese_quality | 3.60 | 3.20 | -0.40 |

Hard pass: 0.8 → 0.8. Median latency: 5065 → 6843 ms. p95: 18410 → 17078 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":false,"qualityCI":false,"latency":false}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

## Cases

- compare-approaches #0: candidate win=0.5. AはSetの順序を誤説明し、Bは不要な追加文脈を要求して比較に答えない。

- auto-layout #0: candidate win=0.5. 同じ縦横の見逃し。

- bug-boundary #0: candidate win=0.5. 両方が範囲外とNaNを正しく説明する一方、修正式を漏らす。

- explain-reduce #0: candidate win=0. 意味は同等だがBの「変数に…計算しています」が不自然。

- hint-only #0: candidate win=0.5. ともにawaitという答えを提示。
