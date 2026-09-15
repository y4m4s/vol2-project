# Pairwise evaluation

Baseline: eval/results/baseline-lmstudio

Candidate: eval/results/r2-evidence

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.462; case bootstrap 95% CI [0.308, 0.615]; ties 8/13.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.38 | 2.54 | 0.15 |
| groundedness | 2.69 | 2.54 | -0.15 |
| context_utilization | 2.31 | 2.46 | 0.15 |
| hallucination | 3.08 | 2.92 | -0.15 |
| instruction_following | 3.08 | 2.54 | -0.54 |
| pedagogical_usefulness | 2.00 | 2.08 | 0.08 |
| actionability | 2.38 | 2.54 | 0.15 |
| conciseness | 3.38 | 3.38 | 0.00 |
| japanese_quality | 3.23 | 3.46 | 0.23 |

Hard pass: 0.9230769230769231 → 0.9230769230769231. Median latency: 6786 → 6481 ms. p95: 25879 → 33719 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":false,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

## Cases

- related-file #0: candidate win=0.5. 両方とも正答。Aは日本語が改善するが式の改行と反復が気になる。

- auto-layout #0: candidate win=0.5. 両方とも縦横の不一致を見逃す。

- bug-boundary #0: candidate win=1. Bは範囲外参照とundefinedの加算を正しく説明。

- explain-reduce #0: candidate win=0.5. 両方とも2文で合計と初期値を説明。

- long-active-tail #0: candidate win=0. Aは見えないparsePortの型とnull/undefinedの返却を捏造。Bは不足を認める。

- uncertain-external #0: candidate win=0. Aは未確認のuserIdフィールドを前提にし、壊れたbulletタグも出す。

- additional-requirement #0: candidate win=0.5. 両方とも出力形式と値が正しい。

- learn-next #0: candidate win=0.5. 両方とも既習filterの反復。Bは新しい学習を示さず具体的な条件も漏らす。

- long-additional-tail #0: candidate win=0. 両方とも最新値を誤答。Bは旧版メモを新仕様と明示的に取り違える。

- auto-complete #0: candidate win=0.5. 正しい沈黙。

- hint-only #0: candidate win=0.5. Aはawaitの答えを漏らす。Bは本質から遠いヒント。

- history-absent #0: candidate win=1. Bは必要な前の案を直接求めて簡潔。

- compare-approaches #0: candidate win=0.5. 両方ともSetの順序を誤説明。
