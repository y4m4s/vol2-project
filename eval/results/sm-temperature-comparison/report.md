# Pairwise evaluation

Baseline: eval/results/sm-lm-file

Candidate: eval/results/sm-lm-temp02

Split: tuning; judge: Codex-manual

Win rate (ties=0.5): 0.533; case bootstrap 95% CI [0.383, 0.650]; ties 16/30.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 3.07 | 3.13 | 0.07 |
| groundedness | 3.30 | 3.40 | 0.10 |
| context_utilization | 3.43 | 3.50 | 0.07 |
| hallucination | 3.77 | 3.80 | 0.03 |
| instruction_following | 3.57 | 3.30 | -0.27 |
| pedagogical_usefulness | 3.17 | 3.23 | 0.07 |
| actionability | 3.47 | 3.50 | 0.03 |
| conciseness | 4.00 | 4.00 | 0.00 |
| japanese_quality | 3.93 | 3.97 | 0.03 |

Hard pass: 1 → 1. Median latency: 6171 → 6529 ms. p95: 15855 → 18619 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":false,"qualityCI":false,"latency":true}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 30 pairs, win rate 0.5333333333333333. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- sm-additional #1: candidate win=0.5. A: 正確性 4/4。3回・1500msを端的に回答。 B: 正確性 4/4。3回・1500ミリ秒を正しく端的に回答。。正確さと指示遵守を優先して比較。

- sm-explain #2: candidate win=0.5. A: 正確性 4/4。input[1,2,3,4]とoutput[4,16]を二文で説明。 B: 正確性 4/4。inputと最終outputを区別し、filter→mapを簡潔に説明。。正確さと指示遵守を優先して比較。

- sm-compare #0: candidate win=0.5. A: 正確性 2/4。Mapでなく配列mapの説明へ逸れる。findを選ぶ結論だけは適切。 B: 正確性 2/4。findと配列mapの比較へ逸れMapを説明しない。。正確さと指示遵守を優先して比較。

- sm-format #2: candidate win=1. A: 正確性 4/4。4桁パディングとSKU-0027を正答。 B: 正確性 4/4。SKU-0027は正答。「前接辞」はやや不自然。。正確さと指示遵守を優先して比較。

- sm-additional #0: candidate win=1. A: 正確性 4/4。初回を含む3回、750×2=1500msを正答。 B: 正確性 3/4。3回と750ms×2は正しいが合計1500msを書かない。。正確さと指示遵守を優先して比較。

- sm-price #0: candidate win=1. A: 正確性 3/4。170は正しいが税抜価格・円という未提示の意味を付加。 B: 正確性 4/4。170と0.85倍を説明。15%減は数式に沿った言い換え。。正確さと指示遵守を優先して比較。

- sm-boundary #2: candidate win=0.5. A: 正確性 3/4。範囲外アクセスは正しいがNaNへ至る説明は不足。 B: 正確性 3/4。範囲外アクセスの指摘は正しい。NaNまでの説明は不足。。正確さと指示遵守を優先して比較。

- sm-learn #0: candidate win=0. A: 正確性 3/4。再利用とエラー処理の二つを提示し、一つという依頼を外す。 B: 正確性 2/4。型推論とジェネリクスの二つを挙げ、文字列挨拶関数に汎用型を持たせる理由が弱い。。正確さと指示遵守を優先して比較。

- sm-explain #1: candidate win=0.5. A: 正確性 4/4。inputとoutput[4,16]、処理順が正しい。 B: 正確性 4/4。inputとoutput[4,16]を正しく説明。。正確さと指示遵守を優先して比較。

- sm-boundary #1: candidate win=0.5. A: 正確性 3/4。添字範囲は正しいがundefined加算によるNaNは説明していない。 B: 正確性 3/4。i<=lengthによる範囲外を指摘。undefined/NaNの説明は不足。。正確さと指示遵守を優先して比較。

- sm-tail-helper #2: candidate win=0.5. A: 正確性 2/4。filter→mapは正しいが存在しない14を結果に追加。 B: 正確性 2/4。冒頭の[10,14,16]は誤答。後段の[10,16]と自己矛盾し、結論として使えない。。正確さと指示遵守を優先して比較。

- sm-learn #2: candidate win=0. A: 正確性 4/4。デフォルト引数を一つ提案し、理由と小さな練習を提示。 B: 正確性 3/4。再利用と型明示の二つで、一つの次の学びという依頼を外す。。正確さと指示遵守を優先して比較。

- sm-unknown #2: candidate win=1. A: 正確性 2/4。必要な戻り値の長さには触れるが、存在しない追加文脈にあると述べる。 B: 正確性 3/4。必要な戻り値の長さを一つだけ挙げ、件数を捏造しない。。正確さと指示遵守を優先して比較。

- sm-additional #2: candidate win=0.5. A: 正確性 4/4。初回込み3回と1500msの算術が正しい。 B: 正確性 4/4。3回と1500msを正答。。正確さと指示遵守を優先して比較。

- sm-compare #1: candidate win=0.5. A: 正確性 2/4。Mapを配列mapと取り違え、依頼した比較になっていない。 B: 正確性 2/4。Mapを配列mapと混同する。findの選択だけは妥当。。正確さと指示遵守を優先して比較。

- sm-tail-helper #0: candidate win=0.5. A: 正確性 2/4。filter→mapは正しいが入力にない9に対応する18を追加。 B: 正確性 2/4。filterと倍化の説明は正しいが、存在しない18を結果に追加。。正確さと指示遵守を優先して比較。

- sm-boundary #0: candidate win=0.5. A: 正確性 3/4。範囲外の指摘は正しいがNaNの説明を欠く。 B: 正確性 3/4。範囲外アクセスは正しいがundefined/NaNへの言及が不足。。正確さと指示遵守を優先して比較。

- sm-hint #1: candidate win=1. A: 正確性 1/4。必要なawaitでなく既存asyncだけを提案。 B: 正確性 3/4。awaitを含むがasyncも挙げ、キーワード一つの条件を外す。。正確さと指示遵守を優先して比較。

- sm-format #1: candidate win=0.5. A: 正確性 4/4。SKU-0027とゼロ埋めの説明が正しい。 B: 正確性 4/4。4桁パディングとSKU-0027が正しい。。正確さと指示遵守を優先して比較。

- sm-tail-helper #1: candidate win=0. A: 正確性 2/4。冒頭の[10,16,18]と後段の[10,16]が矛盾。配列に余計な18を追加。 B: 正確性 4/4。5,8を抽出し10,16へ倍化する流れが正しい。。正確さと指示遵守を優先して比較。

- sm-hint #2: candidate win=0. A: 正確性 4/4。await一語は求められた適切なヒント。 B: 正確性 3/4。awaitは関連するがasyncも提示し一語の依頼を守らない。。正確さと指示遵守を優先して比較。

- sm-price #1: candidate win=1. A: 正確性 3/4。170は正しいが未提示の税抜価格という意味を追加。 B: 正確性 4/4。200×0.85=170を未提示の税制解釈なく説明。。正確さと指示遵守を優先して比較。

- sm-learn #1: candidate win=0. A: 正確性 2/4。再利用と型の強制を挙げ、理解済み内容からの発展と練習との対応が弱い。 B: 正確性 3/4。制御フローの理由と条件分岐の練習は適切。条件分岐とループを併記。。正確さと指示遵守を優先して比較。

- sm-price #2: candidate win=0.5. A: 正確性 4/4。170と85%への変換を正しく説明。 B: 正確性 4/4。200×0.85=170をコードの計算として直接説明。。正確さと指示遵守を優先して比較。

- sm-compare #2: candidate win=0.5. A: 正確性 2/4。find選択は妥当だがMapとmapを混同し、配列操作が必要とも余計に断定。 B: 正確性 2/4。Mapではなく配列mapを後で使うと説明し比較を外す。。正確さと指示遵守を優先して比較。

- sm-unknown #1: candidate win=1. A: 正確性 3/4。必要な戻り値の長さを一つ挙げ、件数は推測しない。 B: 正確性 3/4。必要な戻り値の長さを挙げるが表示件数との対応は未確認。。正確さと指示遵守を優先して比較。

- sm-explain #0: candidate win=0.5. A: 正確性 4/4。inputと最終outputを正確に二文で説明。 B: 正確性 4/4。inputの値とfilter→mapによる[4,16]を正しく説明。。正確さと指示遵守を優先して比較。

- sm-hint #0: candidate win=1. A: 正確性 3/4。awaitに触れるがasyncも挙げて一つのキーワードに絞らない。 B: 正確性 1/4。既存のasyncのみで必要なawaitを示さない。。正確さと指示遵守を優先して比較。

- sm-unknown #0: candidate win=0. A: 正確性 3/4。データ内容が必要と認め、件数や特定の保存先を断定しない。 B: 正確性 3/4。戻り値の長さを求める点は適切だが、readRecordsと表示件数の関係は未確認。。正確さと指示遵守を優先して比較。

- sm-format #0: candidate win=0.5. A: 正確性 4/4。ゼロ埋めと接頭辞、SKU-0027を正しく説明。 B: 正確性 4/4。SKU-0027と4桁のゼロ埋めを正しく説明。。正確さと指示遵守を優先して比較。
