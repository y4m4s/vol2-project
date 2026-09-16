# Pairwise evaluation

Baseline: eval/results/sm-lm-viewport

Candidate: eval/results/sm-lm-file

Split: tuning; judge: Codex-manual

Win rate (ties=0.5): 0.683; case bootstrap 95% CI [0.550, 0.817]; ties 11/30.

| Axis | Baseline | Candidate | Delta |
|---|---:|---:|---:|
| correctness | 2.43 | 3.07 | 0.63 |
| groundedness | 3.20 | 3.30 | 0.10 |
| context_utilization | 2.60 | 3.43 | 0.83 |
| hallucination | 3.60 | 3.77 | 0.17 |
| instruction_following | 3.03 | 3.57 | 0.53 |
| pedagogical_usefulness | 2.80 | 3.17 | 0.37 |
| actionability | 3.07 | 3.47 | 0.40 |
| conciseness | 3.93 | 4.00 | 0.07 |
| japanese_quality | 3.87 | 3.93 | 0.07 |

Hard pass: 1 → 1. Median latency: 4559 → 6171 ms. p95: 10985 → 15855 ms.

Gates: {"noNewHardFailures":true,"criticalAxes":true,"qualityCI":true,"latency":false}

Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.

Scores above are end-to-end delivery. Infrastructure-excluded semantic comparison: 30 pairs, win rate 0.6833333333333333. 0 transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.

## Cases

- sm-format #0: candidate win=1. A: SKU-0027と4桁のゼロ埋めを正しく説明。 B: 定義の確認を求め、求められた文字列を回答できない。

- sm-format #2: candidate win=1. A: 定義の確認に留まり文字列が不明。 B: SKU-0027は正答。「前接辞」はやや不自然。

- sm-learn #0: candidate win=0. A: デフォルト引数を一つ選び、理由と未解答の練習を示す。 B: 再利用とエラー処理の二つを提示し、一つという依頼を外す。

- sm-hint #1: candidate win=0. A: asyncは既にあり、必要なawaitに向かうヒントにならない。 B: awaitに触れるがasyncも挙げ、キーワード一つの依頼に反する。

- sm-compare #2: candidate win=0.5. A: find選択は妥当だがMapとmapを混同し、配列操作が必要とも余計に断定。 B: findは選ぶがMapの比較を配列mapの説明に取り違える。

- sm-unknown #2: candidate win=0.5. A: 存在しない追加文脈の実装を参照し、必要情報も二つ挙げる。 B: 必要な戻り値の長さには触れるが、存在しない追加文脈にあると述べる。

- sm-explain #2: candidate win=1. A: 最終値は正しいが、中間[2,4]をoutputの値と表現し初心者には紛らわしい。 B: inputと最終outputを区別し、filter→mapを簡潔に説明。

- sm-hint #2: candidate win=1. A: 必要なawaitでなく既存asyncだけを提案。 B: await一語は求められた適切なヒント。

- sm-compare #1: candidate win=0. A: Mapを配列mapと取り違え、依頼した比較になっていない。 B: findを選ぶ理由は妥当だが、Mapとの比較や少数件条件の説明が不足。

- sm-price #0: candidate win=1. A: 不足を認めるが、ファイル内の定義が届かず値を答えられない。 B: 170は正しいが税抜価格・円という未提示の意味を付加。

- sm-tail-helper #1: candidate win=1. A: summarizeを恒等関数と捏造して[2,5,8]と誤答。 B: 5,8を抽出し10,16へ倍化する流れが正しい。

- sm-boundary #1: candidate win=0.5. A: 添字範囲は正しいがundefined加算によるNaNは説明していない。 B: 範囲外アクセスは指摘するがtotalへの影響が不足。

- sm-learn #1: candidate win=1. A: 二つの学習項目と「型の強制」が曖昧で、練習との対応も弱い。 B: 制御フローの理由と条件分岐の練習は適切。条件分岐とループを併記。

- sm-compare #0: candidate win=0.5. A: findと配列mapの比較へ逸れMapを説明しない。 B: Mapでなく配列mapの加工を説明。

- sm-format #1: candidate win=1. A: 定義を探すよう求めて最終値を示せない。 B: 4桁パディングとSKU-0027が正しい。

- sm-unknown #1: candidate win=1. A: 必要な戻り値の長さを挙げるが表示件数との対応は未確認。 B: renderの契約なしで配列長が表示件数と断定し、情報も二つ提示。

- sm-tail-helper #2: candidate win=1. A: 実装を捏造して元配列を返すと断定。 B: filter→mapは正しいが存在しない14を結果に追加。

- sm-unknown #0: candidate win=0.5. A: 求める情報として戻り値の長さを一つ挙げ、件数は推測しない。 B: データ内容が必要と認め、件数や特定の保存先を断定しない。

- sm-explain #0: candidate win=0.5. A: inputの値と偶数の二乗[4,16]を正しく説明。 B: inputの値とfilter→mapによる[4,16]を正しく説明。

- sm-learn #2: candidate win=1. A: デフォルト引数を一つ提案し、理由と小さな練習を提示。 B: 型推論は適切だが引数の型注釈を全て外す課題は暗黙anyになり得る。型 inferenceも不自然。

- sm-boundary #2: candidate win=1. A: 範囲外は正しいが、この式で例外になるような曖昧な説明。 B: 範囲外アクセスの指摘は正しい。NaNまでの説明は不足。

- sm-price #1: candidate win=1. A: 170は正しいが未提示の税抜価格という意味を追加。 B: netPriceの確認だけで170を答えられない。

- sm-hint #0: candidate win=0.5. A: 既存のasyncのみで必要なawaitを示さない。 B: 既存のasyncのみで必要なawaitを示さない。

- sm-explain #1: candidate win=0.5. A: inputとoutput[4,16]、処理順が正しい。 B: inputと偶数の二乗[4,16]を2文で正しく説明。

- sm-tail-helper #0: candidate win=0.5. A: 具体的な結果を示さず、処理内容を一般論で補う。 B: filter→mapは正しいが入力にない9に対応する18を追加。

- sm-additional #0: candidate win=0. A: 3回と1500ミリ秒を明示。 B: 3回と750ms×2は正しいが合計1500msを書かない。

- sm-price #2: candidate win=1. A: 実装不足として値を答えず、税率などを可能性として挙げる。 B: 200×0.85=170をコードの計算として直接説明。

- sm-additional #1: candidate win=1. A: 3回・1500msは正しいが既知の仕様を再確認させる余分な文。 B: 3回・1500msを端的に回答。

- sm-boundary #0: candidate win=0.5. A: 範囲外アクセスは正しいがundefined/NaNへの言及が不足。 B: 範囲外アクセスは正しいがundefined/NaNへの言及が不足。

- sm-additional #2: candidate win=0.5. A: 初回込み3回と1500msの算術が正しい。 B: 初回込み3回と1500msの算術が正しい。
