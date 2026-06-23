# 13. アドバイス評価・フィードバック学習機能 実装設計

## 目的

AI が出したアドバイス（`ConversationEntry`, role: `assistant`）に対して、ユーザーが Good / Bad の評価を付けられるようにする。

- Good の場合: その回答の傾向を蓄積し、以後のプロンプト生成に「好評だった傾向」として反映する。
- Bad の場合: 理由選択＋自由記述のフィードバック入力画面に遷移し、送信された内容を蓄積、以後のプロンプト生成に「避けるべき傾向」として反映する。


## 13.1 既存のナレッジ機能との役割分担

今回追加する Good/Bad 評価は、既存のナレッジ機能とは目的が異なるため、データも経路も分離する。

| | ナレッジ機能（既存） | Good/Bad 評価（新規） |
|---|---|---|
| 目的 | 個別の問題解決を後から再利用する | 回答の「スタイル・トーン」を学習する |
| 単位 | ユーザーが選んだ1つの回答を要約 | 全ての回答に対する評価の集計 |
| プロンプトへの反映 | `knowledgeItems`（具体的な過去事例として注入） | `feedbackTendency`（傾向の指示文として注入） |
| 生成方法 | LLM 要約（`createKnowledgeDraft`） | ルールベース集計（後述 11.5） |

両者は独立して併存させる。Good 評価を押した回答を自動でナレッジ化する、といった連動は今回のスコープには含めない（将来課題、本書末尾に記載）。

## 機能要件

1. チャットバブル（[s04-conversation.tsx](../src/views/screens/s04-conversation.tsx) の `ResponseActions`）の assistant 回答に Good / Bad ボタンを追加する。
2. Good を押すと即時に評価が確定し、DB に保存される。再評価防止のためボタンは押下後 disabled になる。
3. Bad を押すと、新規画面「フィードバック入力画面」に遷移する。入力項目:
   - 理由チェックボックス（複数選択可）: `too_long`（長すぎる）/ `off_topic`（的外れ）/ `gives_answer`（答えを代行しすぎ）/ `too_vague`（観点が曖昧）/ `other`（その他）
   - 自由記述（任意）
4. 送信すると DB に保存され、元の画面に戻る。キャンセルすると何も保存せず戻る。
5. 評価データはローカル `sql.js` ベースの DB に保存する（既存2ストアと同様、`globalStorageUri` 配下）。
6. 次回以降のアドバイス生成時、直近の評価傾向をプロンプトに注入する。蓄積が無い場合は何も注入しない。

## スコープ外

- LLM による傾向要約（ルールベースに留める。将来 LLM 要約に差し替え可能なようインターフェースは分離する）。
- ナレッジ画面・履歴画面への評価集計の可視化 UI。
- Bad 理由が一定数を超えた際のアラート通知。
- 既存ナレッジ機能との自動連携。

## データモデル

### 13.2 永続化方式

既存の `KnowledgeStore` / `ConversationStore` と同じ `sql.js` パターンを踏襲する。新規依存追加は不要（`sql.js` は既に `package.json` の `dependencies` にある）。

保存先: `globalStorageUri/feedback.sqlite`（新規ファイル。既存 DB に表を追加する形にはせず、責務ごとにファイルを分ける方針を維持する）。

### 13.3 テーブル定義

```sql
CREATE TABLE IF NOT EXISTS advice_feedback (
  id TEXT PRIMARY KEY,
  conversation_entry_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
  advice_kind TEXT NOT NULL,         -- GuidanceKind: manual / context / always
  assistance_depth TEXT,             -- AssistanceDepth: low / high（あれば）
  slash_command TEXT,                -- SlashCommand（あれば）
  advice_text_excerpt TEXT NOT NULL, -- 傾向抽出用の本文抜粋（400文字程度）
  reasons_json TEXT,                 -- bad時: '["too_long","gives_answer"]' 形式
  comment TEXT,                      -- bad時の自由記述
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_advice_feedback_entry ON advice_feedback(conversation_entry_id);
CREATE INDEX IF NOT EXISTS idx_advice_feedback_rating_created ON advice_feedback(rating, created_at);
```

設計上のポイント:

- `conversation_entry_id` に `UNIQUE` 制約は付けない。同じ entry に対する再評価を許可するかどうかは UI 側の制御（評価済みなら button disabled）に委ね、DB 側は履歴として残せる方が分析に有利。
- 本文は全文ではなく抜粋のみ保存する（プロンプト注入で全文を使わないため、DB肥大化を避ける）。
- `assistance_depth` / `slash_command` も保存しておくことで、将来「ハイモードでは too_long が多い」のような分析ができる余地を残す（今回はこの分析自体は実装しない）。

## 型定義の追加（`src/shared/types.ts`）

```ts
export type FeedbackRating = "good" | "bad";

export type BadFeedbackReason =
  | "too_long"
  | "off_topic"
  | "gives_answer"
  | "too_vague"
  | "other";

export interface AdviceFeedbackInput {
  conversationEntryId: string;
  rating: FeedbackRating;
  reasons?: BadFeedbackReason[];
  comment?: string;
}

export interface FeedbackTendencySummary {
  goodPatterns: string[];
  badAvoidPatterns: string[];
}
```

`ConversationEntry`（[types.ts:186](../src/shared/types.ts#L186)）に評価状態を追加する:

```ts
export interface ConversationEntry {
  // ...既存フィールド
  feedback?: FeedbackRating;
}
```

`NavigatorSessionState` / `NavigatorViewModel` には、Bad 評価フロー中に対象 entry を保持するためのフィールドを追加する:

```ts
export interface NavigatorSessionState {
  // ...既存
  pendingFeedbackEntryId?: string;
}
```

`NavigatorScreen`（[types.ts:21](../src/shared/types.ts#L21)）に `"feedback_form"` を追加する。

## モジュール設計

### 13.4 新規 `FeedbackStore`

`src/services/FeedbackStore.ts` を新規作成し、`KnowledgeStore` と同じ `sql.js` 接続パターンを使う（DB初期化・`migrate()`・`persist()`・`getDb()` のヘルパーをほぼそのまま流用できる）。

責務:

- DB ファイルの初期化（`globalStorageUri/feedback.sqlite`）
- `saveFeedback(input: AdviceFeedbackInput, meta: { kind: GuidanceKind; assistanceDepth?: AssistanceDepth; slashCommand?: SlashCommand; adviceText: string }): Promise<void>`
- `getTendencySummary(): FeedbackTendencySummary`
  - 直近 good 5件 / bad 5件程度を読み、ルールベースで指示文を組み立てる（13.5、13.10 のトークン予算を参照）。

`extension.ts` で `KnowledgeStore` / `ConversationStore` と同様にインスタンス化し、`NavigatorController` のコンストラクタに渡す。

### 13.5 傾向集計のルールベース実装

`getTendencySummary()` の組み立て方針:

- `reasons_json` を集計し、頻出理由を指示文に変換する。
  - `too_long` が多い → 「回答は簡潔に、要点を絞って伝える」
  - `gives_answer` が多い → 「コードや正解を直接書かず、観点や確認手順の提示に留める」（既存の `buildPrompt` の Rules ともともと方向性は一致しているため、これは「直近で特に守られていなかった」という強調目的になる）
  - `too_vague` が多い → 「抽象的な助言だけでなく、具体的な確認手順を1つ以上含める」
  - `off_topic` が多い → 「ユーザーが今見ている文脈・選択範囲から離れない」
- `comment`（自由記述）は直近3件までを「ユーザーからの過去の指摘」としてそのまま注入する。件数が増えてもこの上限で頭打ちにする（プロンプト肥大化防止）。
- good は `assistanceDepth` や本文の文字数帯など構造的特徴のみ採用し、本文を Few-shot として丸ごと注入する方式は採らない（既存ナレッジ機能と役割が重複し、プロンプトも肥大化するため）。

将来 LLM 要約に差し替える場合に備え、呼び出し側（`AdviceService`, `NavigatorController`）は `FeedbackTendencySummary` 型のみに依存させ、`FeedbackStore` の内部実装（ルールベースか LLM か）を意識しない。

### 13.6 `AdviceService` への注入

`GuidanceRequestInput`（[AdviceService.ts:35](../src/services/AdviceService.ts#L35)）に追加:

```ts
export interface GuidanceRequestInput {
  // ...既存
  feedbackTendency?: FeedbackTendencySummary;
}
```

`buildPrompt`（[AdviceService.ts:194](../src/services/AdviceService.ts#L194)）内、既存の `knowledgeItems` セクション（300行目付近）の直後に追加する:

```ts
if (input.feedbackTendency?.goodPatterns.length) {
  lines.push(
    "",
    "## 直近で好評だった回答の傾向（できるだけ沿ってください）",
    ...input.feedbackTendency.goodPatterns.map((p) => `- ${p}`)
  );
}

if (input.feedbackTendency?.badAvoidPatterns.length) {
  lines.push(
    "",
    "## 直近で不評だった回答の傾向（避けてください）",
    ...input.feedbackTendency.badAvoidPatterns.map((p) => `- ${p}`)
  );
}
```

`always`（自動助言）は元々短く・控えめに作る設計のため、`feedbackTendency` は `manual` / `context` のみに注入し、`always` には注入しない方針とする（自動助言の応答方針は既に `getInstructionByKind("always")` で厳格に制御されているため、ここに評価傾向を混ぜると一貫性が崩れる）。

### 13.10 トークン消費・コンテキスト圧縮の検討

既存実装は、トークン消費の「計測」（`UsageMeter`）と「送信量の制御」（`RequestPlanner`）を分離している。`UsageMeter`（[UsageMeter.ts](../src/services/UsageMeter.ts)）はトークン数を実測してコスト換算・日次予算判定を行うだけで、プロンプト自体を圧縮する機能は持たない。実際の圧縮・縮約は `RequestPlanner.applyLowDepthContextLimits`（[RequestPlanner.ts:77](../src/services/RequestPlanner.ts#L77)）が担い、ロウモード（`always` 含む）では抜粋 2000 文字・診断 5 件・最近の編集 5 件・関連シンボル 8 件に切り詰め、`workspaceTree` と `referencedFiles` を完全に除外している。

`feedbackTendency` の注入はこの既存の圧縮対象（`GuidanceContext`）とは別枠で `buildPrompt` に直接追加するため、`RequestPlanner` の上限管理の外側にいる。素朴に実装すると「ロウモードでせっかく文脈を削っても、評価傾向セクションが無制限に増えていく」という抜け道になりうる。これを避けるため、以下の上限を明示する。

#### トークン予算の方針

- **`goodPatterns` / `badAvoidPatterns` は合計で概ね 5〜8 行以内**に収める。1行あたり40文字程度の日本語指示文を想定すると、追加トークンはおよそ 150〜250 トークン程度（日本語1文字を概ね1〜2トークンとして見積もり）。`UsageMeter` の単価表（[UsageMeter.ts:6](../src/services/UsageMeter.ts#L6)）に当てはめても、1リクエストあたり数十円のオーダーには収まらない程度の影響に抑えられる。
- **`comment`（自由記述）の直近採用件数は3件、かつ1件あたり80文字程度で切り詰める**（13.5 で触れた上限を本節で数値として確定する）。自由記述は長文になりやすく、ここを無制限にすると評価が蓄積するほどプロンプトが線形に肥大化するため、件数・文字数の両方でキャップする。
- **`assistanceDepth === "low"`（および `always`）のリクエストでは `feedbackTendency` 自体を注入しない**、という案も検討した。ロウモードはそもそも「短いヒントのみ」を狙ったモードであり、追加の指示セクションを載せることが目的と相反する可能性がある。一方で、Bad評価の多くは「答えを書きすぎ」等の応答スタイルに関するものであり、ロウモードでこそ効かせたい内容でもある。今回は **ハイ/ロウ問わず注入するが、上記の行数・文字数キャップで実害を抑える** 方針を採用する（`always` のみ除外、13.6 で既述）。
- `getTendencySummary()` の戻り値はサマリー文字列の配列であり、`AdviceFeedbackInput` や DB の生レコードをそのまま `buildPrompt` に渡さない。これにより、件数が増えてもプロンプト側のサイズは前述のキャップで頭打ちになり、DB のレコード数増加とプロンプトサイズが比例しない構造にする。

#### `getTendencySummary()` の集計コスト

- `FeedbackStore.getTendencySummary()` は `executeGuidanceRequest` のたびに呼ばれる（11.7 / 13.7 参照）。`sql.js` は同期 API だが、`advice_feedback` テーブルは1ユーザーのローカル利用前提で件数が少なく（数百〜数千件程度）、`ORDER BY created_at DESC LIMIT N` で直近件数のみ取得すれば毎回のクエリコストは無視できる。集計結果（`FeedbackTendencySummary`）自体はリクエストごとに作り直してよく、キャッシュは不要と判断する（過去の評価が増えるたびに反映内容が変わるべきものであり、キャッシュすると更新が遅れるリスクの方が大きい）。

#### 将来の精緻化（今回は実装しない）

- `assistanceDepth` ごとに別々の `goodPatterns` / `badAvoidPatterns` を持たせ、「ロウモードでは specifically何が不評だったか」を分離する案。今回はデータ量が少ない初期段階のため、深さを問わず一括集計する。
- プロンプト全体のトークン数が `UsageMeter` の日次予算に近づいている場合、`feedbackTendency` を自動的に省略するなど、既存の予算管理（`dailyBudgetUsd` / `isBudgetExceeded`）と連動させる案。今回は両者を独立に保ち、連携は将来課題とする。

### 13.7 `NavigatorController` の拡張

新規公開メソッド:

```ts
rateAdvice(conversationEntryId: string, rating: FeedbackRating): Promise<void>
submitBadFeedback(reasons: BadFeedbackReason[], comment: string): Promise<void>
cancelBadFeedback(): void
```

- `rateAdvice(id, "good")`: 対象 entry を特定し `FeedbackStore.saveFeedback` を即時呼び出し。`conversationHistory` 内の該当 entry（および永続化されている場合は `ConversationStore` 側のレコードも）に `feedback: "good"` を反映して再描画。
- `rateAdvice(id, "bad")`: DB 保存はまだ行わず、`pendingFeedbackEntryId` をセットし `screen: "feedback_form"` へ `pushScreen`（既存の `pushScreen` ヘルパーを利用、[NavigatorController.ts](../src/application/NavigatorController.ts) 内に同名パターンが既存）。
- `submitBadFeedback(reasons, comment)`: `pendingFeedbackEntryId` を使って対象 entry を特定し保存、`feedback: "bad"` を反映し `pendingFeedbackEntryId` をクリアして元画面へ戻る。
- `cancelBadFeedback()`: 保存せず `pendingFeedbackEntryId` をクリアして `navigateBack()` 相当の処理。

`conversationHistory` の更新は `ConversationStore.saveStream` 経由で永続化されている（[ConversationStore.ts:150](../src/services/ConversationStore.ts#L150)）ため、`feedback` フィールドも `StoredConversationEntry` に含め、`toEntryParams` / `entryFromRow` に1カラム追加して永続化する必要がある。

`executeGuidanceRequest`（アドバイス生成本体、`NavigatorController` 内）で `AdviceService.requestGuidance` を呼ぶ直前に `feedbackStore.getTendencySummary()` を取得し、`GuidanceRequestInput.feedbackTendency` として渡す。

## 画面設計

### 13.8 既存チャットバブルへの評価ボタン追加

[s04-conversation.tsx](../src/views/screens/s04-conversation.tsx) の `ResponseActions`（387行目〜）に Good / Bad ボタンを追加する。既存の `bookmark_add` / `content_copy` ボタンと並べる形にする。

```tsx
<button
  className={`s04-response-action ${entry.feedback === "good" ? "active" : ""}`}
  title={entry.feedback ? "評価済み" : "Good"}
  disabled={Boolean(entry.feedback)}
  onClick={() => send({ type: "rateAdvice", id: entry.id, rating: "good" })}
>
  <span className="material-symbols-outlined">thumb_up</span>
</button>
<button
  className={`s04-response-action ${entry.feedback === "bad" ? "active" : ""}`}
  title={entry.feedback ? "評価済み" : "Bad"}
  disabled={Boolean(entry.feedback)}
  onClick={() => send({ type: "rateAdvice", id: entry.id, rating: "bad" })}
>
  <span className="material-symbols-outlined">thumb_down</span>
</button>
```

`ChatBubble` の props に `entry.feedback` は既に `entry: ConversationEntry` 経由で渡るため、追加の prop drilling は不要。

### 13.9 新規画面: フィードバック入力画面

既存の画面命名は `s01` 〜 `s08`（用途ベース、例: `s04-conversation`, `s08-history`）。新規追加分は次の番号を使う。

```bash
src/views/screens/s09-feedback-form.tsx
src/views/css/s09-feedback-form.css
```

`App.tsx` のルーティング（`screen` → コンポーネントの対応表）に `"feedback_form"` のケースを追加する。

画面構成:

- 対象アドバイスの本文プレビュー（読み取り専用、`PageHeader` 直下にカード表示）
- 理由チェックボックス群（複数選択）: 長すぎる / 的外れ / 答えを代行しすぎ / 観点が曖昧 / その他
- 自由記述欄（textarea, 任意）
- 送信 / キャンセル ボタン

送信時のメッセージ:

```ts
send({ type: "submitBadFeedback", reasons: selectedReasons, comment });
send({ type: "cancelBadFeedback" });
```

対象アドバイスの本文は、`viewModel.conversationHistory` から `pendingFeedbackEntryId`（新規追加が必要な ViewModel フィールド、もしくは既存の選択中 entry 取得ロジックを再利用）で引く。

## `shared/messages.ts` への追加

`WebviewToExtension`（[messages.ts:3](../src/shared/messages.ts#L3)）に追加:

```ts
| { type: "rateAdvice"; id: string; rating: FeedbackRating }
| { type: "submitBadFeedback"; reasons: BadFeedbackReason[]; comment: string }
| { type: "cancelBadFeedback" }
```

`NavigatorViewProvider`（または相当するメッセージディスパッチ箇所）の `switch` にハンドラを追加し、対応する `NavigatorController` メソッドを呼ぶ。

## 処理フロー

### Good 評価

1. ユーザーがチャットバブルの Good ボタンを押す。
2. `{ type: "rateAdvice", id, rating: "good" }` 送信。
3. Controller が対象 entry を特定し `FeedbackStore.saveFeedback` を呼ぶ（即時 DB 保存）。
4. `conversationHistory` 内の該当 entry に `feedback: "good"` をセットし、`ConversationStore.saveStream` で永続化、再描画。
5. 以後の `executeGuidanceRequest` で `getTendencySummary()` の `goodPatterns` に反映される。

### Bad 評価

1. ユーザーが Bad ボタンを押す。
2. `rateAdvice(id, "bad")` が呼ばれ、`pendingFeedbackEntryId` をセットし `screen: "feedback_form"` へ遷移（DB 保存はまだしない）。
3. ユーザーが理由・自由記述を入力し送信、または取消。
4. 送信時: `submitBadFeedback(reasons, comment)` → 対象 entry を特定 → `FeedbackStore.saveFeedback` 呼び出し → entry に `feedback: "bad"` をセットして永続化 → `pendingFeedbackEntryId` クリア → 元画面へ戻る。
5. キャンセル時: DB 保存せず `pendingFeedbackEntryId` クリア → 元画面へ戻る。

## ファイル単位の変更方針

### 変更対象

- `src/shared/types.ts` — 型追加（`FeedbackRating`, `BadFeedbackReason`, `AdviceFeedbackInput`, `FeedbackTendencySummary`, `ConversationEntry.feedback`, `NavigatorSessionState.pendingFeedbackEntryId`, `NavigatorScreen` に `"feedback_form"` 追加）
- `src/shared/messages.ts` — `WebviewToExtension` に3メッセージ追加
- `src/services/ConversationStore.ts` — `feedback` カラムの永続化対応（`migrate()` に `ensureColumn`、`toEntryParams`/`entryFromRow` に追加）
- `src/services/AdviceService.ts` — `GuidanceRequestInput.feedbackTendency` 追加、`buildPrompt` への注入処理
- `src/application/NavigatorController.ts` — `rateAdvice` / `submitBadFeedback` / `cancelBadFeedback` 追加、`executeGuidanceRequest` で `feedbackTendency` 取得・受け渡し
- `src/views/screens/s04-conversation.tsx` — `ResponseActions` に Good/Bad ボタン追加
- `src/views/webview/App.tsx`（または同等のルーター） — `"feedback_form"` 画面の振り分け追加
- `src/extension.ts` — `FeedbackStore` のインスタンス化・DI

### 新規追加

- `src/services/FeedbackStore.ts`
- `src/views/screens/s09-feedback-form.tsx`
- `src/views/css/s09-feedback-form.css`

実装前に `App.tsx` の実ファイル内容と画面振り分けの実装方法を確認し、既存の画面追加パターン（直近で `s08-history` がどう追加されたか）に厳密に合わせること。

## 実装順

1. `src/shared/types.ts` に型を追加する。
2. `src/services/FeedbackStore.ts` を新規作成する（`KnowledgeStore.ts` をベースに DB 接続部分を流用）。
3. `src/services/ConversationStore.ts` に `feedback` カラムを追加する（既存マイグレーションパターンに従う）。
4. `src/services/AdviceService.ts` に `feedbackTendency` の注入処理を追加する。
5. `src/application/NavigatorController.ts` に評価系メソッドを追加し、`executeGuidanceRequest` を変更する。
6. `src/extension.ts` で `FeedbackStore` を組み立て、`NavigatorController` に DI する。
7. `src/shared/messages.ts` にメッセージ型を追加する。
8. `s09-feedback-form.tsx` / `.css` を新規作成し、`App.tsx` のルーティングに追加する。
9. `s04-conversation.tsx` の `ResponseActions` に Good/Bad ボタンを追加する。
10. 動作確認（受け入れ条件で確認）。

## 受け入れ条件

- チャットバブルの assistant 回答に Good / Bad ボタンが表示される。
- Good を押すと即時に評価済み表示になり、再度同じ回答への評価はできない。
- Bad を押すとフィードバック入力画面に遷移する。
- フィードバック入力画面で理由 0件・自由記述なしでも送信できる（任意項目のため）。
- 送信完了後、元の画面に戻り、対象アドバイスが Bad 評価済み表示になる。
- キャンセルを押すと DB に何も保存されず元の画面に戻る。
- `globalStorageUri/feedback.sqlite` に `advice_feedback` テーブルが作成され、評価が記録される。
- 拡張再起動後も評価履歴・評価済み表示が保持される（`ConversationStore` 経由の `feedback` カラム永続化を含めて確認）。
- 新しいアドバイス生成時のプロンプトに、蓄積された good/bad 傾向に基づく追加指示セクションが含まれる（蓄積が無い場合は何も注入されない）。
- `always`（自動助言）には傾向注入が行われないことを確認する。

## 残課題（将来検討）

- ルールベース傾向集計から LLM 要約への置き換え。
- 評価集計のナレッジ画面・履歴画面への可視化。
- Bad 評価が一定数を超えた際のユーザーへの振り返り通知。
- Good 評価された回答を既存ナレッジ機能と連携してワンクリックでナレッジ化する導線。
- 評価データのエクスポート / リセット機能。
- `assistanceDepth` 別の傾向集計の分離（13.10）。
- `feedbackTendency` の注入と `UsageMeter` の日次予算管理との連携（13.10）。
