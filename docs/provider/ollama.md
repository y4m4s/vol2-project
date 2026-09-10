# Ollamaの現状実装

確認日: 2026-09-09。[プロバイダー一覧](README.md)

## 接続と設定

内部IDは `ollama`。`ollamaBaseUrl`（既定 `http://localhost:11434`）と `ollamaModelKey` をワークスペースへ保存する。設定画面でURLとモデルを変更できる。

URLはHTTP(S)のルートを要求し、ユーザー名・パスワード、パス、クエリ、フラグメントを拒否する。LM Studioと異なり別ホストも許可するため、設定したホストへコードや追加コンテキストが送られる。APIキー設定はなく、Authorizationヘッダーも送らない。

Ollama本体のインストール・起動とモデルのインストールはユーザーが行う。NaviComはHTTP APIのみを使用し、プロセス起動・終了やモデルダウンロードを行わない。

## モデル一覧と選択

`GET /api/tags` を5秒でタイムアウトさせる。ロード中に限らずインストール済みモデルを取得し、`name`（なければ `model`）を識別子・表示名に使う。重複や不正な識別子を除外する。

保存済みモデルが存在すれば使い、保存済み指定がなければ1件を自動選択、複数ならQuickPickを表示する。保存済みモデルが一覧から消えた場合は指定を解除して選び直しを案内し、その接続試行では別モデルを自動選択しない。0件・一覧取得失敗・選択キャンセルは接続不可。生成probeは送らない。

設定画面ではURL変更から400ms後に一覧を更新し、手動更新にも対応する。取得元URLを一覧とともに保持して別URLの候補を混在させず、古い取得結果が新しい一覧を上書きしないようにする。

## 推論とモデル解放

`OpenAICompatibleClient` を共有し、`POST /v1/chat/completions` にsystem/userメッセージ、モデル、用途別 `max_tokens`、`stream: false` を送る。Ollamaの助言では推論強度「高」を `reasoning_effort: "high"`、「低」を `"none"` に対応させる。形式修復でも元の指定を保持し、ナレッジ生成など指定のない用途は `"none"`。Thinking対応モデルで有効になり、モデルによって対応状況は異なる。専用のreasoningフィールドは回答として表示・保存せず、contentだけを処理する。出力上限は低・高とも8,192で、上限到達・キャンセル・タイムアウトは既存のエラー処理を維持する。参照パスの `navicom_referenced_files` も共通処理から付加する。

低・高とも従来の高相当の文脈収集と回答指示を使い、Thinkingだけ切り替える。UI・履歴・送信計画の低／高ラベルはユーザーの選択を維持する。識別子は `2026-09-10-ollama-content-depth-v1`。実機評価で新しい低は縦並び3条件中2条件を検出、1件はno_adviceとなり、完成済みHelloはno_adviceだった。記録は `.test-out/ollama-new-low.json`、`.test-out/ollama-new-low-hello.json`。単体テスト210件・lint・ビルド成功。

公式仕様: https://docs.ollama.com/api/openai-compatibility 、https://docs.ollama.com/capabilities/thinking 。この変更はOllama用であり、他プロバイダーに未対応のパラメーターは送らない。

生成タイムアウトは120秒。キャンセル・受信サイズ制限・リダイレクト拒否に対応し、本文・トークン数・解決後モデル・終了理由を読む。表示は生成完了後で、日次トークンガードも適用する。

別プロバイダーへの切り替えが成功すると、最後に生成で使用したモデルへ `POST /api/generate` を `{ model, keep_alive: 0, stream: false }` で送る。最大2秒のbest-effortで、失敗はログへ記録して切り替えを継続する。生成未実施の場合、Ollama内のモデル切り替え、拡張終了時にはこの解放処理を行わない。

切り替え失敗時は通常は前の接続を保持する。ただし、同じURLのモデル一覧で削除が確認できたOllamaモデルへの接続は復元しない。LM StudioのようなCopilotへの自動フォールバックはない。

## 実装・検証箇所

- [OllamaClient.ts](../../src/services/OllamaClient.ts)、[OpenAICompatibleClient.ts](../../src/services/OpenAICompatibleClient.ts)
- [ConnectionService.ts](../../src/services/ConnectionService.ts)、[設定画面](../../src/views/screens/s06-settings.tsx)
- [OllamaClient.test.ts](../../test/OllamaClient.test.ts)、[ConnectionService.test.ts](../../test/ConnectionService.test.ts)

実機ではURL変更、未起動、モデル追加・削除、生成、他プロバイダーへの切り替え後の解放を確認する。
