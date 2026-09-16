# Pairwise evaluation

Baseline: eval/results/af-lm-automatic-baseline

Candidate: eval/results/af-lm-automatic-candidate

Split: tuning; judge: Codex / GPT-6 (session model)

Win rate (ties=0.5): 0.607; problem bootstrap 95% CI [0.525, 0.675]; ties 14/28. Problem-balanced win rate: 0.600.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.50 | 2.82 | 0.32 |
| groundedness | 2.50 | 2.82 | 0.32 |
| context_utilization | 2.93 | 3.14 | 0.21 |
| hallucination | 3.07 | 3.39 | 0.32 |
| instruction_following | 2.18 | 2.57 | 0.39 |
| pedagogical_usefulness | 2.25 | 2.46 | 0.21 |
| actionability | 2.46 | 2.46 | 0.00 |
| conciseness | 3.68 | 3.71 | 0.04 |
| japanese_quality | 3.89 | 3.96 | 0.07 |

Hard pass: 0.5357142857142857 → 0.6071428571428571. Median latency: 7386 → 7644 ms. p95: 12847 → 10974 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":true,"qualityCI":true,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 28 pairs, win rate 0.6071428571428571. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- alg-sort-correct-js #0: candidate win=0.5. 数値sortの正解コードに両方沈黙。

- alg-sort-bug-js #0: candidate win=0.5. 両方が同じ誤った数値変換へ誘導。

- alg-sort-correct-py #1: candidate win=1. 両方不要な介入だがBにはsortedの誤った仕様説明がない。

- alg-bfs-correct-js #1: candidate win=0. Bは誤った別処理を求めないが、両方沈黙すべき。

- alg-prefix-bug-py #0: candidate win=0. Bは着目場所が具体的だが、どちらも端点の欠落を説明しない。

- alg-bfs-correct-js #0: candidate win=0. Aも不適切だがBは正常コードを壊す具体的修正。

- alg-bfs-correct-py #1: candidate win=1. BはDFSという誤診を避けているが不要な確認が残る。

- alg-stairs-bug-py #0: candidate win=1. Aは原因が正しい。両方ヒントの範囲を超える。

- alg-stairs-bug-js #0: candidate win=0.5. 両方バグを見逃す。

- alg-prefix-correct-js #1: candidate win=0.5. 正しい累積和に両方沈黙。

- alg-prefix-bug-py #1: candidate win=1. Bは確認を促すが診断として不足。どちらも未達。

- alg-sum-incomplete-js #1: candidate win=0.5. 同等の適切なヒント。

- alg-prefix-correct-py #0: candidate win=1. Aは不要だが仕様外の処理追加を求めない。

- alg-prefix-correct-js #0: candidate win=0.5. 正しい累積和に両方沈黙。

- alg-sort-correct-js #1: candidate win=0.5. 正しい数値sortに両方沈黙。

- alg-sum-incomplete-py #1: candidate win=0.5. 両方短く原因と着目点を示す。

- alg-sort-correct-py #0: candidate win=0.5. 同じ出力契約の取り違え。短さは採否を変えない。

- alg-stairs-bug-js #1: candidate win=0.5. 両方バグを見逃す。

- alg-sort-bug-py #0: candidate win=1. Bは修正引数を開示せず比較基準に誘導。キー必須という弱点は記録。

- alg-sort-bug-js #1: candidate win=1. Aは表現に弱さがあるがヒント制約を守る。

- alg-sort-bug-py #1: candidate win=0. Bだけが適切な短いヒント。

- alg-prefix-bug-js #0: candidate win=0.5. 両方沈黙で見逃し。

- alg-prefix-bug-js #1: candidate win=0.5. 両方沈黙で見逃し。

- alg-prefix-correct-py #1: candidate win=1. Aだけ適切に沈黙。

- alg-sum-incomplete-py #0: candidate win=0.5. どちらも許容されたヒント。

- alg-stairs-bug-py #1: candidate win=1. Aには0段の正しい要件があるが、両方原因分析に誤り。

- alg-bfs-correct-py #0: candidate win=1. 両方誤診だがBは有向グラフの意味まで取り違える。

- alg-sum-incomplete-js #0: candidate win=0.5. 本質的に同等の適切なヒント。
