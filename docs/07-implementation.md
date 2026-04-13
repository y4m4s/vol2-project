# 07. 実装方針

## UI 方針

- v1 は `WebviewView` を用いたサイドバー UI とする
- Copilot Chat 参加者ではなく、独自 UI を中心に設計する
- 接続状態、送信範囲、参照根拠を UI 上で明示する

## アーキテクチャ方針

以下のレイヤ分割を想定する。

- UI 層: WebviewView
- アプリケーション層: 画面状態とユースケース制御
- 文脈収集層: Editor、diagnostics、symbols、recent edits の取得
- モデル呼び出し層: GitHub Copilot + VS Code Language Model API
- ナレッジ層: SQLite によるローカル保存

## モデル呼び出し方針

- `vscode.lm.selectChatModels({ vendor: 'copilot' })` を利用する
- 初回接続はユーザー操作起点で開始する
- 拡張は Copilot の OAuth やトークン管理を自前実装しない

## 今後の設計タスク候補

- 送信対象の優先順位と上限制御の詳細化
- 最近の編集範囲の定義
- 関連シンボル取得の戦略
- ナレッジ自動抽出ルール
- プロンプト設計
- SQLite スキーマ設計
- React ベース UI 実装
- テスト戦略の具体化

## 補足

本章は v1 の要件整理を前提とした実装方針であり、詳細設計書、データ定義、イベント一覧、状態管理設計へ分割していく前段のドキュメントとして扱う。
