# Pairwise evaluation

Baseline: eval/results/baseline-lmstudio

Candidate: eval/results/baseline-ollama

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.577; case bootstrap 95% CI [0.423, 0.731]; ties 9/13.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.38 | 2.92 | 0.54 |
| groundedness | 2.69 | 3.08 | 0.38 |
| context_utilization | 2.31 | 2.92 | 0.62 |
| hallucination | 3.08 | 3.23 | 0.15 |
| instruction_following | 3.08 | 2.46 | -0.62 |
| pedagogical_usefulness | 2.00 | 2.46 | 0.46 |
| actionability | 2.38 | 2.69 | 0.31 |
| conciseness | 3.38 | 3.15 | -0.23 |
| japanese_quality | 3.23 | 3.77 | 0.54 |

Hard pass: 0.9230769230769231 → 0.8461538461538461. Median latency: 6786 → 6521 ms. p95: 25879 → 24242 ms.

Gates: {"noNewHardFailures":false,"criticalAxes":false,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

## Cases

- learn-next #0: candidate win=1. Bはmapとの連鎖という次の学習につなげる。Aは既習filterの繰り返しで英語も混在。

- history-absent #0: candidate win=0.5. 両方とも履歴を捏造せず案の提示を求める。表現差は小さい。

- additional-requirement #0: candidate win=0.5. ともに1,3,5を各行に出す仕様を正しく説明。

- auto-layout #0: candidate win=0.5. 両方とも縦横の不一致を見逃して沈黙。

- related-file #0: candidate win=0.5. 両方とも定義を参照し正答。Aの言語混在とBの冗長さは別の小さな弱点。

- long-additional-tail #0: candidate win=0. どちらも最新17秒に答えられない。Bは形式修復後も表示不能。Aも旧設定からの推測は不適切。

- compare-approaches #0: candidate win=0.5. Aは回答せず、BはSetが順序を失うという重大な誤り。実用上どちらも不十分。

- uncertain-external #0: candidate win=1. Bはこのコードだけでは確認できないと明示。ただし両方ともfetchDataがSQLを使う前提に寄り過ぎる。

- bug-boundary #0: candidate win=0.5. 両方が最後まで回らないと誤説明。Bはundefined→NaNを説明する一方、修正式を直接漏らす。

- long-active-tail #0: candidate win=1. Bは型numberと空文字→0に正答。Aは欠落を認めているが経路全体として回答できない。

- explain-reduce #0: candidate win=0.5. どちらも合計と初期値を2文で正しく説明。空配列の扱いは補足可能だが必須質問ではない。

- hint-only #0: candidate win=0.5. Aは正しい原因だが答えawaitを漏らす。Bはヒントを守るが本質のPromiseに届かない。

- auto-complete #0: candidate win=0.5. 課題完了を正しく認識し沈黙。
