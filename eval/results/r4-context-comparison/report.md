# Pairwise evaluation

Baseline: eval/results/r4-baseline-v2

Candidate: eval/results/r4-context-v2

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.577; case bootstrap 95% CI [0.423, 0.731]; ties 9/13.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.62 | 2.85 | 0.23 |
| groundedness | 2.92 | 3.15 | 0.23 |
| context_utilization | 2.46 | 3.15 | 0.69 |
| hallucination | 3.23 | 3.38 | 0.15 |
| instruction_following | 2.69 | 3.00 | 0.31 |
| pedagogical_usefulness | 2.38 | 2.69 | 0.31 |
| actionability | 2.69 | 2.85 | 0.15 |
| conciseness | 3.46 | 3.46 | 0.00 |
| japanese_quality | 3.62 | 3.54 | -0.08 |

Hard pass: 0.9230769230769231 → 0.9230769230769231. Median latency: 6355 → 6844 ms. p95: 21156 → 32844 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":true,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 13 pairs, win rate 0.5769230769230769. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- explain-reduce #0: candidate win=0.5. ともに合計と初期値を説明し空配列の言及はない。

- auto-complete #0: candidate win=0.5. 両者とも適切な沈黙。

- history-absent #0: candidate win=0. Bは比較に必要な過去の案の提示を求める。Aは抽象的。

- related-file #0: candidate win=0.5. どちらも定義を参照して真偽を正しく説明。

- bug-boundary #0: candidate win=1. Aは最終添字へ着目。Bはコードで確定する境界違反を見逃し入力内容へ逸れる。

- long-additional-tail #0: candidate win=1. Bは最新17秒を回答。Aは最新情報不足。

- compare-approaches #0: candidate win=0.5. 双方ともSetの挿入順を誤る。

- auto-layout #0: candidate win=0.5. 両者とも配置不一致を見逃して沈黙。

- additional-requirement #0: candidate win=0.5. 両者とも値と1行1個の形式を説明。

- learn-next #0: candidate win=0.5. Aは既習filterの復習のみ、Bは次の候補を複数挙げる。双方とも1つの次課題に不十分。

- hint-only #0: candidate win=0.5. いずれもawaitというキーワードのヒントで完成コードはなく、v2基準では許容。

- long-active-tail #0: candidate win=1. Bも空文字で誤答するが、入力が保持されnumberという型は説明できた。

- uncertain-external #0: candidate win=0.5. どちらも未提示のDB検索を前提にし、判断不能を明確にしない。
