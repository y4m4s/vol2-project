# 17. OrcaRouter 導入設計

## 目的

200種類以上の AI モデルを OpenAI 互換の単一 API でまとめて利用できる AI 推論ゲートウェイ「OrcaRouter」を、3つ目の AI プロバイダとして追加する。

- 現状、AI 利用基盤は `GitHub Copilot`（VS Code Language Model API）と `LM Studio`（ローカル OpenAI 互換 API）の2系統（[01-overview.md](./01-overview.md)）。
- OrcaRouter は「OpenAI 互換 API を HTTP で叩く」という点で LM Studio 連携と同種であり、既存の `LmStudioClient.ts` をベースに流用できる。
- 最大の差分は **認証（API キー）が必須である点**と、**選択可能なモデル数が桁違いに多い点**の2つ。

## 前提: 既存のプロバイダ抽象化

このプロジェクトは既にプロバイダ非依存の3層構造になっており、OrcaRouter はこの構造にそのまま乗せられる。

```
AdviceService（LLM呼び出しの唯一の窓口）
   │  ConnectedProviderModel.requestText() だけを呼ぶ
   ▼
ConnectionService（プロバイダの選択・接続状態管理）
   ├─ createCopilotModel()   → vscode.lm.selectChatModels(...)
   ├─ createLmStudioModel()  → LmStudioClient
   └─ createOrcaRouterModel() → OrcaRouterClient（新規）
```

- `ConnectedProviderModel`（[ConnectionService.ts:22](../src/services/ConnectionService.ts#L22)）: `requestText()` を持つ共通インターフェース。`AdviceService` はこの型だけを見ており、プロバイダの違いを一切知らない。
- `AiProviderId`（[types.ts:9](../src/shared/types.ts#L9)）: 現状 `"copilot" | "lmStudio"`。ここに `"orcaRouter"` を追加するのが起点になる。
- したがって **`AdviceService.ts` 本体（プロンプト構築・要約処理など）は変更不要**。変更が必要なのは接続まわり（`ConnectionService` / 新規クライアント / 設定 / UI）に閉じる。

## 必要な作業

### 17.1 クライアント実装（新規）

`src/services/OrcaRouterClient.ts` を新規作成し、`LmStudioClient.ts`（[LmStudioClient.ts](../src/services/LmStudioClient.ts)）をベースに流用する。

- `listModels()`: OrcaRouter のモデル一覧エンドポイントを叩き、選択 UI 用にモデル ID・表示名を取得する。
- `createCompletion()`: `/v1/chat/completions` へ POST。リクエストボディの形状は `LmStudioClient.createCompletion()`（[LmStudioClient.ts:86](../src/services/LmStudioClient.ts#L86)）とほぼ同一で流用可能。
- **主要な差分（LM Studio との違い）**:
  - `Authorization: Bearer <APIキー>` ヘッダーが必須（LM Studio は localhost 前提で認証なし）。
  - `normalizeBaseUrl()`（[LmStudioClient.ts:33](../src/services/LmStudioClient.ts#L33)）はローカルホストのみ許可する実装になっているため、そのままは使えない。OrcaRouter 用に「HTTPS の外部ホストを許可する」バリデーションを別途用意する。
  - エラー分類（`LmStudioFailureKind` 相当）に、認証失敗（401）・クォータ超過（429）等、外部 SaaS API 特有のケースを追加する。
  - レスポンスの `usage`（`prompt_tokens` / `completion_tokens`）から `ProviderTextResponse.inputTokens` / `outputTokens` を埋める処理は LM Studio 実装をそのまま流用できる見込み。

### 17.2 APIキーの保存

- 平文保存は避け、`vscode.SecretStorage`（拡張の Secret Storage API）に保存する。
- 既存の `NavigatorSettings`（[types.ts:145](../src/shared/types.ts#L145)）は `lmStudioBaseUrl` のように非機密情報のみを保持している。APIキーはここに含めず、`ConnectionService` から `SecretStorage` 経由で読み書きする専用メソッドを設ける。
- キー未設定・失効時の接続状態（`disconnected` 系）の扱いを既存の `CopilotConnectionIssue` / `LmStudioConnectionIssue` に倣って `OrcaRouterConnectionIssue` として定義する。

### 17.3 型・設定の追加

- `AiProviderId`（[types.ts:9](../src/shared/types.ts#L9)）に `"orcaRouter"` を追加。
- `NavigatorSettings`（[types.ts:145](../src/shared/types.ts#L145)）に `orcaRouterBaseUrl` / `orcaRouterModelId` 等、LM Studio 側フィールドに対応する項目を追加。
- `OrcaRouterModelOption`（`CopilotModelOption` / `LmStudioModelOption` 相当、[types.ts:159-168](../src/shared/types.ts#L159-L168)）を追加し、`NavigatorViewModel`（[types.ts:349-351](../src/shared/types.ts#L349-L351)）に `orcaRouterModelOptions` を追加。

### 17.4 `ConnectionService` の拡張

- `createOrcaRouterModel()`（[ConnectionService.ts:356](../src/services/ConnectionService.ts#L356) の `createLmStudioModel()` に相当）を追加し、`ConnectedProviderModel` を返す。
- モデル一覧取得・接続確立・エラー時のステート遷移（`markRestricted` / `markUnavailable` 等、既存パターンに準拠）を追加する。
- LM Studio 同様、`profileSource` に OrcaRouter 側のモデルメタ情報を詰める。

### 17.5 UI

- 接続設定画面にプロバイダ選択肢として OrcaRouter を追加。
- APIキー入力欄（マスク表示、`SecretStorage` に保存）を追加。
- モデル選択 UI: 200種類以上を一覧表示するのは非現実的なため、検索・絞り込み（インクリメンタルサーチ）を前提にした UI が必要。既存の `CopilotModelOption` 選択 UI をそのまま流用すると一覧が長大になるため、UI 側は別途検討が必要。

### 17.6 トークン使用量・課金の反映

- `UsageMeter`（既存の使用量記録）に OrcaRouter 利用時のトークン数を記録する。`recordUsage`（[AdviceService.ts:184](../src/services/AdviceService.ts#L184) 付近）は `ConnectedProviderModel.requestText()` の戻り値（`inputTokens` / `outputTokens`）を経由するため、`OrcaRouterClient` が `usage` を正しく返せば自動的に日次集計へ乗る。
- OrcaRouter はモデルごとに料金体系が異なる可能性が高い。トークン数だけでなく概算コスト表示を出す場合は、モデルごとの単価情報をどこから取得するか別途検討が必要（本設計のスコープ外、残課題とする）。

## スコープ外（将来検討）

- モデルごとの料金レート表示・予算管理との連携。
- OrcaRouter 側のレート制限・エラーへの自動リトライ。
- Copilot / LM Studio と同様の「自動ルーティングモデル」相当の概念が OrcaRouter 側にあるかどうかの調査、およびあった場合の対応。
- 200種類のモデルに対するお気に入り登録・最近使ったモデルの記憶などの UX 改善。

## 実装順（案）

1. `AiProviderId` に `"orcaRouter"` を追加し、`NavigatorSettings` / `NavigatorViewModel` に関連フィールドを追加する（17.3）。
2. `src/services/OrcaRouterClient.ts` を新規作成する（`LmStudioClient.ts` をベースに、認証ヘッダーと外部ホスト許可のバリデーションを差し替える）（17.1）。
3. APIキーの `SecretStorage` 保存・読み出しの仕組みを `ConnectionService` に追加する（17.2）。
4. `ConnectionService` に `createOrcaRouterModel()` とモデル一覧取得・接続状態管理を追加する（17.4）。
5. 接続設定 UI にプロバイダ追加・APIキー入力・モデル検索 UI を追加する（17.5）。
6. `UsageMeter` への反映を確認する（17.6）。
7. 動作確認（Copilot / LM Studio と同様に接続 → モデル選択 → アドバイス生成が一通り動くこと）。
