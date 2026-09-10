# GitHub Copilotの現状実装

確認日: 2026-09-09。[プロバイダー一覧](README.md)

## 接続とモデル選択

内部IDは `copilot` で、NaviComの既定プロバイダー。VS CodeのLanguage Model APIを使い、独自のGitHub APIキーやHTTP接続先は設定しない。選択モデルは `copilotModelId` としてワークスペースへ保存する。

1. Workspace Trustを確認する。
2. `vscode.lm.selectChatModels({ vendor: "copilot" })` でモデル一覧を取得する。空なら1.5秒後に1回だけ再取得する。
3. 保存済み指定があれば該当するモデルを選ぶ。未指定なら、識別情報に `auto` を含み、`canSendRequest` が明示的にfalseでないモデルを選ぶ。
4. 指定モデルまたはAutoが見つからなければ `unavailable` とし、設定での選択を案内する。別モデルへの固定優先順位による代替はない。
5. `consent_pending` として短いprobeを送り、成功後に `connected` にする。

probeは `Respond with exactly: ready` を出力上限16トークンで送り、応答受信の成功を確認する。応答文字列の完全一致判定はしない。待機は既定60秒で、VS Code設定 `aiPairNavigator.copilotProbeTimeoutSeconds` により15〜180秒へ変更できる。タイムアウト時はキャンセルし、自動再送しない。取得できたprobeのトークンも利用量へ記録する。

## 回答生成

`LanguageModelChat.sendRequest()` へ制御指示と作業データをそれぞれUserメッセージとして渡し、`modelOptions.max_tokens` に用途別の上限を指定する。APIのテキストストリームを収集し、受信文字数上限を確認してから回答を返す。画面への逐次表示はしない。トークン計測にはモデルの `countTokens()` を利用できる。

## 利用制限とエラー

NaviComはCopilotのプラン名・契約状態・公式残高を取得せず、プラン別の利用許可判定を行わない。接続可否は、その環境でAPIが公開するモデル、利用同意、実リクエストの結果で判断する。モデル一覧が空というだけで契約プランを原因と断定しない。

`NoPermissions`、`Blocked`、`NotFound`、probeのタイムアウトなどを区別して案内する。接続できない場合は、VS CodeのGitHubサインイン、モデル利用同意、Workspace Trust、公開モデル一覧、組織ポリシーやサービス側の制限を確認する。

利用回数・トークン・参考料金と日次トークンガードはNaviCom内の計測。GitHubの請求額や残高ではない。自動助言は日次ガードで停止し、手動相談は警告を表示する。旧調査文書のプラン一覧・価格・クレジット制度の時点情報は現状実装の説明から除いた。

## 実装・検証箇所

- [ConnectionService.ts](../../src/services/ConnectionService.ts): 選択、probe、Language Model APIラッパー、エラー分類
- [AdviceService.ts](../../src/services/AdviceService.ts)、[UsageMeter.ts](../../src/services/UsageMeter.ts)
- [package.json](../../package.json): probe待機時間の設定
- [ConnectionService.test.ts](../../test/ConnectionService.test.ts)、[UsageMeter.test.ts](../../test/UsageMeter.test.ts)

実機確認では、Autoあり・なし、明示選択したモデルの消失、同意拒否、probeタイムアウトを区別する。
