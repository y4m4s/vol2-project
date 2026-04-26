# 04. 初回接続フロー

## 目的

本拡張が GitHub Copilot を VS Code Language Model API 経由で利用するための初回接続手順を定義する。  
拡張は GitHub 認証や Copilot 用トークンを自前管理せず、VS Code / Copilot 側の認証・同意フローを利用する。

## 前提条件

- 対応環境は `VS Code Desktop`
- ユーザーが `GitHub Copilot` を利用可能な状態であること
- ワークスペースが `Trusted` であること
- ネットワーク接続が利用可能であること

## 初期表示

- 初回表示時、状態を `未接続` として表示する
- `GitHub Copilot + VS Code Language Model API` を利用することを明示する
- 文脈付き相談、会話継続、履歴、ナレッジ保存の概要を表示する
- `Copilotに接続` ボタンを表示する
- 接続前は `常時モード` に切り替えられないものとする

## 接続開始

1. ユーザーが `Copilotに接続` を押下する
2. 拡張は `vscode.lm.selectChatModels({ vendor: 'copilot' })` を呼び出す
3. 利用可能モデルが取得できるかを確認する
4. 必要に応じて VS Code / Copilot の同意フローを通す

## 接続完了条件

- Copilot モデルを取得できた
- 拡張に対するモデル利用同意が完了した
- ワークスペースが Trusted である
- 初回リクエストが正常終了した

## 接続情報の扱い

- 拡張は Copilot の認証情報やアクセストークンを保存しない
- 接続状態や設定のみをローカルに保持する
