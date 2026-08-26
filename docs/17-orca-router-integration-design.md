# 17. OrcaRouter導入設計・実装

## 目的

OpenAI互換の推論ゲートウェイOrcaRouterを、GitHub Copilot、LM Studioに続く3つ目のAIプロバイダとして利用する。

## 実装構成

```text
AdviceService
  -> ConnectedProviderModel.requestText()
     -> Copilot: VS Code Language Model API
     -> LM Studio: LmStudioClient
     -> OrcaRouter: OrcaRouterClient
```

- `AiProviderId`は `"copilot" | "lmStudio" | "orcaRouter"`。
- OrcaRouterのAPIベースURLは `https://api.orcarouter.ai/v1` に固定する。
- モデル一覧は `GET /models`、推論は `POST /chat/completions` を利用する。
- OpenAI SDKは追加せず、既存のLM Studio連携と同様に `fetch` でOpenAI互換JSONを扱う。

## APIキー

- APIキーは `vscode.ExtensionContext.secrets` のSecretStorageへ保存する。
- `workspaceState`、ViewModel、会話履歴、ログには保存しない。
- Webviewへは設定済みかどうかだけを返し、保存値そのものは返さない。
- キーは `sk-orca-` 形式を検証し、置換と削除を可能にする。
- 接続オブジェクトへキーを保持せず、推論リクエスト直前にSecretStorageから最新値を取得する。キー置換後の次回リクエストは再接続なしで新しいキーを利用する。

## モデル一覧

`GET /v1/models` の応答から、以下を満たすモデルだけを表示する。

- OpenAI互換エンドポイントを利用可能
- テキスト入力を利用可能
- テキスト出力を利用可能

APIキー保存後は、固定のルーター選択肢として以下も表示する。APIキー未設定時はモデル候補を表示せず、キー入力を先に案内する。

- `orcarouter/free`: 無料容量だけを利用する。初期値。
- `orcarouter/auto`: OrcaRouterの自動ルーティング。有料モデルを利用する可能性がある。

モデル数が多いため、設定画面ではID、表示名、プロバイダによる検索を提供する。モデル一覧はAPIキー保存時に自動取得し、明示的な更新操作でも再取得できる。

## 推論と利用量

推論リクエストには `X-OrcaRouter-Include-Cost: true` を付け、応答の以下を記録する。

- `usage.prompt_tokens`
- `usage.completion_tokens`
- `usage.cost_usd`

`usage.cost_usd` がある会話では実請求額として表示する。過去データなど実コストがない場合のみ既存の概算処理を利用する。LM Studio専用の `navicom_referenced_files` はOrcaRouterへ送信しない。

## エラー分類

- 401: APIキー不正
- 402 / 403: 残高、無料容量、キー利用上限、権限制限
- 429 + `Retry-After` あり: 無料枠またはレート上限。指定秒数後の再試行を案内
- 429 + `Retry-After` なし: 無料モデルの1リクエスト入力上限。文脈の短縮を案内し、自動再試行しない
- 425 / 500 / 502 / 503: モデルまたはサービス利用不可
- 408 / 504 / Abort: タイムアウトまたはキャンセル
- 不正JSON・本文なし: 不正レスポンス

`free_quota_exhausted` / `free_rate_limited` は専用メッセージを表示し、有料モデルへ切り替えていないことを明示する。

## データ送信

OrcaRouter利用時、プロンプトに含まれる質問、コード断片、診断情報などはOrcaRouterと上流モデル事業者へ送信される。READMEと設定画面でこれを明示する。既存の保護済み・追加除外globはOrcaRouterでも適用する。

## テスト方針

- モデル応答の正規化
- Authorizationヘッダーと固定URL
- 推論本文、トークン数、実コストの解析
- OrcaRouterエラーコードの保持と分類
- LM Studio専用パス情報を送信しないこと
- Webviewメッセージのプロバイダ・APIキー境界検証
- TypeScriptコンパイル、Webview型検査、Webviewビルド

実APIキーを使った通信試験は自動テストに含めない。手動試験では最初に `orcarouter/free` を使い、有料モデルを選択していないことを確認する。
