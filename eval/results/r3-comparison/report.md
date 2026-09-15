# Pairwise evaluation

Baseline: eval/results/baseline-lmstudio

Candidate: eval/results/r3-thinking

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.346; case bootstrap 95% CI [0.115, 0.577]; ties 3/13.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.38 | 2.85 | 0.46 |
| groundedness | 2.69 | 3.00 | 0.31 |
| context_utilization | 2.31 | 2.92 | 0.62 |
| hallucination | 3.08 | 3.08 | 0.00 |
| instruction_following | 3.08 | 2.62 | -0.46 |
| pedagogical_usefulness | 2.00 | 2.31 | 0.31 |
| actionability | 2.38 | 2.69 | 0.31 |
| conciseness | 3.38 | 3.15 | -0.23 |
| japanese_quality | 3.23 | 3.08 | -0.15 |

Hard pass: 0.9230769230769231 → 1. Median latency: 6786 → 27562 ms. p95: 25879 → 39170 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":false,"qualityCI":false,"latency":false}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

## Cases

- long-additional-tail #0: candidate win=0. 両方とも最新17秒を回答できないが、Aは現在のコードを新仕様と捏造する。

- history-absent #0: candidate win=0.5. 両方とも履歴不足を認めて確認する。

- auto-complete #0: candidate win=0.5. 正しい沈黙。

- bug-boundary #0: candidate win=1. Bはループ条件と有効範囲を正しく示す。ただしnull等の余分な確認が増える。

- hint-only #0: candidate win=0. Bはawaitという答えと別のエラー処理まで示し、ヒント1つの制約を破る。

- explain-reduce #0: candidate win=0. 意味は同じだがBの「sumに始まります」は不自然。

- compare-approaches #0: candidate win=0. どちらもSetの順序を誤る。AはHTML形式と不自然な「遅延」も加わる。

- auto-layout #0: candidate win=1. Aは縦横の不一致を正しく特定した。改善だが実装を指示しておりヒント制約は弱い。

- long-active-tail #0: candidate win=0. どちらも定義不足を認めるがAは存在不明な検証・例外処理へ話を広げる。

- uncertain-external #0: candidate win=0. Bは情報不足を明示せずSQLのJOINやuserIdカラムを前提にする。

- additional-requirement #0: candidate win=0. 両方正答だがBは不要な入力処理・ループ確認を追加。

- learn-next #0: candidate win=1. Bはmapで名前を取り出す具体的な次の練習を示す。users.age表記は不正確。

- related-file #0: candidate win=0.5. 両方正答。Bはconstの値が変わらないかという不要な確認を加える。
