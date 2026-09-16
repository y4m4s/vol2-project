# 小〜中規模を優先する追加ラウンド

後続修正: 全文取得はLM Studio／Ollamaのみに限定。Copilot／OrcaRouter／provider未指定は従来の選択・表示範囲・fallback取得を使う。以下の実験結果とfreezeはその前の履歴として保持し、書き換えない。ローカルモデルの取得方針・prompt・samplingはこの切り分けで変更していない。

## 事前に固定する範囲（2026-09-16）

- 小: 数行〜約100行。中: 今回は1ファイル8,000文字以内、関連情報は少数ファイル/短い仕様で完結する課題。プロジェクト全体の行数は品質保証の指標にしない。
- 8,000文字はCollectorの既存上限に合わせた検証範囲であり、モデルのtoken上限や全中規模コードの品質保証ではない。
- 10 tuning cases ×3 repeats。新しいholdout 6件は候補固定後のみ実行し、その回答を見て変更しない。
- 初期baselineは前回コミット済みのcontext/numeric修正。sampling/Thinking/一般指示は維持。
- Collectorの表示範囲をfixtureに明記し、Judgeには利用者が編集中の全文を提示する。欠落した入力をモデル能力の誤りと混同しない。
- 判定基準は既存rubric v2、9軸、機械判定先行、ケース単位bootstrap、A/B順序ランダム、Codexの非独立性を開示。

## 事前仮説と順序

1. まずOllama既存経路とnative経路を同じ入力で検証し、4K/8K実割当と処理token量の差を調べる。global設定は変更しない。
2. 同一backend設定で、選択なし・全文8,000文字以内の場合に表示範囲でなく全文を取得する案を比較する。大きいファイルと明示選択は従来の範囲を維持。採用にはCollector→Planner→Promptの回帰確認も必要。
3. 入力を与えても残る失敗カテゴリがあれば最小の指示変更を1つ検証。一般的なヒント指示・仕様メモの無制限追加は繰り返さない。
4. 各段階で棄却・採用理由、速度、軸別退行、次仮説を記録。3回連続で明確な改善がなければ探索停止。

Ollama仕様確認: [chat](https://docs.ollama.com/api/chat)、[loaded models](https://docs.ollama.com/api/ps)、[context length](https://docs.ollama.com/context-length)。実測値を優先する。

## 実行順の補足（候補の回答を採点する前）

LM Studioが起動したため、まずLM Studioで全文取得のA/Bを実行する。Ollamaは続けて直列に測定し、両backendの同時推論による競合を避ける。Ollama診断はsm-format（6,572文字）、sm-explain（短いコード）、sm-additional（短い仕様）の固定3件を各3回、OpenAI互換→native 4K→native 8Kの順に測る。全文取得・生成設定は同じにし、経路差とcontext差を分離する。小標本の速度測定はcold load/cacheの影響も明記する。

追加sampling候補は全文取得と同じ入力でtemperature=0.2のみを指定する。前回のThinking/公式preset一括変更では明確な改善がなかったため、その探索を繰り返さず、今回残った短い入力での出力変動を1変数で確認する。backend既定temperatureは未確認であり、0.2を公式推奨値とは扱わない。旧holdoutの再利用・期待答えのprompt注入はしない。

## Holdout前の選択

- 全文取得だけを残す。明示選択は拡張しない。8,000文字超のファイルは既存viewport/fallbackを維持する。
- 全文取得A/Bは勝率68.3%、ケースbootstrap95%CI 55.0–81.7%。中央値4.56→6.17秒（35.4%増）、p95 10.98→15.86秒。入力不変の21回答は中央値4.50→4.33秒で、遅延は主に追加情報が届いた9回答で増加。decode速度は15.72→15.61 tokens/sec。
- 通常の25%速度gateは不合格と記録する。全体の無条件Championとは扱わず、ユーザーが重視した小〜中規模での確定した情報欠落の修正として限定採用する。追加された入力と回答の生成に伴う約1.61秒の中央値増を明示し、速度向上は主張しない。判定基準の閾値は変更しない。
- temperature=0.2は不採用。勝率53.3%、CI38.3–65.0%、critical-axis gate不合格。誤った配列値を安定して繰り返す場合があった。
- Ollama経路変更は勝率44.4%、4K→8Kは55.6%で明確な品質向上なし。3ケース×3反復の全入力token数は4K/8Kで一致。短い配列問題も全条件で誤るため、この誤答をcontext不足とはしない。native経路・context増量は本番採用しない。
- sampling、native transport、context拡大の3候補に明確な改善がなく、探索を停止。今の結果だけでモデル能力のみが原因とは断定しない（provider templateと指示差の影響は未分離）。
- この選択とソースを固定して新holdoutをLM Studio/Ollama各1回評価する。内容を見た後はprompt/設定/Collectorを調整しない。

## 結果の要約

**採用したのは小さいアクティブファイルの取得漏れ修正だけ。小〜中規模の全タスクの精度保証は未達。**

8生成run・129回答（LM Studio tuning 90、Ollama診断27、holdout12）、4組78ペアの比較を保存した。モデルは両方Qwen3 8B / Q4_K_Mだが、重み・template・provider別のdepth指示を同一視しない。

### 全文取得で変わったこと

| ケース | viewport（各3回） | 全文取得（各3回） |
|---|---|---|
| 200を0.85倍する関数が画面外 | 170を答えられない: 3/3 | 170に正答: 3/3。ただし2回答で未提示の税抜価格という意味を付加 |
| ゼロ埋め関数が画面外（6,572文字） | SKU-0027を答えられない: 3/3 | SKU-0027に正答: 3/3 |
| filter→mapの定義が画面外 | 実装不明・元配列を返すと誤推測 | [10,16]に正答1/3、存在しない14や18を加える誤答2/3 |

必要な定義の送信率は対象9回答で0/9→9/9。これは送信前の機械検査で確認した事実。最終回答の正しさや幻覚解消とは別に扱う。残り7ケースのwire promptは不変なので、その回答差を取得修正による改善とはしない。

9軸（0〜4）の平均差: correctness +0.63、groundedness +0.10、context utilization +0.83、hallucination +0.17、instruction following +0.53、pedagogical usefulness +0.37、actionability +0.40、conciseness +0.07、Japanese quality +0.07。平均で悪化した軸はないが、個別には4敗。非独立Judge・10ケース・非固定samplingの範囲の結果であり一般化しない。

最終Hard Checkは30/30同士。ただし全文取得runの入力不変ケースで2回、temperature runで1回、既存の形式修復が発生した。初回の形式不正・求めていない実装コードも`attempts`に保持し、修復後成功で隠さない。遅延にはその再送も含まれる。

[全文取得の比較](results/sm-context-comparison/report.md)、[temperatureの棄却結果](results/sm-temperature-comparison/report.md)。

### Ollama：割当と速度を分離

| 経路 | 実context | 入力tokens（コード長め／短いコード／短い仕様） | 中央値 | p95 | decode tokens/sec |
|---|---:|---|---:|---:|---:|
| 既存OpenAI互換 | 4,096 | 3,385 / 631 / 657 | 7.80秒 | 28.01秒 | 未取得 |
| native | 4,096 | 同じ | 8.61秒 | 19.46秒 | 14.52 |
| native | 8,192 | 同じ | 9.51秒 | 39.06秒 | 12.23 |

実割当は`/api/ps`で確認。prompt本文hashと処理token数が全反復で一致した。8K側には最大8.96秒のload時間が含まれる。直列ブロック実行で順序・cacheを相殺していないため、精密な速度優劣は未確定。モデル最大context長を実割当として扱っていない。

この3ケースのcorrectness平均と中央値による観測Pareto frontierは既存4K経路。これは全9軸・全用途で4Kが最適という意味ではない。native 4K/8Kの小さな点差は文字列変換の説明などであり、短い配列のoutputを[4]とする誤答は全経路・全反復で残った。

アプリの概算入力予算8,000とOllama実割当4,096の一般的な不整合は未修正。今回測定した入力はその上限より小さく、context拡大がこの誤答を解消する証拠はなかった。日本語を多く含む別入力、複数ファイル、長い出力について安全に収まるとは保証しない。処理token数は完全な送信内容が保持されたことの厳密な証明でもない。

[経路比較](results/sm-oll-transport-comparison/report.md)、[4K/8K比較](results/sm-oll-context-comparison/report.md)、[再計算可能な集計](results/sm-summary.json)。

### 新holdout：両backendで主要要件4/6、形式6/6

| ケース | LM Studio | Ollama（既存経路、実4K） |
|---|---|---|
| 画面外のclampScore | 10に正答 | 10に正答 |
| 画面外のtag | #abcに正答 | #abcに正答 |
| 重複語の除去 | kiwi,pearに正答 | kiwi,pearに正答 |
| 未提示の出力形式 | CSVと断定しない | CSVと断定しない |
| 文字列falseの真偽 | ifがboolean型を前提とするという誤説明 | 空文字の例外を無視して文字列は常に真と誤説明 |
| 25件・12件/ページ | 求める3ページ・最終1件を回答せず、計算を促す | 必要ページ数を2と誤算（正しくは3） |

holdoutの各回答・9軸・失敗理由: [LM Studio](results/sm-lm-file-holdout/assessment.json)、[Ollama](results/sm-oll-file-openai-holdout/assessment.json)。旧holdoutの3/6とは別の問題群なので、3/6→4/6という改善率は算出しない。新holdoutのviewport baselineは未取得。

## 最終状態と次に確認すること

- 現在の採用範囲: 前回のcontext/numeric修正 + 今回の8,000文字以内・非選択ファイルの全文取得。sampling/Thinking/出力上限/provider経路/global設定/モデルファイルは変更していない。サンプリング等の試験値はeval config内のみ。
- Collector→Planner→Promptを通すテストで、画面外の定義保持・除外設定・選択範囲・大きいファイル・workspace外の境界を確認。これはmock VS Codeの統合テストであり、実エディタ上の全フローを実測したものではない。
- 正確さの残る障害: 入力があるのに値を追跡し損ねる、仕様を過度に一般化する、直接回答すべき質問にもヒントで返す。単なる入力不足と区別して記録した。
- 次は、別の未使用holdoutを確保した上で、短いコードだけの診断とNaviComの指示付き診断を比較し、モデル能力と指示干渉を分離する。少数ファイル間の定義取得・明示選択時の依存コードは今回未改善。独立Judgeや比較モデルも未使用。
- 129回答と棄却理由を保持し、holdoutを見た後の調整はしない。新しい未検証設定を本番へ追加しない。

検証完了: 本体238テスト、評価基盤10テスト、lint、変更したevalスクリプトの構文確認、git diff --checkが成功。8runの129回答、4packetの採点・hash、12holdout評価と固定ソースの整合性を検証。変更対象94ファイルの個人ディレクトリ/認証情報パターン検査は該当0。全種類の秘密情報を検出できる保証ではない。コミット・pushは実施していない。
