# Pairwise evaluation

Baseline: eval/results/baseline-lmstudio

Candidate: eval/results/r1-head-tail

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.538; case bootstrap 95% CI [0.385, 0.692]; ties 8/13.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.38 | 2.54 | 0.15 |
| groundedness | 2.69 | 2.77 | 0.08 |
| context_utilization | 2.31 | 2.54 | 0.23 |
| hallucination | 3.08 | 3.15 | 0.08 |
| instruction_following | 3.08 | 2.69 | -0.38 |
| pedagogical_usefulness | 2.00 | 2.31 | 0.31 |
| actionability | 2.38 | 2.54 | 0.15 |
| conciseness | 3.38 | 3.23 | -0.15 |
| japanese_quality | 3.23 | 3.46 | 0.23 |

Hard pass: 0.9230769230769231 → 0.9230769230769231. Median latency: 6786 → 6634 ms. p95: 25879 → 20094 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":false,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

## Cases

- hint-only #0: candidate win=0.5. Aはawaitを漏らし、Bは根本原因への導線が弱い。

- auto-complete #0: candidate win=0.5. 両方とも正しい沈黙。

- uncertain-external #0: candidate win=0.5. ともに原因候補を示すがSQL利用を未確認のまま前提にする。

- history-absent #0: candidate win=0. Aは案の提示を求める。Bは不明な案にenabledが関係すると仮定して一般論へ逸れる。

- long-active-tail #0: candidate win=0. Bは定義が見えてもNumber空文字をNaNと誤答。Aの情報不足を認める応答のほうが誤学習を避ける。

- auto-layout #0: candidate win=0.5. 両方とも縦横不一致を見逃す。

- related-file #0: candidate win=1. Aは日本語が改善し定義の引用も明確。ただし説明は繰り返す。

- explain-reduce #0: candidate win=0.5. 両方とも合計と初期値を2文で説明。

- long-additional-tail #0: candidate win=1. Aは旧値から最新を捏造しない。ただし両方とも必要情報は切り詰められている。

- compare-approaches #0: candidate win=0.5. どちらもSetが順序を保持しないと誤答。

- additional-requirement #0: candidate win=0.5. 双方とも要求された値と出力形式が正しい。

- learn-next #0: candidate win=0.5. 双方が既習filterを繰り返し次の学びを示さない。Bは既存条件を追加するよう述べる。

- bug-boundary #0: candidate win=1. Aは最後の要素の1つ先へのアクセスを正しく説明。送信promptは変わらずsamplingの揺らぎとして扱う。
