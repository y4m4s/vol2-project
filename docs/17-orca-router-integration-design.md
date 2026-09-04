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
- `choices[0].finish_reason`
- `X-Orca-Request-Id`
- `X-Orca-Resolved-Model`

`usage.cost_usd` がある会話では「応答時点の記録料金」として表示する。これは応答生成時の計算値であり、確定請求額とは限らない。確定した請求情報の確認先はOrcaRouter側の利用履歴またはGeneration情報とする。過去データなど応答コストがない場合のみ既存の概算処理を利用する。LM Studio専用の `navicom_referenced_files` はOrcaRouterへ送信しない。

## エラー分類

- 401: APIキー不正
- 402 / 403: 残高、無料容量、キー利用上限、権限制限
- 429 + `Retry-After` あり: 10秒以内なら指定秒数後に1回だけ自動再試行し、それより長ければ再試行時刻を案内
- 429 + `Retry-After` なし: 無料モデルの1リクエスト入力上限。文脈の短縮を案内し、自動再試行しない
- 500 / 502 / 503、不正JSON、到達不能: モデルまたはサービス利用不可。モデル一覧取得と無料モデルの推論だけは400ms後に1回再試行する
- 有料モデルの推論における一時障害: 応答喪失時の重複課金を避けるため自動再試行しない
- 425: 未提供モデルとして自動再試行しない
- 408 / 504 / Abort: タイムアウトまたはキャンセル
- 不正JSON・本文なし: 不正レスポンス

`free_quota_exhausted` / `free_rate_limited` は専用メッセージを表示し、有料モデルへ切り替えていないことを明示する。

認証・残高・利用上限以外の4xxは、接続障害ではなくリクエスト単位の拒否として扱う。入力内容またはモデル設定の確認を案内し、接続済みモデルは保持する。Guardrailによる拒否は専用メッセージを表示する。5xx、タイムアウト、不正レスポンスなど、接続先を正常に利用できない失敗だけを `unavailable` とする。

## データ送信

OrcaRouter利用時、回答生成とナレッジ作成のプロンプトはOrcaRouterと上流モデル事業者へ送信される。回答生成はステートレスで、過去の会話履歴を自動送信しない。質問やワークスペース内のコード断片に加え、処理に応じて診断情報、ファイル名・ディレクトリ構造、追加コンテキスト、再利用ナレッジのタイトル・要約、評価理由からローカル生成した定型フィードバック傾向を含む。ナレッジ作成時だけ保存対象回答の周辺メッセージを送る。会話タイトルはローカルで生成し、補足コメントはフィードバック処理では送信しない。READMEと設定画面でこれを明示する。既存の保護済み・追加除外globはOrcaRouterでもファイル本文に適用し、APIキーはプロンプトへ含めない。

## Guardrail／Firewall

- NaviCom自身はOrcaRouterのGuardrail／Firewallポリシーを作成・有効化しない。
- GuardrailはOrcaRouter側で設定し、APIキーまたはワークスペースへ適用されたポリシーに従ってプロンプトや応答を検査する。
- ポリシー未設定で同一の推論エンドポイントを利用するだけでは、Guardrailが自動的に適用されるとは説明しない。
- 現在のクライアントはChat Completionsへテキストメッセージだけを送り、ツール定義・ツール呼び出しを扱わない。そのため、エージェントのツール実行を制御するFirewallは現在の連携経路では利用しない。

## テスト方針

- モデル応答の正規化
- Authorizationヘッダーと固定URL
- 推論本文、トークン数、応答時点の記録料金の解析
- 終了理由、リクエストID、ルーター解決後モデル、通信試行回数の解析
- 短い `Retry-After` の1回限定再試行と、長い待機・有料モデル障害を再試行しないこと
- OrcaRouterエラーコードの保持と分類
- リクエスト単位の4xxおよびGuardrail拒否で接続を維持すること
- LM Studio専用パス情報を送信しないこと
- Webviewメッセージのプロバイダ・APIキー境界検証
- TypeScriptコンパイル、Webview型検査、Webviewビルド

実APIキーを使った通信試験は自動テストに含めない。手動試験では最初に `orcarouter/free` を使い、有料モデルを選択していないことを確認する。
