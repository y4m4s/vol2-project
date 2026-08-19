# 16. Good/Bad フィードバック機能 実装まとめ

設計意図は [13-feedback-learning-design.md](./13-feedback-learning-design.md) を参照。本ドキュメントは実装コミット（`1122837`）の内容を元に、実際に何がどう繋がっているかを実装ファイル単位でまとめる。

## 16.1 全体の流れ

```
[会話画面] Good/Badボタン
   │
   ├─ Good → 即時確定
   └─ Bad  → 理由入力フォームへ遷移 → 送信で確定
   │
   ▼
NavigatorController.markAdviceFeedback()
   会話履歴（ConversationEntry.feedback）に評価を記録・永続化
   │
   ▼
NavigatorController.summarizeAndSaveFeedback()
   ├─ AdviceService.summarizeFeedback() … LLM呼び出しで英語1文に要約
   └─ FeedbackStore.saveFeedback()     … feedback.sqlite に永続化
   │
   ▼（次回以降の manual / context アドバイス生成時）
NavigatorController.executeGuidanceRequest()
   feedbackStore.getTendencySummary() で直近Good/Bad要約を取得
   │
   ▼
PromptBuilder.buildGuidancePrompt()
   "## Recent feedback trends (follow if possible)" / "(avoid)" として
   プロンプトに注入 → LmStudio/Copilot に送信
```

`kind === "always"`（常時実行のアドバイス）には注入されない。ユーザーが能動的に相談した場合（manual/context）のみ、過去の評価傾向が反映される。

## 16.2 追加・変更ファイルと役割

### データ層

- **[src/services/FeedbackStore.ts](../src/services/FeedbackStore.ts)**（新規）
  評価データの永続化を担当する sql.js ベースのストア。`ConversationStore` / `KnowledgeStore` と同じ構成に倣い、責務ごとに DB ファイルを分離する方針で `feedback.sqlite` を単独管理する。
  - `advice_feedback` テーブル：評価（good/bad）、理由（JSON配列）、自由記述コメント、LLM要約結果、要約ステータスを保持
  - `saveFeedback()`：1件のFBをINSERT
  - `getTendencySummary(limit=5)`：`summary_status='ok'` のレコードを rating別に直近N件取得し、`{ goodPatterns, badAvoidPatterns }` として返す。DB読み取りのみでLLM呼び出しは発生しない
  - 保存先は `context.globalStorageUri/feedback.sqlite`（[extension.ts:41](../src/extension.ts#L41)）

### LLM連携層

- **[src/services/AdviceService.ts](../src/services/AdviceService.ts)**（変更）
  - `summarizeFeedback(input)` を追加。評価対象のアシスタント回答抜粋・理由・コメントから、英語1文（120文字以内）の要約をLLMに生成させる（`buildFeedbackSummaryPrompt`）
  - 要約に失敗した場合は `FeedbackSummaryResult.status = "failed"` を返し、`FeedbackStore` 側で `goodPatterns`/`badAvoidPatterns` に含めない
  - 要約プロンプトは日本語コメントも英語に正規化して1文で返すよう指示している

- **[src/services/PromptBuilder.ts](../src/services/PromptBuilder.ts)**（変更）
  - `buildGuidancePrompt` の入力に `feedbackTendency?: FeedbackTendencySummary` を追加
  - `kind !== "always"` かつ `goodPatterns`/`badAvoidPatterns` が存在する場合、それぞれ `## Recent feedback trends (follow if possible)` / `(avoid)` セクションとして箇条書きでプロンプトに注入（[PromptBuilder.ts:180-194](../src/services/PromptBuilder.ts#L180-L194)）
  - 見出しは英語固定（トークン削減とLLMの指示追従性のため。13.10参照）

### アプリケーション層（状態管理・フロー制御）

- **[src/application/NavigatorController.ts](../src/application/NavigatorController.ts)**（変更）
  - `rateAdvice(conversationEntryId, rating)`：Good/Badボタン押下のエントリポイント。Goodは即時確定、Badは `feedback_form` 画面に遷移してから確定
  - `submitBadFeedback(reasons, comment)` / `cancelBadFeedback()`：Bad評価フォームの送信・キャンセル
  - `markAdviceFeedback()`：`ConversationEntry.feedback` を更新し会話履歴に永続化（二重評価防止のガードあり：`entry.feedback` が既にあれば無視）
  - `summarizeAndSaveFeedback()`：`AdviceService.summarizeFeedback()` → `FeedbackStore.saveFeedback()` を呼ぶ橋渡し。UIをブロックしないよう `void` で非同期実行し、失敗時は `console.error` のみ
  - `executeGuidanceRequest()` 内で `feedbackTendency: options.kind === "always" ? undefined : this.feedbackStore.getTendencySummary()` を組み立て、`AdviceService.requestGuidance()` に渡す（[NavigatorController.ts:1155](../src/application/NavigatorController.ts#L1155)）

- **[src/services/ConversationStore.ts](../src/services/ConversationStore.ts)**（変更）
  会話履歴のスキーマに評価済み状態（`feedback` カラム相当）を追加し、アプリ再起動後も評価済みかどうかが復元されるようにした

- **[src/extension.ts](../src/extension.ts)**（変更）
  `FeedbackStore` のインスタンス化と `NavigatorController` へのDI追加（[extension.ts:41](../src/extension.ts#L41)）

### 型定義

- **[src/shared/types.ts](../src/shared/types.ts)**（変更）
  - `FeedbackRating`（`"good" | "bad"`）
  - `BadFeedbackReason`（`too_long` / `off_topic` / `gives_answer` / `too_vague` / `other`）
  - `AdviceFeedbackInput`（保存リクエストの入力形）
  - `FeedbackSummaryStatus` / `FeedbackSummaryResult`（要約の成否と本文）
  - `FeedbackTendencySummary`（`goodPatterns` / `badAvoidPatterns`）
  - `ConversationEntry.feedback?: FeedbackRating` を追加
  - `NavigatorSessionState.pendingFeedbackEntryId`：Bad評価フォーム表示中に対象エントリIDを保持
  - `NavigatorScreen` に `"feedback_form"` を追加

- **[src/shared/messages.ts](../src/shared/messages.ts)**（変更）
  Webview↔拡張間のメッセージに `rateAdvice` / `submitBadFeedback` / `cancelBadFeedback` を追加

### UI層（Webview）

- **[src/views/screens/s09-feedback-form.tsx](../src/views/screens/s09-feedback-form.tsx)**（新規）
  Bad評価専用の理由入力画面。理由の複数選択チェックボックス（`REASON_OPTIONS`）と任意コメント欄を持つ。送信で `submitBadFeedback` メッセージを送出、キャンセルで `cancelBadFeedback`
- **[src/views/css/s09-feedback-form.css](../src/views/css/s09-feedback-form.css)**（新規）
  s09画面のスタイル
- **[src/views/screens/s04-conversation.tsx](../src/views/screens/s04-conversation.tsx)**（変更）
  アシスタント回答ごとにGood/Badボタンを表示。`feedback` が既にセットされている場合はボタンを無効化し評価済み表示に切り替える（`s04-response-action ... active feedback-good/bad`）
- **[src/views/webview/App.tsx](../src/views/webview/App.tsx)**（変更）
  `feedback_form` 画面のルーティング追加
- **[src/views/NavigatorViewProvider.ts](../src/views/NavigatorViewProvider.ts)**（変更）
  Webviewからの `rateAdvice` / `submitBadFeedback` / `cancelBadFeedback` メッセージを `NavigatorController` の対応メソッドにディスパッチ

### 評価・テスト

- **[src/eval/fixtures.ts](../src/eval/fixtures.ts)**（変更）
  `feedbackTendency` ありのプロンプト生成フィクスチャを追加。`always` 系では注入されないことを検証する静的evalケースを含む

## 16.3 DBスキーマ（実体）

保存先: `<globalStorageUri>/feedback.sqlite`（VS Code拡張のグローバルストレージ配下、拡張ID `local-dev.ai-pair-navigator`）

```sql
CREATE TABLE IF NOT EXISTS advice_feedback (
  id TEXT PRIMARY KEY,
  conversation_entry_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
  advice_kind TEXT NOT NULL,
  assistance_depth TEXT,
  slash_command TEXT,
  advice_text_excerpt TEXT NOT NULL,
  reasons_json TEXT,
  comment TEXT,
  summary_text TEXT,
  summary_status TEXT NOT NULL CHECK (summary_status IN ('ok', 'failed', 'skipped')) DEFAULT 'ok',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_advice_feedback_entry ON advice_feedback(conversation_entry_id);
CREATE INDEX IF NOT EXISTS idx_advice_feedback_rating_created ON advice_feedback(rating, created_at);
```

## 16.4 動作確認済みの事項（2026-07-17）

`AdviceService.buildPrompt()` に一時的なOutput Channelログを仕込み、実際にLmStudioへ送信される最終プロンプトを目視確認した。`manual` 種別のリクエストで、DBに保存済みの要約が実際に以下の形でプロンプトへ注入されることを確認済み。

```
## Recent feedback trends (follow if possible)
- Provide clear and concise explanations of code behavior based on different states or conditions.
- Focus on providing clear, concise explanations tailored to the user's context and needs.
...

## Recent feedback trends (avoid)
- Avoid providing technical details without clear explanations or summaries for non-technical users.
- Avoid providing responses in languages other than English.
...
```

確認用のデバッグコードはコミットに含めず、確認後に元へ戻し済み（作業ツリーは変更なし）。

### 既知の懸念

- 要約プロンプト（`buildFeedbackSummaryPrompt`）がLLMに指示を守らせきれず、指示文自体（"Summarize code feedback for a pair-programming navigator in English, <= 120 characters."）がそのまま `summary_text` として保存されてしまうケースを実データで確認した。この場合 `summary_status` は `"ok"` のまま保存されるため、`goodPatterns`/`badAvoidPatterns` に無意味な要約が混入しうる。要約結果のバリデーション（例: 元の指示文とほぼ一致する場合は `failed` 扱いにする等）は未実装。
