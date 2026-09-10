# LM Studioの現状実装

確認日: 2026-09-09。[プロバイダー一覧](README.md)

## 接続とモデル選択

- 内部IDは `lmStudio`。既定URLは `http://127.0.0.1:1234`、保存項目は `lmStudioBaseUrl` と `lmStudioModelKey`。
- HTTP(S)のルートURLで、ホストは `127.0.0.1`、`localhost`、`::1` のみ許可する。設定画面にURLの自由入力欄はない。
- `GET /api/v1/models` を5秒でタイムアウトさせる。`type === "llm"` かつ `loaded_instances.length > 0` のモデルだけを選択肢にする。識別子は `models[].key`。
- 保存済みモデルがロード中なら再利用する。見つからない・未ロードなら選択を解除し、ロード中モデルが1件なら自動選択、複数ならQuickPick、0件なら `unavailable` とする。
- モデル一覧取得と選択で接続を確認し、生成probeは送らない。モデルのダウンロード・自動ロード・個別アンロードは実装しない。
- APIトークンの設定やAuthorizationヘッダーはない。401/403は認証設定の確認を案内する。

## 推論

`OpenAICompatibleClient` を継承し、`POST /v1/chat/completions` に選択したkey、system/userメッセージ、用途別 `max_tokens`、`stream: false` を送る。タイムアウトは120秒で、キャンセル・受信サイズ制限・リダイレクト拒否に対応する。

参照ファイルパスは `navicom_referenced_files` にも付加する。本文は通常のプロンプト内に含まれる。応答本文、`usage.prompt_tokens`、`usage.completion_tokens`、`model`、`finish_reason` を読む。トークン数が得られない場合は共通の概算を使う。利用量を記録し、日次トークンガードも適用する。旧設計書の「日次予算の対象外」という記述は現行実装とは異なる。

接続切り替えに失敗した場合、Coordinatorは設定をCopilotへ戻し、既存Copilot接続を利用するか接続を試す。推論失敗時は他プロバイダーへ再送しない。

## サーバー操作と画面

設定画面からLocal Serverの状態更新・起動・停止を実行できる。`LmStudioServerService` は `lms server status --json --quiet`、`lms server start --port … --bind 127.0.0.1`、`lms server stop` を実行する。CLIはユーザーの `.lmstudio/bin` とPATHから検出し、`execFile` で実行する。

CLIの状態だけでなくHTTP応答・ポート状態も照合する。起動中、停止中、CLI未検出、認証要求、ポート競合、設定ポートとの不一致などを区別する。CLIの通常待機は15秒、起動は75秒、HTTP確認は2秒、遷移確認は10秒。

ポート不一致時は「実行中ポートへ接続先を変更」または「設定ポートで再起動」を選べる。起動成功後はロード中モデルを更新するが、モデル未ロードはサーバー停止と区別する。LM Studio利用中の停止成功後は接続を解除し、Copilot設定へ戻して接続を試す。

Workspace Trust未許可では操作できず、生成などの処理中は起動・停止を抑止する。設定タイトルのアイコンとサーバーカードは設定画面に実装済みで、旧文書の追加実装手順は不要になっている。

## 実装・検証箇所

- [LmStudioClient.ts](../../src/services/LmStudioClient.ts)、[OpenAICompatibleClient.ts](../../src/services/OpenAICompatibleClient.ts)
- [LmStudioServerService.ts](../../src/services/LmStudioServerService.ts)、[LmStudioServerProtocol.ts](../../src/services/LmStudioServerProtocol.ts)
- [LmStudioCoordinator.ts](../../src/application/coordinators/LmStudioCoordinator.ts)
- [LmStudioClient.test.ts](../../test/LmStudioClient.test.ts)、[LmStudioServerProtocol.test.ts](../../test/LmStudioServerProtocol.test.ts)、[ConnectionService.test.ts](../../test/ConnectionService.test.ts)

実機確認では、サーバー未起動・モデル未ロード・複数モデル・認証有効・ポート不一致・停止後のCopilot復帰を確認する。F5で画面自体が出ない場合は、ビルド結果に加えてVS Codeの保存済みview stateや `View: Reset View Locations` も確認する。
