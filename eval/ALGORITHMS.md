# アルゴリズム問題の評価（事前設計）

## 対象と固定条件

- PythonとJavaScriptを同じ問題・制約・例で評価する。TypeScript固有の型検査はこのセットの対象外。
- 実装は8,000文字以下。巨大プロジェクトの検索でなく、問題の理解、境界条件、計算量、適切なヒント、正解済みコードへの不要な介入を測る。
- 既存の実利用に近い自動課題達成シナリオ（`src/eval/taskCompletionScenarios.ts`）の「正解なら沈黙／不足ならヒント」を継承する。既存の出力配置問題の正答率をアルゴリズム能力と混同しない。
- 新しいalgorithm tuning/holdoutを固定し、既存small-medium holdoutは再利用しない。同一問題の修正版・言語違いは同じproblemIdにまとめ、splitをまたがせない。
- tuningは各case 3反復。LM Studio/Ollamaの現行設定をBaselineにする。global設定・モデルファイルは変更しない。
- 最初の候補は問題文の構造化のみ。問題・制約・入出力例の内容を維持して区別し、模範解答・反例・oracle結果はモデルに渡さない。sampling/Thinking/出力枠は固定。
- baselineを確認してから候補を実行・比較する。候補選択後に新holdoutを一度確認し、その応答を見て調整しない。

## 正しさの根拠

評価用に作成・レビューしたfixtureだけを別プロセスで実行する。Pythonはisolated mode、Nodeは小さいheap、両方に実行時間・出力量上限を付ける。これは任意のユーザーコードを安全に実行できるOS sandboxではない。モデル回答や実workspaceのコードは実行しない。

独立した単純なoracleと小さい入力の全列挙・境界入力を照合し、実装の実際の出力、最初の反例、テスト範囲を保存する。小さい領域での全成功を全入力での正しさの証明とはしない。計算量の漸近評価・説明の妥当性は別途レビューする。

機械判定はJSON形式、途中打切り、明示された回答形式、禁止された完成式、automaticの期待focusを先に確認する。説明文全体の正しさを単語一致で自動認定しない。9軸と失敗理由、A/B比較、速度を保存する。Judgeには実行で検証した参照情報を渡すが、候補には渡さない。

## ヒントの基準

キーワード/API名の提案は許容。具体的な置換式・完成コードはヒント依頼では減点する。入力例に対する現在の値・問題の期待値を答えることは、実装の完成コードの提示とは区別する。アルゴリズム名を禁じる場合は、そのcaseの質問に明示する。

## 再現・判定

ケース、fixture、oracle/worker、rubricのhashを保存。Python/Nodeのversionを記録し、個人用の実行ファイルパスは保存しない。採否は既存rubricのgateと問題単位bootstrapで判断し、false positive（正しい実装への誤指摘）とfalse negative（欠陥を見逃す）を別集計する。Python/JavaScript、provider、variant、問題分類ごとにも分ける。

### ケース構成

| split | 問題 | 観点 |
|---|---|---|
| tuning | 総和（正解・末尾欠落・未完成） | 不要な介入／欠陥検出／次の一歩 |
| tuning | lower_bound | 重複と探索区間、具体的な戻り値 |
| tuning | 文字の頻度集計 | 更新の誤りをヒントだけで説明 |
| tuning | 和が一致する2要素 | 和とポインタ移動の関係 |
| tuning | 和が一致する添字の組数 | 計算量、制約、重複の扱い |
| tuning | 未定義のtransform | 根拠のない計算量断定を避ける |
| holdout | 区間和、最短距離、階段の数え上げ、数値ソート | 別の問題への適用、正誤の識別 |

各splitは8変種×2言語=16ケース。独立した問題群はtuning 6、holdout 4であり、32の独立問題と数えない。すべて本評価向けのオリジナル問題で、実サービスの問題やユーザーの解答の転載ではない。

### 実行手順

NodeとPython 3が必要。PythonがPATHにない場合は`NAVICOM_EVAL_PYTHON`に実行ファイルを指定できる。この環境変数の値は成果物に保存しない。

```powershell
npm run test:quality-eval
node eval/run.mjs --suite algorithms --config eval/configs/alg-lm-baseline.json --repeat 3 --out eval/results/new-alg-baseline
node eval/run.mjs --suite algorithms --config eval/configs/alg-lm-sections.json --repeat 3 --out eval/results/new-alg-sections
node eval/compare.mjs --baseline eval/results/new-alg-baseline --candidate eval/results/new-alg-sections --out eval/results/new-alg-comparison
# blind.jsonだけをJudgeに渡し、judgments.jsonに9軸・理由・比較判定を記録
node eval/report.mjs --comparison eval/results/new-alg-comparison --judgments eval/results/new-alg-comparison/judgments.json
node eval/algorithm-report.mjs --runs eval/results/new-alg-baseline,eval/results/new-alg-sections --comparisons eval/results/new-alg-comparison --out eval/results/new-alg-summary.json
```

Ollamaは`alg-oll-baseline.json` / `alg-oll-sections.json`を使用。providerは同時実行せずGPU競合を避ける。採否の固定後だけ、選んだconfigで`--split holdout --confirm-holdout`を追加して実行する。Judge未評価の軸はnullとし、Hard Checkの通過率を意味的な正答率に置き換えない。

`cases.json`に実装・実行環境version・検査範囲・反例、`responses.json`に実際の送信と回答、`rubric.md`にそのrunの基準を保存する。ブラインド比較も保存済みrubricを使用し、基準の違うrunは拒否する。既存の過去結果は変更しない。

評価の入力はcollector直後のスナップショット。問題文は追加コンテキストとして与える。実行可能な完成式の提示は文章でもJudgeが確認する（コードフェンスの機械チェックだけでは検出できない）。問題文の見出し追加は評価用コントロールであり、自由入力された問題文を本番アプリが自動抽出・変換できるという意味ではない。
