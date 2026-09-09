# 15. 自動助言のフォーカス判定と観測情報

確認日: 2026-09-09。導入コミットは `31a13d5e983c261b2584766d58c18f0f31c6713c`（自動助言のフォーカス判定と観測情報を追加）。本書は同コミット以降の修正も含む現行実装を説明する。

関連PR: [#44](https://github.com/y4m4s/vol2-project/pull/44#issue-5383281790)。ユーザー提供のPR本文を確認し、ローカルのコミット、現行ソースコード、既存テストと照合した。

## 目的と適用範囲

追加コンテキストや既存関数の解説に自動助言が偏り、直近の編集に必要な支援が届きにくい問題を改善する。

常時モード（`GuidanceKind: "always"`）で、編集・カーソル・選択範囲・診断の観測情報から、今返す助言の役割を1つだけ選ぶ。ここでいう「自動フォーカス」は助言内容の分類を指し、エディタのカーソルや入力フォーカスを移動する機能ではない。

判定と回答は同じAIリクエストで行う。専用の分類API呼び出しは追加しない。手動相談・文脈付き相談には自動フォーカスの応答契約を適用しない。プロバイダー共通の生成経路を使うため、[4種類の接続先](provider/README.md)で同じ仕組みを利用する。

PR本文の対象接続先はCopilot・LM Studio・OrcaRouterの3種類だが、現行コードではOllamaも共通経路を使う。手動相談・文脈付き相談の応答は従来の `{"kind":"advice","text":"..."}` を維持する。一時的な構文不完全を欠陥扱いしない共通指示と、リクエスト終了時の排他ロック解放順序は手動側にも適用される。

## フォーカスの種類

| 内部値 | 表示名 | プロンプトで指定する判断・回答方針 |
|---|---|---|
| `continue` | 次の一手 | 編集後に手が止まった場面で、カーソル直前・周辺から次に必要な判断や処理を1つ示す。完成コードを代行しない |
| `review` | レビュー | 直近の変更で生じた具体的なリスクを、場所と成立条件を添えて1つ示す。一時的な書きかけの構文を欠陥扱いしない |
| `explain` | 解説 | 選択中・確認中と判断できる式、関数、データの流れに絞って説明する。コピー目的の選択など意図が弱ければ発話しない |
| `overview` | 全体像 | 局所的な助言では足りず、提供コードから入口・処理・出力を説明できる場合に限って短く整理する |
| `none` | 発話なし | 根拠が弱い、矛盾する、同じ説明の繰り返し、見た目だけの変更などでは回答を表示しない |

具体的な変更リスク・新しい持続的な診断、編集箇所から離れた意味のある選択、カーソル付近の編集を順に考慮するようAIへ指示する。ただし、固定条件による決定木ではなく、最終選択はAIが行う。停止時間だけで「詰まっている」と断定せず、ファイルを開いただけなら通常は `none` を選ぶ。

追加コンテキストは背景・制約としてのみ使い、それが存在するだけで解説・要約を始めない。推論強度が高でもフォーカスを混在させず、選んだ1種類の助言に理由や条件を補う。[低／高の仕様](11-assistance-depth-modes.md)と併せて適用する。

## 発火と待機

`AdviceScheduler` が `editor_change`、`text_edit`、`selection_change`、`diagnostics_change` を集約する。同じ理由は最新の時刻へ更新し、最大5件まで保持する。エディタ切り替え時は前のファイルのシグナルを捨てる。

発火には常時モード・接続済み・一時停止なし・他のリクエストなしが必要で、操作後のアイドル待ちと前回発火からのクールダウンを両方満たす。設定の既定値はアイドル10秒、リクエスト間隔60秒。日次トークン上限や送信できる文脈の有無はController側でも確認する。

- 選択範囲を伴わないカーソル移動は、新規の自動助言を発火させない。既存の保留があればアイドル待ちを延長する。
- チャット入力中はタイマーを止めて保留を保持し、入力終了時からアイドル待ちを再開する。
- 発火時にシグナルをイベントへ渡してクリアする。一時停止、手動モードへの変更、切断、キャンセルでも保留を破棄する。
- クールダウンは回答表示時ではなく発火時から数える。`none` でも待機制御の対象になる。

## 観測情報

`ContextCollector.collectAutomaticObservation()` がアクティブなワークスペース内ファイルから同期的に収集し、関連ファイルの非同期収集前の文脈と対応させる。

| 項目 | 内容・制限 |
|---|---|
| `triggerReasons` / `idleDurationMs` | 集約した発火理由と最後の操作からの停止時間 |
| `cursor` | 1始まりの行・列 |
| `cursorExcerpt` | 前12行・後8行の範囲からカーソル前後それぞれ最大1,400文字を取り、`<<<NAVICOM_CURSOR>>>` を挿入 |
| `selectionPresent` / `selectionLineCount` | 選択の有無と選択行数。選択本文は通常の文脈で扱う |
| `lastEdit` | 直近編集の行範囲、変更行数、挿入・削除文字数、変更前後の抜粋、カーソルとの行距離 |
| `diagnostics` | 先頭100件の診断を観測し、基準時点から追加された診断を最大5件、各メッセージ最大500文字で渡す。解消・残存件数もこの観測範囲内の値 |
| `previousFocus` | Controllerがファイル単位で保持する前回のフォーカス |
| `overviewAlreadyShown` | 同じファイル・文書バージョンで全体像を表示済みか |

コードにカーソルマーカーと同じ文字列があればリテラル表記へ置き換える。巨大な行でもカーソル付近を残す。編集記録の保持期間は5分で、取得できない変更前の本文を推測しない。対象エディタがない場合は観測情報を作らない。

## 送信予定とプロンプト

`RequestPlanner` は常時モードだけに「自動判断情報」カテゴリを追加する。アクティブファイルが保護済み・追加の除外globに一致する場合は、カーソル周辺や編集抜粋を含む観測情報全体を送信対象から外す。

`PromptBuilder` は観測情報を参照データ側に配置し、制御指示と分離する。カーソル周辺を広いファイル抜粋より先に配置し、モデルの入力予算内で縮める。観測が欠けている場合は意図を創作せず、具体的な根拠がなければ `none` を選ぶよう指示する。

送信予定のカテゴリ・参照ファイルは実際にプロンプトへ入ったブロックと照合する。詳細は [送信予定と実際の送信内容](request-plan-transmission.md) を参照する。

## 応答契約と発話なし

常時モードの応答は次のいずれかのJSONとする。

```json
{"kind":"advice","focus":"continue","text":"次に確認する観点を日本語で記述"}
```

```json
{"kind":"no_advice","focus":"none"}
```

`advice` のfocusは `continue` / `review` / `explain` / `overview` のいずれかで、空の本文は不可。`no_advice` は `none` のみで、本文を付けない。余分なキー、未知のfocus、focusの欠落、手動相談へのfocus混入は `GuidanceResponsePolicy` で拒否する。

形式不正の場合は共通の修正再生成を最大1回行う。このため「判定用の追加呼び出しはない」ことと、常に通信が1回で終わることは同義ではない。

`no_advice` は成功として処理し、回答カード・会話エントリ・新規会話を作らない。生成自体は実行しているため取得できた利用量は記録する。フォーカス判定の妥当性はAIの出力品質に依存し、JSON検証だけで意味的な正しさを保証するものではない。

## 古い結果と重複の抑止

収集開始時に文書URI・バージョン・選択のanchor/active位置をスナップショット化する。非同期収集後または生成成功後に変化していた場合は、その古い結果を表示・保存しない。生成済みの利用量は残る。失敗応答は古い成功回答と同様には捨てず、利用制限などのエラーと接続状態を反映する。

現行実装では、同じ文書バージョンのままカーソルだけが移動した場合、元のシグナルをアイドル待ちへ再予約できる。新しい保留がある場合はそちらを優先し、編集で文書バージョンが変わった場合や別ファイルへ移った場合に古いシグナルを再利用しない。この再予約処理は指定コミット後の実装も含む。

PRレビューで修正した終了順序も維持する。`executeGuidanceRequest` の `finally` で排他ロックを解放してから `idle` に戻し、生成中の編集による次の保留を実行できるようにする。また、新規会話作成でキャッシュが初期化されるため、表示する回答の保存後に前回focus・全体像の既出情報を記録する。`no_advice` は会話を作らず判定情報だけを更新する。

送信前には文脈・推論強度・観測情報のfingerprintを比較する。直前または保持中の成功済みfingerprintと一致すれば再送しない。保持は最大50件で、`no_advice` も成功として含む。停止時間・前回focus・診断差分はfingerprintに含めず、現在の診断やカーソル位置などは含める。

前回focusと全体像表示済みの情報もファイルごとに最大50件保持する。同じ文書バージョンでの `overview` 再選択をプロンプトで抑止するが、専用の応答拒否ルールではない。文書を閉じると当該ファイルの情報を解除し、会話操作に伴うリセットでもキャッシュを消す。これらのキャッシュはセッション内のメモリで管理する。

## 表示と保存

表示した自動回答には `NaviCom（自動・次の一手）` などのラベルを付ける。`ConversationEntry.focus` をSQLiteの `automatic_focus` 列へ保存し、履歴を開き直しても表示する。既存DBには列を追加する移行処理があり、focusのない旧履歴は `NaviCom（自動）` のまま表示する。

## 実装と検証の入口

| 責務 | 主なファイル |
|---|---|
| 型・表示名 | [types.ts](../src/shared/types.ts)、[automaticGuidance.ts](../src/shared/automaticGuidance.ts) |
| イベント・待機 | [AdviceScheduler.ts](../src/services/AdviceScheduler.ts) |
| 観測収集 | [ContextCollector.ts](../src/services/ContextCollector.ts) |
| 送信対象・プロンプト | [RequestPlanner.ts](../src/services/RequestPlanner.ts)、[PromptBuilder.ts](../src/services/PromptBuilder.ts) |
| 応答検証・生成 | [GuidanceResponsePolicy.ts](../src/services/GuidanceResponsePolicy.ts)、[AdviceService.ts](../src/services/AdviceService.ts) |
| 重複・古い結果・キャッシュ | [NavigatorController.ts](../src/application/NavigatorController.ts)、[GuidanceInput.ts](../src/application/GuidanceInput.ts) |
| 永続化・画面 | [ConversationStore.ts](../src/services/ConversationStore.ts)、[s04-conversation.tsx](../src/views/screens/s04-conversation.tsx) |

既存テストでは、[AutomaticObservation.test.ts](../test/AutomaticObservation.test.ts) がイベント集約・カーソル待機・観測制限・fingerprint・DB移行を、[AutomaticGuidance.test.ts](../test/AutomaticGuidance.test.ts) が生成中の編集・古い結果・エラー反映・全体像キャッシュ・推論強度を確認する。応答契約、入力予算、除外globと送信表示はそれぞれ [GuidanceResponsePolicy.test.ts](../test/GuidanceResponsePolicy.test.ts)、[PromptBuilder.test.ts](../test/PromptBuilder.test.ts)、[RequestPlanTransmission.test.ts](../test/RequestPlanTransmission.test.ts) が扱う。

[評価fixture](../src/eval/fixtures.ts)には期待focusを指定し、[評価runner](../src/eval/runner.ts)はfocus別の結果を集計する。`continue` が期待されるケースを `none` で合格させない。静的評価はプロンプト構造の検証であり、実モデルの分類品質はライブ評価で別途確認する。

PR本文ではlint・compile・テスト162件・静的評価22件・差分チェックの成功が報告されている。一方、F5での表示・編集操作と実モデルの分類精度・本文品質の確認は未実施として記載されている。これらはPR時点の報告であり、本書の更新時に再実行した検証結果ではない。
