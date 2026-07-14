# 15. LM Studio サーバー操作・設定タイトルアイコン 実装手順書

## 1. 文書の目的

NaviCom の設定画面から LM Studio Local Server を起動・停止できるようにし、設定画面内の各機能タイトルへ統一されたアイコンを追加するための実装手順を定義する。

この文書は実装前の作業計画であり、作成時点ではソースコードの実装変更を行わない。

## 2. 対象範囲

### 2.1 実装対象

- 設定画面での LM Studio Local Server 状態表示
- NaviCom からの Local Server 起動・停止
- 起動・停止中の二重操作防止
- 起動成功後のロード済みモデル一覧更新
- 停止後の LM Studio 接続状態更新
- `lms` CLI 未検出、起動失敗、停止失敗、タイムアウト、ポート競合の表示
- 設定画面のページタイトルおよび各機能タイトルへの Material Symbols アイコン追加
- 狭いサイドバー、ライトテーマ、ダークテーマでのレイアウト調整
- Extension Host ログへのサーバー操作結果出力

### 2.2 実装対象外

- LM Studio アプリ本体の強制終了
- LM Studio GUI ウィンドウの表示・非表示操作
- モデルのダウンロード
- NaviCom からのモデルロード・アンロード
- Base URL、API キーの再表示
- LM Studio の認証設定変更
- LAN 公開用の `0.0.0.0` バインド
- CORS の有効化

## 3. 現状

### 3.1 接続処理

現在の `LmStudioClient` は次の HTTP 通信だけを担当している。

- `GET /api/v1/models`: モデル一覧取得
- `POST /v1/chat/completions`: 推論

サーバープロセスの起動・停止や `lms` CLI の呼び出しは実装されていない。

### 3.2 設定画面

現在の設定画面は `src/views/screens/s06-settings.tsx` にあり、LM Studio 選択時はロード中モデルと一覧更新ボタンを表示している。

大分類の見出しにはアイコンがあるが、次のような個別機能タイトルにはアイコンがない。

- 接続先
- ロード中のモデル
- 初期モード
- 既定の深さ
- 待ち時間
- インターバル
- 1日の使用上限
- 使用モデル
- 保護済みパターン
- 追加除外パターン
- 初期化

### 3.3 実行環境

NaviCom は VS Code Desktop の Extension Host で動く Node.js 拡張である。そのため、Webview から直接 OS コマンドを実行せず、Webview からメッセージを送り、Extension Host 側で `lms` CLI を実行する。

## 4. 完成時の画面仕様

### 4.1 表示位置

「接続先」で `LM Studio` を選択したとき、`AI 接続` セクションを次の順番で表示する。

1. 接続先
2. LM Studio サーバー
3. ロード中のモデル

Copilot 選択時は「LM Studio サーバー」と「ロード中のモデル」を非表示にする。

サーバー操作は設定値の保存とは別の即時操作とする。「サーバーを起動・停止」だけでは画面下部の保存バーを表示しない。

### 4.2 LM Studio サーバーカード

カードは既存の `.setting-item` と同じ幅、余白、角丸、背景、枠線を使う。

表示例:

```text
[dns] LM Studio サーバー
      停止中

[power_settings_new] サーバーを起動
```

起動中:

```text
[dns] LM Studio サーバー
      起動中 · localhost:1234

[stop_circle] サーバーを停止
```

状態確認中・操作中:

```text
[dns] LM Studio サーバー
      サーバーの状態を確認しています…

[progress_activity] 起動しています…
```

### 4.3 状態表示

画面に渡すサーバー状態は次の値に限定する。

| 状態 | 表示 | 操作 |
|---|---|---|
| `checking` | 状態を確認しています… | ボタン無効 |
| `stopped` | 停止中 | 起動可能 |
| `starting` | 起動しています… | ボタン無効 |
| `running` | 起動中・ポート番号 | 停止可能 |
| `stopping` | 停止しています… | ボタン無効 |
| `cliUnavailable` | LM Studio CLI が見つかりません | 起動・停止不可 |
| `portConflict` | ポートが別のプロセスに使用されています | 起動不可 |
| `error` | 状態確認または操作に失敗しました | 状況に応じて再試行 |

状態は色だけで区別せず、必ず文言とアイコンを併記する。

### 4.4 ボタン仕様

- 起動ボタンは既存の `.btn-gray` と高さ、角丸、文字サイズを揃える
- 起動中は成功を示す色を状態表示に使い、停止ボタン自体は危険操作に見えすぎない中立色とする
- `starting` / `stopping` 中はボタンを `disabled` にして二重実行を防ぐ
- NaviCom が回答生成中の場合は停止ボタンを無効にする
- 停止ボタンの補足に「ほかのアプリからの LM Studio 接続も切断されます」と表示する
- ボタンには目視できる文言を置き、アイコンだけの操作にしない
- `aria-busy`、`aria-disabled`、状態文言用の `aria-live="polite"` を設定する

### 4.5 各タイトルのアイコン

Material Symbols を使用し、次の割り当てを基本とする。

| タイトル | アイコン |
|---|---|
| 設定（ページタイトル） | `settings` |
| 接続先 | `cable` |
| LM Studio サーバー | `dns` |
| ロード中のモデル | `memory` |
| 初期モード | `toggle_on` |
| 既定の深さ | `travel_explore` |
| 待ち時間 | `timer` |
| インターバル | `schedule` |
| 1日の使用上限 | `data_usage` |
| 使用モデル | `smart_toy` |
| 保護済みパターン | `shield_lock` |
| 追加除外パターン | `playlist_remove` |
| 初期化 | `restart_alt` |

大分類見出しの既存アイコンは維持する。個別タイトルのアイコンは装飾扱いとし `aria-hidden="true"` を付け、タイトル文字列をアクセシブルネームとして残す。

## 5. サーバー制御の基本方針

### 5.1 使用コマンド

次の公式 CLI コマンドを Extension Host 側から実行する。

```bash
lms server status --json --quiet
lms server start --port 1234 --bind 127.0.0.1
lms server stop
```

実装ではシェルを起動せず、Node.js の `child_process.execFile` を使用する。コマンド文字列の連結や `exec` は使用しない。

### 5.2 GUI との関係

- 利用者が LM Studio の画面を手動で開いている必要はない
- `lms server start` が LM Studio のサービスまたは `llmster` をバックグラウンドで起動する
- `lms server stop` は Local Server を停止する
- NaviCom は LM Studio アプリ本体を強制終了しない
- サーバーの起動・停止とモデルのロード・アンロードは別操作として扱う

### 5.3 バインド先

NaviCom から起動する場合は `127.0.0.1` のみにバインドし、LAN へ公開しない。ポートは NaviCom が接続に使う URL と一致させる。

現行の標準値は次のとおり。

```text
http://127.0.0.1:1234
```

旧バージョンで別ポートが保存されている場合は、`SettingsService` が返す `lmStudioBaseUrl` からホストとポートを解析し、そのポートを起動コマンドへ渡す。ホストは既存の URL 検証どおりループバックアドレスだけを許可する。

### 5.4 Workspace Trust

ローカルプロセスを起動するため、Workspace Trust が無効な場合は起動・停止を許可しない。カード内に「Workspace Trust を有効にしてください」と表示する。

## 6. 実装する型

`src/shared/types.ts` に次のビュー用型を追加する。

```ts
export type LmStudioServerState =
  | "checking"
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "cliUnavailable"
  | "portConflict"
  | "error";

export interface LmStudioServerViewData {
  state: LmStudioServerState;
  port?: number;
  message?: string;
  canStart: boolean;
  canStop: boolean;
}
```

`NavigatorViewModel` に次を追加する。

```ts
lmStudioServer: LmStudioServerViewData;
```

Webview は独自に状態を推測せず、この値だけで表示とボタン活性状態を決定する。

## 7. Extension Host 側の実装手順

### 手順1: `LmStudioServerService` を追加する

新規ファイル:

```text
src/services/LmStudioServerService.ts
```

責務:

- `lms` 実行ファイルの検出
- `lms server status` の実行と JSON 解析
- サーバー起動
- サーバー停止
- タイムアウト処理
- CLI 出力を利用者向けエラーへ分類
- HTTP プローブとの照合

公開メソッド案:

```ts
getStatus(baseUrl: string): Promise<LmStudioServerStatus>
start(baseUrl: string): Promise<LmStudioServerStatus>
stop(baseUrl: string): Promise<LmStudioServerStatus>
```

`LmStudioClient` は HTTP API クライアントのまま維持し、プロセス制御を混在させない。

### 手順2: `lms` 実行ファイルを安全に検出する

検出順:

1. Extension Host の `PATH` にある `lms`
2. macOS / Linux の `~/.lmstudio/bin/lms`
3. Windows の LM Studio 標準 CLI 配置先

候補ごとに `server status --json --quiet` を `execFile` で実行する。存在しない候補は次へ進み、すべて失敗した場合は `cliUnavailable` とする。

利用者が入力した任意コマンドや任意パスは実行しない。

### 手順3: 状態確認を実装する

1. `lms server status --json --quiet` を実行する
2. `{ running: boolean, port: number }` を検証して解析する
3. `running: true` の場合、`GET /api/v1/models` で LM Studio API が応答するか確認する
4. CLI が停止中と返した場合でも、対象ポートへ LM Studio 形式の HTTP 応答があれば `running` とする
5. 対象ポートが応答するが LM Studio のレスポンス形式でなければ `portConflict` とする

CLI の状態と実際の HTTP 待受を照合し、GUI 側で起動されたサーバーも正しく表示する。

### 手順4: 起動を実装する

1. 現在状態を再確認する
2. すでに LM Studio API が起動中なら成功扱いにして重複起動しない
3. `lms server start --port <port> --bind 127.0.0.1` を実行する
4. 最大10秒、一定間隔で HTTP API の応答を確認する
5. 応答確認後にモデル一覧を更新する
6. モデルが0件の場合もサーバー起動自体は成功とし、「ロード中のモデルがありません」と表示する

起動コマンドのタイムアウトと API 起動待ちのタイムアウトは別に管理する。

### 手順5: 停止を実装する

1. NaviCom の回答生成中でないことを確認する
2. 状態を `stopping` にする
3. `lms server stop` を実行する
4. HTTP API が応答しなくなるまで最大10秒確認する
5. LM Studio モデル選択肢を画面上からクリアする
6. LM Studio が現在の接続先だった場合は接続を解除し、既存の Copilot 復帰処理を使って Copilot に戻す
7. 接続先設定も Copilot として保存し、LM Studio が停止したまま選択済みにならないようにする

停止によってほかのアプリのリクエストも終了する可能性があることを、停止ボタンの説明に明示する。

### 手順6: 未保存設定を保護する

サーバー起動は設定保存と独立しているため、未保存の設定があっても実行可能とする。

一方、LM Studio 接続中のサーバー停止では Copilot への復帰保存が発生する。未保存の設定を失わないため、次のどちらかを満たす。

- 推奨: Webview のドラフトを維持したまま、保存済み `providerId` だけを Copilot に同期できるよう状態同期を分離する
- 代替: LM Studio 接続中かつ未保存変更がある場合だけ停止ボタンを無効にし、先に保存または「元に戻す」を求める

実装量と誤操作防止を考慮し、初回実装では代替案を採用する。Copilot 接続中に外部で起動された LM Studio サーバーを停止する場合は設定保存が発生しないため、未保存変更があっても停止可能とする。

### 手順7: ログを追加する

`NaviCom LM Studio` OutputChannel を作成し、次を記録する。

- 状態確認開始・結果
- 使用した `lms` のパス
- 起動・停止開始
- 終了コード
- HTTP 確認結果
- タイムアウトまたは分類済みエラー

API トークン、プロンプト、ファイル内容はログへ出さない。

## 8. Controller・メッセージ処理の実装手順

### 手順1: Webview メッセージを追加する

`src/shared/messages.ts` の `WebviewToExtension` に追加する。

```ts
| { type: "refreshLmStudioServerStatus" }
| { type: "startLmStudioServer" }
| { type: "stopLmStudioServer" }
```

ペイロードからコマンドやポートを受け取らない。接続先は Extension Host 側の正規化済み設定を使う。

### 手順2: `NavigatorViewProvider` に分岐を追加する

各メッセージを `NavigatorController` の同名ユースケースへ渡す。

```ts
case "refreshLmStudioServerStatus":
case "startLmStudioServer":
case "stopLmStudioServer":
```

### 手順3: `NavigatorController` にサービスを注入する

`src/extension.ts` で `LmStudioServerService` を生成し、`NavigatorController` へ渡す。

Controller は次を保持する。

- 現在の `LmStudioServerViewData`
- 操作中フラグ
- 連続クリックを拒否するための実行中 Promise またはガード

### 手順4: 設定画面を開いたときに状態を更新する

`navigate("settings")` で現在実行しているモデル一覧更新と並行して、サーバー状態を更新する。

ただし、設定画面への遷移を状態確認完了までブロックしない。最初は `checking` を表示し、結果取得時に ViewModel を再送する。

### 手順5: 起動成功後にモデル一覧を更新する

起動成功直後に次を実行する。

1. サーバー状態を `running` に更新
2. `refreshLmStudioModels(false)` を実行
3. ViewModel を再送
4. ロード済みモデルがあれば件数を通知
5. 0件ならモデルロードを求める警告を通知

### 手順6: 停止時の接続状態を更新する

現在の接続先が LM Studio の場合:

1. `ConnectionService.resetToDisconnected()` で使用中モデル参照を破棄
2. 保存設定を Copilot に戻す
3. Copilot への接続を試す
4. 成功時は「LM Studio サーバーを停止し、Copilot に戻しました」と表示
5. 失敗時は「サーバーは停止しました。Copilot にも接続できませんでした」と表示

現在の接続先が Copilot の場合は Copilot 接続へ影響を与えない。

## 9. Webview 実装手順

### 手順1: ページタイトルへアイコンを追加する

`PageHeader` の `title` は `ReactNode` を受け取れるため、既存コンポーネントを変更せず次の構造を渡す。

```tsx
<span className="settings-page-title">
  <span className="material-symbols-outlined" aria-hidden="true">settings</span>
  <span>設定</span>
</span>
```

### 手順2: 個別タイトル用コンポーネントを作る

`s06-settings.tsx` 内、または再利用範囲に応じて `src/views/webview/components/SettingTitle.tsx` に `SettingTitle` を作る。

必要な props:

```ts
interface SettingTitleProps {
  icon: string;
  children: ReactNode;
  id?: string;
  htmlFor?: string;
}
```

`htmlFor` がある場合は `<label>`、ない場合は `<div>` を出力する。これにより追加除外パターンの textarea とラベルの関連付けを維持する。

### 手順3: すべての個別機能タイトルを置き換える

既存の `.setting-label` テキストを `SettingTitle` に置き換え、4.5 のアイコン割り当てを適用する。

`ScheduleButtonGroup` の `label` も文字列だけでなくアイコン名を受け取るようにする。

### 手順4: サーバーカードを追加する

`providerId === "lmStudio"` のブロック内で、モデルカードより前に `LmStudioServerControl` を表示する。

コンポーネントの責務:

- ViewModel の状態表示
- 起動・停止メッセージ送信
- ボタン無効化
- 状態アイコンと補足文の表示
- `aria-live` と `aria-busy` の設定

コンポーネント内で CLI を直接呼び出したり、状態を推測したりしない。

### 手順5: モデル一覧との連動を調整する

- `stopped` のときは「モデル一覧を更新」を無効にする
- `running` のときだけ一覧更新を可能にする
- `starting` / `stopping` / `checking` 中はモデル選択を無効にする
- サーバー起動成功後は自動更新されるが、手動更新ボタンも残す
- モデル0件表示は「サーバー停止」と「モデル未ロード」を区別する

## 10. CSS 実装手順

変更対象:

```text
src/views/css/s06-settings.css
```

追加する主なクラス:

```text
.settings-page-title
.setting-title
.setting-title-icon
.lmstudio-server-card
.lmstudio-server-status
.lmstudio-server-status-icon
.lmstudio-server-status-copy
.lmstudio-server-action
.lmstudio-server-help
```

レイアウト規則:

- ページタイトルのアイコン: `20px`
- 個別タイトルのアイコン: `17px` または `18px`
- タイトルのアイコンと文字の間隔: `6px`
- アイコンは `flex-shrink: 0`
- タイトル行は `display: flex; align-items: center`
- 長いタイトルは文字側だけ折り返す
- サーバー状態行は `display: flex`、状態文は `min-width: 0`
- 操作ボタンは既存カードと同じ全幅
- ボタン上余白は既存のモデル一覧更新ボタンと同じ `10px`
- 狭い幅でも状態とボタンが横にはみ出さない
- VS Code のテーマ変数を使い、固定の白・黒を指定しない
- `:focus-visible` で `--vscode-focusBorder` を表示する
- disabled 時はカーソルと不透明度を統一する

大分類見出しと個別タイトルでアイコンの濃さが競合しないよう、個別タイトルは `var(--vscode-descriptionForeground)`、文字は `var(--vscode-foreground)` を使う。

## 11. エラー仕様

| 条件 | 利用者向け表示 | 復旧方法 |
|---|---|---|
| `lms` がない | LM Studio CLI が見つかりません | LM Studioを一度起動し、CLIを利用可能にする |
| Workspace Trust 無効 | Workspace Trust が必要です | ワークスペースを信頼する |
| 起動タイムアウト | サーバーの起動を確認できませんでした | LM Studioログを確認して再試行 |
| 停止タイムアウト | サーバーの停止を確認できませんでした | LM Studio側の状態を確認して再試行 |
| 1234番ポート競合 | ポート1234が別のアプリで使用されています | 使用中プロセスを確認する |
| CLI JSON不正 | LM Studioの状態を取得できませんでした | CLI更新またはログ確認 |
| サーバー起動・モデル0件 | サーバーは起動しましたが、ロード中のモデルがありません | LM Studioでモデルをロードする |
| 停止時Copilot接続失敗 | サーバーは停止しましたが、Copilotにも接続できません | Copilotのサインイン状態を確認する |

エラー詳細は OutputChannel に記録し、画面にはコマンドの生出力やスタックトレースを表示しない。

## 12. テスト手順

### 12.1 サービス単体テスト

現在は自動テスト用スクリプトがないため、CLI 実行部分を注入可能な関数またはインターフェースにして、次をテストできる構造にする。

- status JSON の正常解析
- `running: true` / `false`
- 不正JSON
- CLI未検出
- 非0終了コード
- 起動タイムアウト
- 停止タイムアウト
- HTTP応答あり・CLI停止中
- 対象ポートがLM Studio以外のサービス
- 二重起動、二重停止の抑止

実際の利用者の LM Studio サーバーを自動テストから起動・停止しない。コマンド実行と HTTP プローブはモックする。

### 12.2 Controller テスト

- 設定画面遷移時に状態確認される
- 起動成功後にモデル一覧が更新される
- 起動成功・モデル0件で警告になる
- 停止時にLM Studio接続が破棄される
- 停止時にCopilot設定へ戻る
- Copilot接続中のLM Studio停止でCopilotへ影響しない
- 操作中の再操作が無視される
- 回答生成中は停止できない
- 未保存設定の保護条件が機能する

### 12.3 Webview 表示確認

- LM Studio選択時だけサーバーカードが表示される
- 各サーバー状態で文言、アイコン、ボタンが一致する
- 操作中に連打できない
- 各機能タイトルに指定アイコンが1つだけ表示される
- textarea の label 関連付けが維持される
- キーボードだけでボタン操作できる
- スクリーンリーダーで状態変化が通知される
- 320px程度の狭い幅で横スクロールが発生しない
- ライトテーマ、ダークテーマ、ハイコントラストテーマで判読できる
- 保存バー表示中もサーバーボタンと重ならない

### 12.4 手動結合確認

1. LM Studio GUI を閉じた状態で VS Code を起動する
2. 設定画面で LM Studio を選択する
3. 「サーバーを起動」を押す
4. GUIを手動で開かなくても `localhost:1234` が起動中になることを確認する
5. LM Studio側で複数モデルをロードする
6. NaviComの一覧更新で全モデルが表示され、1つだけ選べることを確認する
7. NaviComから推論できることを確認する
8. 回答生成中は停止できないことを確認する
9. 待機中にサーバーを停止する
10. HTTPサーバーが停止し、NaviComがCopilotへ戻ることを確認する
11. LM Studio GUI側でサーバーを起動し、NaviComに起動中と表示されることを確認する
12. NaviComから停止し、GUI側の表示も停止へ変わることを確認する

## 13. ビルド・完了確認

実装後に次を実行する。

```bash
npm run compile:ext
npm run build:webview
npm run compile
```

F5 の Extension Development Host で設定画面を確認する。Activity Bar または Webview が表示されない場合は、コンパイル結果だけでなく VS Code の保存済み view state も確認する。

- `View: Reset View Locations`
- 開発用 `--user-data-dir`
- `workbench.activity.viewletsWorkspaceState`
- `workbench.auxiliarybar.viewContainersWorkspaceState`
- `workbench.view.extension.aiPairNavigator.state`

## 14. 推奨実装順序

1. 共通型とサーバー状態モデルを追加
2. `LmStudioServerService` とCLI検出を実装
3. 状態確認・HTTP照合を実装
4. 起動・停止とタイムアウトを実装
5. Controllerへの注入とViewModel連携
6. Webviewメッセージ処理を追加
7. 設定画面にサーバーカードを追加
8. `SettingTitle` と全タイトルアイコンを追加
9. CSSで幅・余白・テーマ・レスポンシブを調整
10. エラー表示とOutputChannelログを追加
11. 単体テストとControllerテストを追加
12. F5でGUIなし起動、GUI起動、複数モデル、停止時Copilot復帰を確認

## 15. 完了条件

- LM Studio GUI を手動で開かなくても、NaviComからLocal Serverを起動できる
- NaviComからLocal Serverを停止できる
- 起動・停止状態が設定画面へ正しく反映される
- 起動後にロード済みモデルが自動更新される
- サーバー停止とモデル未ロードが別の状態として表示される
- LM Studio接続中の停止後、接続先が不正なLM Studio設定のまま残らない
- CLI未検出、Workspace Trust、ポート競合、タイムアウトを区別できる
- 各機能タイトルのアイコン、文字、説明、操作部品の左端と余白が揃っている
- 狭い幅と主要VS Codeテーマでレイアウトが崩れない
- キーボード操作と状態読み上げが利用できる
- `npm run compile` が成功する

