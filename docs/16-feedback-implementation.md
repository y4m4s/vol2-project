# 16. Good／Badフィードバック実装

## 方針

Good／Badは、回答品質の好みをローカルに記録し、同じ種類の相談へ限定して再利用する。

- 評価時にAI APIを呼び出さない
- 回答本文や補足コメントを外部送信しない
- Good／Badとも具体的な理由を1つ以上必須にする
- 補足コメントはローカルDBへの記録だけに使用する
- 理由はアプリ内の安全な定型文へ変換し、生のコメントをプロンプトへ入れない
- 会話を削除すると、その会話に紐づく評価も削除する
- 評価済みボタンをもう一度押すことで、評価を変更できる

## 処理フロー

```text
Good／Badを押す
  -> FeedbackCoordinator.rateAdvice()
  -> 共通の理由入力画面を開く
  -> submitFeedback(reasons, comment)
  -> 会話履歴のfeedbackを更新して永続化
  -> FeedbackStore.saveFeedback()

次の助言生成
  -> FeedbackStore.getTendencySummary({ kind, assistanceDepth, slashCommand })
  -> 理由をローカルの定型傾向へ変換
  -> 同じ相談種別・推論強度・コマンドの傾向だけをPromptBuilderへ渡す
```

## 理由と傾向

Good:

| 理由 | プロンプトへ渡す傾向 |
|---|---|
| 簡潔で読みやすい | Keep responses concise and focused. |
| 場所や確認点が具体的 | Use concrete file, symbol, and check references. |
| 構成が分かりやすい | Use a clear, easy-to-follow structure. |
| 詳しさがちょうどよい | Match the detail level to the selected assistance depth. |
| 考える手掛かりになった | Guide with checks and hints instead of complete solutions. |

Bad:

| 理由 | プロンプトへ渡す傾向 |
|---|---|
| 長すぎる | Avoid overly long responses; keep them concise and focused. |
| 的外れ | Avoid drifting away from the user's current question and context. |
| 答えを代行しすぎ | Avoid complete solutions; guide with checks and hints. |
| 観点が曖昧 | Avoid vague advice; point to concrete locations and checks. |

「その他」と補足コメントはローカル記録には残すが、内容を推測してプロンプトへ変換しない。

## 適用範囲と競合処理

評価は次の3項目が一致する相談にだけ適用する。

- `GuidanceKind` (`manual` / `context` / `always`)
- 推論強度 (`low` / `high`)
- スラッシュコマンド（コマンドなしを含む）

同じ観点の評価が複数ある場合は新しい評価を優先する。例えば、古いGoodの「簡潔」と新しいBadの「長すぎる」を同時には注入しない。常時助言には従来どおり評価傾向を注入しない。

## 保存と削除

保存先は `<globalStorageUri>/feedback.sqlite`。評価、選択理由、任意コメント、相談種別を保存する。回答本文は新規評価データへ保存しない。

`PRAGMA user_version = 2` の移行で、常に空だった `advice_text_excerpt` と、使用されなくなった `summary_text` / `summary_status` を削除する。旧DBの重複評価削除とテーブル再構築は v2 への更新時に一度だけ行い、毎起動時には実行しない。

会話削除時は、削除対象の会話エントリIDに紐づく評価を `FeedbackStore.deleteByConversationEntryIds()` で削除する。履歴の一括削除時は評価DBも全件削除する。別DB間の処理なので、評価削除だけ失敗した場合は警告を表示し、次回起動時に会話DBと照合して孤立した評価を再度削除する。保持上限で古い会話が自動削除された場合も同じ関連評価を削除する。

## 安全性

- WebviewメッセージとCoordinatorの両方で理由を検証する
- コメントは最大1000文字に統一する
- 生のコメントをプロンプトへ入れない
- 定型傾向だけを `<feedback-preferences>` 境界内へ入れる
- SQLite書込みは直列化し、ファイルはアトミックに保存する
- 会話履歴か評価DBの保存に失敗した場合は、先に更新した会話履歴の評価をロールバックする

## テスト

- 評価種別に合わない理由の除外
- 理由から定型傾向への変換
- 新しい評価による重複・競合解消
- 理由なし評価の拒否
- Good／Badの再評価
- 会話履歴・評価DB保存失敗時のロールバック
- Webviewメッセージの件数・文字数・理由値検証
- manual/contextへの注入とalwaysからの除外
