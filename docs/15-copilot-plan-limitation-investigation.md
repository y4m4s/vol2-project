# 15. Copilot Free プランで起動できない件の調査メモ

## 背景

「Copilot Student のような上位プランでないと起動しない。Copilot Free でも使えるようにしたい」という要望を受けて、
本拡張のコード内にプラン（Free / Pro / Student / Business）を判定・ブロックしている箇所があるかを調査した。

## 結論

**本拡張のコード側には、独自にプランを判定・ブロックしているロジックは存在しない。**

起動可否は VS Code Language Model API（`vscode.lm.selectChatModels`）が返すモデル一覧に委ねられており、
その一覧は GitHub Copilot Chat 拡張本体（＝ GitHub 側）がアカウントのプランに応じて決めている。
本拡張はこの結果を受け取るだけで、プラン種別そのものを判定するフィールドや分岐は持っていない。

## 調査した根拠

### 1. プロダクトの実態

- `package.json` より、本拡張は VS Code 拡張機能「NaviCom」（`ai-pair-navigator`）
- GitHub Copilot の公式 API を直接叩くのではなく、VS Code が提供する `vscode.lm`（Language Model API）を介して
  Copilot Chat 拡張のモデルを呼び出す構成（[04-connection-flow.md](04-connection-flow.md) 参照）

### 2. 接続・モデル選定ロジック（`src/services/ConnectionService.ts`）

- `fetchCopilotModels()`（136 行目付近）が `vscode.lm.selectChatModels({ vendor: "copilot" })` を呼び、
  そのアカウントで使えるモデル一覧をそのまま受け取る
- 5〜20 行目のコメント：

  > 2026/6 の AI Credits 移行で無料モデルが廃止されたため、クレジット単価の安い順に選ぶ
  > (GPT-4.1 / GPT-4o は廃止済み)

  これが実質的な原因。`LOW_COST_COPILOT_MODEL_PRIORITY` には `gpt54nano` / `gpt5mini` / `raptormini` / `gemini3flash`
  のみが登録されており、Free プランで実際に提供され得るモデルが選択候補にない場合がある
- `connectInternal()`（102〜106 行目）：`selectableModels` が空、または該当モデルが見つからない場合は
  `connectionState = "unavailable"` としてブロックする
- `classifyConnectError()`（229〜235 行目）：`vscode.LanguageModelError` の `code === "NoPermissions"` は
  `"disconnected"`、それ以外は `"unavailable"` に分類。Copilot 側の権限・プラン起因のエラーもここに吸収される

### 3. モデル一覧のレスポンス型に「プラン」情報はない

- `vscode.LanguageModelChat`（`id` / `name` / `family` / `version` / `maxInputTokens`）には
  サブスクリプションプラン種別（Free / Pro / Student / Business）を示すフィールドが存在しない
- つまりコード側で `"student"` や `"plan"` を文字列判定している箇所は無い
  （`ModelProfile.ts` にある `family` / `vendor` の判定は、Anthropic / OpenAI / Google 系モデルかどうかを
  推定するためのもので、プラン判定とは無関係）

### 4. README の記載

`README.md` 77〜79 行目：

```
- **GitHub Copilot** サブスクリプションおよび **GitHub Copilot Chat** 拡張機能のインストール・サインイン済みであること
　※学生用のGitHub Educationというプランに入っていると、無料で利用できます
```

これは前提条件の説明であり、コード上の分岐ロジックではない。

## 実質的な原因

「起動しない」のは本拡張の実装起因ではなく、**GitHub Copilot 本体側が 2026/6 の AI Credits 移行以降、
Free プランのアカウントに対して利用可能なモデルを提供していない（または本拡張が優先的に選ぼうとする
低コストモデルがそのアカウントでは選択肢に出てこない）ため**、`vscode.lm.selectChatModels` の返却結果が
空、または期待するモデルを含まない状態になっていることに起因する。

## 対応方針についての判断

GitHub Copilot 側が意図的に制御しているモデル提供可否（エンタイトルメント）を、本拡張側のコードで
偽装・回避する対応は行わない（利用規約上の認証・エンタイトルメント回避に当たるおそれがあるため）。

検討可能な代替案：

- `LOW_COST_COPILOT_MODEL_PRIORITY` を見直し、Free プランで実際に許可されているモデルがあれば
  それを優先候補に含める（Copilot 側が Free 向けに何らかのモデルを提供している場合に限る）
- GitHub Copilot 以外の provider（ユーザー自身の API キーで Anthropic / OpenAI / Google 等のモデルを
  直接呼ぶモード）を追加し、Copilot Chat 拡張への依存を前提としない経路を用意する

いずれの方向で進めるかは要検討・未着手。
