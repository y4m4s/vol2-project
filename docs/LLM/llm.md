# NaviCom: GitHub Copilot / LM Studio 切り替え実装設計

> **優先仕様: モデル識別子と選択規則**
>
> 本節は、本文中の一般的な「モデル ID」「ロード済みモデル」という表現より優先する。
>
> - 保存する LM Studio のモデル識別子は、必ず `GET /api/v1/models` 応答の `models[].key` を使う。設定値の名前は `lmStudioModelKey` とする。ユーザーに値を手入力させない。
> - モデルのロード判定は `loaded_instances` の配列長で行う。`loaded_instances.length >= 1` のときだけ、そのモデルはロード中である。
> - 保存済み `modelKey` が API 一覧に存在し、かつロード中なら、そのモデルを自動使用する。
> - 保存済み `modelKey` が未ロードまたは API 一覧に存在しない場合は古い選択を解除し、現在ロード中のモデルから選び直す。
> - 保存済みモデルがなく、ロード中モデルが 1 件なら、そのモデルの `key` を選択・保存する。
> - 保存済みモデルがなく、ロード中モデルが複数なら、Extension Host 側の QuickPick を一度だけ表示し、選んだモデルの `key` を保存する。
> - 保存済みモデルがなく、ロード中モデルが 0 件なら、`unavailable` としてモデルをロードするよう案内する。自動ロードはしない。
> - 設定画面にはロード中モデルだけを選択肢として表示する。モデル識別子の手入力はさせない。

## 1. 目的

NaviCom の助言生成先として、既存の GitHub Copilot に加え、ローカルで稼働する LM Studio を選択できるようにする。

今回の変更はプロバイダーの選択・接続・モデル検出・推論経路を追加するものとする。プロンプトの品質改善、Slash Command の追加、GPU 制御、temperature / reasoning の設定、モデルのロード・アンロード操作は対象外とする。

## 2. 確定仕様

### 2.1 接続先と API

- LM Studio の既定 Base URL は `http://127.0.0.1:1234` とする。`/v1` は保存しない。
- ロード状態を含むモデル検出には `GET {baseUrl}/api/v1/models` を使う。
- 推論には OpenAI 互換の `POST {baseUrl}/v1/chat/completions` を使う。
- モデル一覧取得のタイムアウトは 5 秒、推論のタイムアウトは 120 秒とする。制限時間を超えたリクエストは中断し、UI ではタイムアウトとして表示する。
- OpenAI 互換の `GET /v1/models` は使わない。
- URL は HTTP または HTTPS のローカルホストだけを許可する。許可するホストは `127.0.0.1`、`localhost`、`::1` のみとする。
- Base URL は接続処理の内部値として扱い、Webview の設定画面では編集させない。内部値は `URL` で解析し、許可ホスト・プロトコル・ルートパスを検証する。

### 2.2 API 認証

- NaviCom には LM Studio の API トークン設定を設けず、`Authorization` ヘッダーも送らない。
- LM Studio 側で API 認証が有効な場合は接続エラーとして、LM Studio の認証設定を確認するよう案内する。

### 2.3 モデル選択

モデル ID は LM Studio API からのみ取得する。ユーザーにモデル ID を手入力させない。

`GET /api/v1/models` の応答から、**現在ロード中の LLM** だけを抽出して次の順で決定する。

1. ワークスペースに保存済みのモデル ID がロード中なら、そのモデルを自動使用する。
2. 保存済みモデル ID が未ロード、または API 一覧に存在しないなら古い選択を解除し、現在ロード中のモデルから選び直す。
3. 保存済みモデルがなく、ロード中モデルが 1 件なら、そのモデルを自動使用し、ワークスペース設定へ保存する。
4. 保存済みモデルがなく、ロード中モデルが 0 件なら、接続を `unavailable` とし、LM Studio でモデルをロードするよう UI に案内する。モデルの自動ロードはしない。
5. 保存済みモデルがなく、ロード中モデルが複数の場合だけ、VS Code の `window.showQuickPick` を一度表示する。選択結果をワークスペース設定へ保存し、以後は自動使用する。
6. QuickPick をキャンセルした場合は接続しない。モデルを一つにするか、次回接続時に選択するよう案内する。

設定画面にはロード中の LM Studio モデル一覧、現在接続中のモデル名、一覧更新ボタンを表示する。モデル識別子の手入力やモデルのロード・アンロード UI は追加しない。既存の Copilot モデル選択は維持する。

### 2.4 接続とエラー

- 設定保存後は、選択中プロバイダーに即再接続する。
- LM Studio への接続切り替えが失敗した場合は、接続先設定を GitHub Copilot に戻して保存する。接続済みの Copilot があれば維持し、なければ Copilot 接続を試す。
- 接続後の LM Studio 推論が失敗した場合は、そのリクエストだけをエラーにし、無断で同じ内容を Copilot へ再送しない。
- 内部の `ConnectionState` は既存の `unavailable` を使い続ける。UI メッセージだけは以下を区別する。
  - HTTP 401 / 403: LM Studio 側の API 認証が有効
  - 接続拒否・サーバー未起動: LM Studio サーバーに接続できない
  - `AbortError` / 定めた制限時間超過: タイムアウト
  - その他の HTTP・応答解析エラー: その他の接続エラー
- エラー本文、ヘッダー、URL の認証情報を UI やログへそのまま出さない。

### 2.5 利用量・履歴・設定の保存先

- プロバイダー、LM Studio Base URL、LM Studio モデル ID、Copilot モデル ID はワークスペース単位で保存する。
- Copilot は従来どおりトークン数・推定料金を記録し、日次予算の対象とする。
- LM Studio はトークン数・リクエスト数を内部記録しても、消費トークンと日次上限を画面に表示せず、日次予算の対象外とする。
- LM Studio の chat completions リクエストには、実際に送信対象となったファイルパスを `navicom_referenced_files` 配列として付加する。これは LM Studio のサーバーログ確認用であり、ファイル本文は従来どおり `messages[].content` 内の文脈として送る。
- 会話・ナレッジには任意の `providerId` と `modelId` を追加する。画面上は `GitHub Copilot · モデル名`、`LM Studio · モデル名` の形式で表示する。
- 既存レコードは新しい列を持たないため、従来の `modelLabel` を表示用フォールバックとして読み込む。既存データを変更・削除しない。

## 3. 実装方針

### 3.1 プロバイダーの抽象化

現在の `ConnectionService` と `AdviceService` は `vscode.LanguageModelChat` に直接依存している。LM Studio の HTTP 呼び出しを `AdviceService` に継ぎ足さず、接続済みモデルの共通インターフェースを作る。

```text
NavigatorController
  └─ ConnectionService
       ├─ CopilotProvider       ─ vscode.lm / LanguageModelChat
       └─ LmStudioProvider      ─ GET /api/v1/models
                              └─ POST /v1/chat/completions
  └─ AdviceService             ─ 接続済み ProviderModel に prompt を渡す
```

追加する概念は次のとおり。

```ts
type AiProviderId = "copilot" | "lmStudio";

interface ConnectedProviderModel {
  providerId: AiProviderId;
  modelId: string;
  modelLabel: string;
  requestText(prompt: string, token: vscode.CancellationToken): Promise<ProviderTextResponse>;
}

interface ProviderTextResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}
```

- `CopilotProvider` は既存の `vscode.LanguageModelChat.sendRequest()` と `countTokens()` をこのインターフェースに包む。
- `LmStudioProvider` は Fetch を使い、`stream: false` の chat completion を要求する。現在の Webview は応答の逐次表示をしていないため、今回ストリーミングは追加しない。
- LM Studio の推論リクエストには選択済み `modelId`、`messages: [{ role: "user", content: prompt }]`、`stream: false` を指定する。
- LM Studio の `choices[0].message.content` を本文として使う。`usage.prompt_tokens` と `usage.completion_tokens` があればその値を使い、存在しない場合だけ既存と同じ文字数ベースの概算を使う。
- `AdviceService` のプロンプト組み立て、会話タイトル生成、ナレッジ下書き生成は変更せず、送信先だけ共通モデルに切り替える。

### 3.2 LM Studio クライアント

`src/services/LmStudioClient.ts` を追加し、HTTP の詳細をこのファイルに閉じ込める。

責務:

- Base URL の正規化とローカルホスト検証
- `GET /api/v1/models` の実行と、ロード中 LLM の正規化
- `POST /v1/chat/completions` の実行と応答解析
- HTTP・ネットワーク・タイムアウトエラーの分類

`/api/v1/models` の応答の生データを他の層へ渡さない。`LmStudioClient` は `LoadedLmStudioModel[]` に正規化して返す。実装前に対象の LM Studio バージョンからトークンを含まない応答サンプルを取得し、ロード状態を表すフィールドを fixture として固定する。ロード状態を、単なるダウンロード済みモデル一覧から推測してはならない。

### 3.3 設定

`NavigatorSettings` と `SettingsService` を次の方向で拡張する。

```ts
interface NavigatorSettings {
  providerId: AiProviderId;                 // 既定値: "copilot"
  copilotModelId?: string;                  // 既存のまま
  lmStudioBaseUrl: string;                  // 既定値: "http://127.0.0.1:1234"
  lmStudioModelId?: string;                 // API / QuickPick が保存する値のみ
  // 既存の mode, depth, budget, excludedGlobs も維持
}
```

- Webview の保存メッセージには LM Studio の Base URL と API トークンを含めない。
- `resetSettings` は従来どおりワークスペース設定を初期化する。

### 3.4 モデル決定と再接続フロー

`NavigatorController` の Copilot 固有メソッドをプロバイダー非依存の名前へ置き換える。既存のコマンド ID は互換性のため残してもよいが、UI 文言と内部処理は `connectProvider` / `reconnectForProviderSetting` にする。

```text
設定を保存
  → SettingsService が workspaceState へ保存
  → 現在の接続を解除
  → providerId を見て接続先を選択
      ├─ copilot: 既存のモデル選択・接続
      └─ lmStudio:
           1. Base URL を検証
           2. GET /api/v1/models
           3. 2.3 のルールでモデルを決定
           4. 決定モデルがあれば connected
           5. なければ unavailable と理由を表示
```

LM Studio ではモデル一覧取得の成功を接続確認とする。接続時に不要な chat completion の probe は送らない。推論時のエラーも同じ分類で `unavailable` と UI メッセージへ反映する。

### 3.5 Webview とメッセージ

設定画面を次のように変更する。

- プロバイダー選択: `GitHub Copilot` / `LM Studio`
- Copilot 選択時: 現在の Copilot モデル選択 UI を表示
- LM Studio 選択時: ロード中モデルの一覧と現在接続中のモデル名を表示し、選択したモデルを接続先として保存する。Base URL と API トークンの入力UIは表示しない
- LM Studio モデル ID の手入力欄は表示しない
- 消費トークンと「1日の使用上限」は Copilot 選択時だけ表示する
- 「保存」時は設定を保存後、ただちに再接続する
- 接続ボタン、状態文言、メイン画面のモデル表示から Copilot 固有の名称を外す

設定画面を経由しない接続時にロード中モデルが複数あり、保存済み選択もない場合だけ、Extension Host 側の `vscode.window.showQuickPick` を使う。

### 3.6 履歴・ナレッジの後方互換

`ConversationEntry`、`StoredConversationEntry`、`KnowledgeRecord` へ、任意の `providerId?: AiProviderId` と `modelId?: string` を追加する。

- `ConversationStore` の `conversation_entries` に `provider_id` と `model_id` を nullable 列として追加する。既存の `ensureColumn` パターンでマイグレーションする。
- `KnowledgeStore` の `knowledge` にも同じ nullable 列を追加する。
- INSERT、SELECT、シリアライズ、ViewModel 変換を追加する。
- 新規エントリーは常に provider と model を保存する。既存エントリーは `undefined` のまま読み、`modelLabel` を表示用の互換値とする。

`modelLabel` は互換表示のため当面残す。新規レコードの表示ラベルは `GitHub Copilot · {modelLabel}` または `LM Studio · {modelLabel}` とする。`providerId` と `modelId` は表示文字列から再解析しない。

### 3.7 利用量・予算

現在の `UsageMeter` は単一の当日合計を現在モデルの価格で換算するため、複数プロバイダーでは正しい料金にならない。プロバイダー・モデルをキーにした当日集計へ拡張する。

- Copilot の日次料金は、その日の全 Copilot モデル分を合計して判定する。
- LM Studio の料金率は常に `0` とし、`isBudgetExceeded` の対象から除外する。
- LM Studio のトークン数とリクエスト数は必要に応じて内部記録するが、Webview には表示しない。
- 旧形式の単一日次集計は Copilot の旧データとして読み込み、データを失わない。

## 4. 実装順序

1. `shared/types.ts` と `shared/messages.ts` に provider、LM Studio 設定、履歴メタデータを追加する。
2. `LmStudioClient` を追加し、URL 検証・モデル正規化・エラー分類を単体で確認できる形にする。
3. `ConnectionService` を共通プロバイダー接続へリファクタリングし、Copilot の既存動作を維持する。
4. `AdviceService` を共通の接続済みモデルへ切り替え、LM Studio の非ストリーミング応答と usage を受け取れるようにする。
5. `NavigatorController` の接続、再接続、モデル決定、状態メッセージをプロバイダー対応にする。
6. `SettingsService`、`UsageMeter`、会話・ナレッジ SQLite のマイグレーションを実装する。
7. Webview の設定・接続・履歴・ナレッジ表示を更新する。
8. Copilot 回帰、LM Studio 接続、モデル決定、接続拒否・タイムアウト・一般エラー、旧 DB 読み込みを検証する。
9. `npm run compile` を実行し、Extension Development Host で View の表示状態と接続フローを確認する。View が表示されない場合は、コンパイルだけで判断せず VS Code の保存済み view state も確認する。

## 5. 検証ケース

| 条件 | 期待結果 |
| --- | --- |
| 保存済み LM Studio モデルがロード済み | QuickPick なしで接続し、そのモデルを利用 |
| 保存済みモデルが未ロードまたは削除済み | 保存済み ID を解除し、現在ロード中のモデルから選び直す |
| 保存済みモデルなし・ロード済み 1 件 | 自動接続し、モデル ID を保存 |
| 保存済みモデルなし・ロード済み複数 | QuickPick を一度表示し、選択値を保存 |
| 設定画面・LM Studio選択 | ロード中モデル一覧と現在接続中のモデル名を表示し、任意のモデルへ切り替え可能 |
| ロード済み 0 件 | `unavailable`。モデルをロードするよう案内 |
| QuickPick をキャンセル | 接続せず、選択を促す案内 |
| HTTP 401 / 403 | LM Studio 側の認証設定を確認する案内 |
| 接続拒否 | LM Studio 未起動・到達不能の案内 |
| タイムアウト | タイムアウトの案内 |
| LM Studio 推論失敗 | Copilot へ切り替えず `unavailable` |
| LM Studio を選択 | Base URL・APIトークン・日次上限を表示しない |
| LM Studio の回答 | 消費トークンを表示しない |
| Copilot を選択 | 消費トークンと日次上限を従来どおり表示 |
| 既存の会話・ナレッジ DB | 既存レコードを問題なく表示 |
