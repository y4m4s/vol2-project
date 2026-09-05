# 19. OrcaRouter 仕様まとめ

[17. OrcaRouter導入設計・実装](17-orca-router-integration-design.md)の要点整理版。詳細な実装判断の理由や送信データの詳細はそちらを参照。

## 位置づけ

OpenAI互換の推論ゲートウェイ。GitHub Copilot、LM Studioに続く3つ目のAIプロバイダとして統合。

## API

- ベースURL: `https://api.orcarouter.ai/v1`（固定）
- モデル一覧: `GET /models`
- 推論: `POST /chat/completions`
- OpenAI SDK不使用、`fetch`でOpenAI互換JSONを直接扱う
- タイムアウト: モデル一覧10秒、推論120秒

## APIキー

- 形式は`sk-orca-`固定
- VS CodeのSecretStorageに保存（会話履歴・ログ・Webviewには出さない、値自体は返さない）
- 推論直前に毎回最新値を取得（置換後は再接続不要）

## モデル一覧

- `GET /models`のうち、OpenAI互換・テキスト入出力対応のものだけ表示
- 固定選択肢として `orcarouter/free`（無料容量のみ、初期値）と `orcarouter/auto`（自動ルーティング、有料になりうる）を追加提示
- APIキー保存時に自動取得、手動更新も可

## 推論と利用量

- リクエストに`X-OrcaRouter-Include-Cost: true`
- 応答から`prompt_tokens` / `completion_tokens` / `cost_usd`を記録
- `cost_usd`は「応答時点の記録料金」であり確定請求額ではない

## エラー分類

| ステータス | 意味 |
|---|---|
| 401 | キー不正 |
| 402/403 | 残高・無料枠・上限・権限 |
| 429 + Retry-Afterあり | レート/無料枠上限（時間を置いて再試行） |
| 429 + Retry-Afterなし | 無料モデルの入力上限（文脈短縮が必要） |
| 425/500/502/503 | サービス利用不可 |
| 408/504/Abort | タイムアウト/キャンセル |

認証・残高・上限以外の4xxは接続を維持したままリクエスト単位の拒否として扱う。Guardrail拒否は専用メッセージ。

## データ送信

プロンプト・診断情報・ファイル名構造・会話内容・フィードバック傾向などがOrcaRouterと上流モデル事業者に送信される（補足コメントは除く）。既存の除外globはファイル本文に適用、APIキーは送らない。

## Guardrail/Firewall

NaviCom自身はポリシーを作成・有効化しない。設定はOrcaRouter側に依存。現状ツール呼び出しは扱わないため、Firewall（ツール実行制御）は対象外。

## テスト方針

モック応答での自動テストのみ。実APIキーでの通信試験は自動テスト対象外、手動試験は`orcarouter/free`から開始。

## 関連ドキュメント

- [17. OrcaRouter導入設計・実装](17-orca-router-integration-design.md) — 実装判断の詳細
- [18. OrcaRouter連携における不都合リスク](18-orca-router-risk-notes.md) — 本仕様が変更された場合のリスクと検知方針
