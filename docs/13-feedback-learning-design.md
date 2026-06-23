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
| 生成方法 | LLM 要約（`createKnowledgeDraft`） | LLM 要約（`summarizeFeedback`、後述 13.5） |

両者は独立して併存させる。Good 評価を押した回答を自動でナレッジ化する、といった連動は今回のスコープには含めない（将来課題、本書末尾に記載）。

## 機能要件

1. チャットバブル（[s04-conversation.tsx](../src/views/screens/s04-conversation.tsx) の `ResponseActions`）の assistant 回答に Good / Bad ボタンを追加する。
2. Good を押すと、その場で Copilot に1回要約リクエストを送り、「何が良かったか」を短い指示文に要約してから DB に保存する。再評価防止のためボタンは押下後 disabled になる。
3. Bad を押すと、新規画面「フィードバック入力画面」に遷移する。入力項目:
   - 理由チェックボックス（複数選択可）: `too_long`（長すぎる）/ `off_topic`（的外れ）/ `gives_answer`（答えを代行しすぎ）/ `too_vague`（観点が曖昧）/ `other`（その他）
   - 自由記述（任意）
4. Bad のフィードバック送信時も、その場で Copilot に1回要約リクエストを送り、「何が悪かったか」を短い指示文に要約してから DB に保存する。送信完了後は元の画面に戻る。キャンセルすると何も保存せず戻る（要約リクエストも発生しない）。
5. 評価データ（生の評価・理由・自由記述・要約結果）はローカル `sql.js` ベースの DB に保存する（既存2ストアと同様、`globalStorageUri` 配下）。
6. 次回以降のアドバイス生成時、直近の要約済み評価傾向をプロンプトに注入する。蓄積が無い場合は何も注入しない。アドバイス生成時には追加の LLM 呼び出しは発生させない（要約は評価時点で済ませてあるものを読むだけ）。

## スコープ外

- ナレッジ画面・履歴画面への評価集計の可視化 UI。
- Bad 理由が一定数を超えた際のアラート通知。
- 既存ナレッジ機能との自動連携。
- 要約専用 LLM 呼び出しの失敗時に自動リトライ・再要約する仕組み（失敗時は `summary_status: "failed"` として記録し、そのレコードは傾向集計から除外するのみに留める、後述 13.5）。

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
  advice_text_excerpt TEXT NOT NULL, -- 要約入力用の本文抜粋（400文字程度）
  reasons_json TEXT,                 -- bad時: '["too_long","gives_answer"]' 形式
  comment TEXT,                      -- bad時の自由記述
  summary_text TEXT,                 -- LLM要約結果（1〜2文の指示文。失敗時はNULL）
  summary_status TEXT NOT NULL CHECK (summary_status IN ('ok', 'failed', 'skipped')) DEFAULT 'ok',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_advice_feedback_entry ON advice_feedback(conversation_entry_id);
CREATE INDEX IF NOT EXISTS idx_advice_feedback_rating_created ON advice_feedback(rating, created_at);
```

設計上のポイント:

- `conversation_entry_id` に `UNIQUE` 制約は付けない。同じ entry に対する再評価を許可するかどうかは UI 側の制御（評価済みなら button disabled）に委ね、DB 側は履歴として残せる方が分析に有利。
- 本文は全文ではなく抜粋のみ保存する（要約リクエストの入力として使うのみで、それ以上保持する必要がないため）。
- `summary_text` は **評価時点（FB送信時）で1回だけ LLM 要約を実行した結果**を保存する。アドバイス生成時には再要約せず、ここに保存された文字列をそのまま読む（13.5）。
- `summary_status` で要約の成否を区別する。`ok`: 要約成功。`failed`: LLM呼び出し失敗（Copilot未接続・エラー等）。`skipped`: 何らかの理由で要約自体を試行しなかった場合。`failed` / `skipped` の場合は `getTendencySummary()` 側でルールベースのフォールバック文言に切り替える（13.5）。
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

export type FeedbackSummaryStatus = "ok" | "failed" | "skipped";

export interface FeedbackSummaryResult {
  status: FeedbackSummaryStatus;
  summaryText?: string; // status === "ok" のときのみ値を持つ
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
- `saveFeedback(input: AdviceFeedbackInput, meta: { kind: GuidanceKind; assistanceDepth?: AssistanceDepth; slashCommand?: SlashCommand; adviceText: string }, summary: FeedbackSummaryResult): Promise<void>`
  - 要約は呼び出し側（`NavigatorController`）が先に実行し、結果（`FeedbackSummaryResult`）をこのメソッドに渡す。`FeedbackStore` 自身は LLM を呼ばず、DB への書き込みのみ行う。
- `getTendencySummary(): FeedbackTendencySummary`
  - 直近 good 5件 / bad 5件程度の `summary_text`（`summary_status = 'ok'` のもののみ）を読み出して配列に詰めるだけ。**ここでは LLM 呼び出しを行わない**（13.5）。

`extension.ts` で `KnowledgeStore` / `ConversationStore` と同様にインスタンス化し、`NavigatorController` のコンストラクタに渡す。

### 13.5 LLM 要約の実装方針（FB送信時にその場で要約）

要約処理は `FeedbackStore` ではなく `AdviceService` に持たせる（既存の `createKnowledgeDraft` / `createConversationTitle` と同様、LLM 呼び出しは `AdviceService` に集約する設計方針に従う）。

`AdviceService` に新規メソッドを追加する:

```ts
public async summarizeFeedback(input: FeedbackSummarizeInput): Promise<FeedbackSummaryResult> {
  const result = await this.requestText(this.buildFeedbackSummaryPrompt(input));
  if (!result.ok) {
    return { status: "failed" };
  }

  const summaryText = this.normalizeLine(result.text, 120);
  return summaryText ? { status: "ok", summaryText } : { status: "failed" };
}

export interface FeedbackSummarizeInput {
  rating: FeedbackRating;
  adviceTextExcerpt: string;
  reasons?: BadFeedbackReason[]; // bad時のみ
  comment?: string;              // bad時のみ
}
```

`buildFeedbackSummaryPrompt` の方針:

- **Good**: 「保存対象の回答」と「ユーザーが Good と評価した」事実だけを渡し、何が良かったと推測できるかを1文（英語、120文字以内）の指示文として返させる。例: `"Keep the explanation short and point to specific code locations rather than general advice."`
- **Bad**: 「保存対象の回答」「選択された理由（`too_long` 等）」「自由記述コメント」を渡し、次回以降に避けるべきことを1文（英語、120文字以内）の指示文として返させる。理由ラベルと自由記述の両方をLLMに渡すことで、定型理由だけでは表現できないニュアンス（自由記述側）も1文に圧縮できる。
- 出力は **`Rules:` ブロックと同じ言語ポリシーに揃えて英語で1文のみ**を返すよう指示する（前回検討した「指示文は英語にしてトークン効率を上げる」方針をここでも採用）。これは英語化によるトークン削減目的に加えて、要約自体を短い1文に強制してプロンプト肥大化を防ぐ目的も兼ねる。
- LLM が複数文・説明・前置きを返した場合は、`createConversationTitle` の `normalizeConversationTitle` と同様の方法で1行目だけを取り出し、120文字で切り詰める。

`getTendencySummary()`（`FeedbackStore` 側）はこの `summary_text` を直近件数分だけ配列にして返すだけになる。要約に失敗した（`summary_status = 'failed'`）レコードは `goodPatterns` / `badAvoidPatterns` に含めない。

#### 要約に失敗した場合のフォールバック

Copilot 未接続時など `summarizeFeedback` が `{ status: "failed" }` を返した場合でも、評価そのもの（`rating`, `reasons`, `comment`）は通常通り DB に保存する（評価操作自体をエラーにしない）。`summary_text` は `NULL` のまま保存され、次回の `getTendencySummary()` ではこのレコードを無視する。要約だけが失われ、後から再要約するバッチ処理は今回のスコープには含めない（残課題に記載）。

### 13.6 `AdviceService` への注入（アドバイス生成時は LLM 呼び出しを増やさない）

ここで注入する `feedbackTendency` は、13.5 で**評価時点に要約済みの文字列**を渡すだけであり、アドバイス生成のリクエストパス自体には新たな LLM 呼び出しを追加しない。

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
    "## Recent feedback trends (follow if possible)",
    ...input.feedbackTendency.goodPatterns.map((p) => `- ${p}`)
  );
}

if (input.feedbackTendency?.badAvoidPatterns.length) {
  lines.push(
    "",
    "## Recent feedback trends (avoid)",
    ...input.feedbackTendency.badAvoidPatterns.map((p) => `- ${p}`)
  );
}
```

`always`（自動助言）は元々短く・控えめに作る設計のため、`feedbackTendency` は `manual` / `context` のみに注入し、`always` には注入しない方針とする（自動助言の応答方針は既に `getInstructionByKind("always")` で厳格に制御されているため、ここに評価傾向を混ぜると一貫性が崩れる）。

このセクションの見出しは英語にしている（13.10「指示文の言語選択によるトークン削減」を参照）。`goodPatterns` / `badAvoidPatterns` の各要素（= 13.5 で生成済みの `summary_text`）自体も、要約プロンプトの指示により既に英語の1文になっているため、このセクション全体が英語で統一される。

### 13.10 トークン消費・コンテキスト圧縮の検討

LLM 要約方式を採用したことで、トークン消費は **「評価時点（FB送信時）に1回」** と **「アドバイス生成時に注入分が増える」** の2箇所に分かれる。両者を分けて検討する。

#### (A) 評価時点の要約リクエスト（新規に発生するコスト）

`summarizeFeedback`（13.5）は、Good / Bad のどちらでも **FB送信のたびに新規の LLM 呼び出しを1回発生させる**。これは本機能で純粋に追加されるコストであり、見積もりは以下の通り。

- 入力: `advice_text_excerpt`（400文字程度）＋ `reasons` ＋ `comment`（最大数百文字）＋ 固定の指示文。概算で 300〜600 トークン程度。
- 出力: 120文字以内・1文に制限しているため、出力は概算で 30〜60 トークン程度。
- 既存の `AdviceService.requestText` を経由するため、`AdviceService.recordUsage`（[AdviceService.ts:164](../src/services/AdviceService.ts#L164)）の仕組みに自然に乗り、**`UsageMeter.record()` で通常のアドバイス生成と同じ日次集計に加算される**。つまり「FB機能専用の隠れたコスト」にはならず、メイン画面の「当日の利用回数・概算トークン」表示にもこのリクエストが反映される（実装時に `requestGuidance` 等と同様 `recordUsage` を通すことを徹底する）。
- リクエスト件数は「評価した回数」に比例して増える。会話1件のたびに必ず1回ではなく、**ユーザーが Good/Bad を押したときだけ**発生するため、評価をしないユーザーには追加コストが一切発生しない。

この (A) が「FB機能で実際にトークンを消費する新規の場所」であり、前回（ルールベース集計案）には存在しなかったコストである。

#### (B) アドバイス生成時の注入分（既存リクエストへの上乗せ）

13.6 の通り、`feedbackTendency` は**事前に要約済みの文字列を読むだけ**であり、アドバイス生成のたびに新規の LLM 呼び出しを発生させない。ここでのコストは、既存リクエストの**入力トークンの上乗せ**のみ。

- `goodPatterns` / `badAvoidPatterns` は1件1文・120文字以内（英語）に強制されているため（13.5）、件数を直近5件ずつに絞れば、合計でも10行未満・英語で概ね150〜300トークン程度の上乗せに収まる。ルールベース案で見積もっていた150〜250トークンと大きく変わらない規模に収まる。
- `getTendencySummary()` の戻り値は要約済み文字列の配列であり、DB の生レコード（`comment` 全文等）をそのまま `buildPrompt` に渡さない。評価件数が増えても、注入されるのは「直近N件の要約済み1文」のみなので、プロンプトサイズは件数に対して頭打ちになる。

#### `assistanceDepth` との関係

- ロウモード（`always` 含む）は `RequestPlanner.applyLowDepthContextLimits`（[RequestPlanner.ts:77](../src/services/RequestPlanner.ts#L77)）で文脈を強く絞っているが、`feedbackTendency` はこの圧縮対象（`GuidanceContext`）の外側で `buildPrompt` に直接追加される。(B) の上乗せ分は (B) 自体の上限（直近5件・1文ずつ）で抑えているため、ロウモードでも実害は小さいと判断し、`always` のみ除外（13.6 既述）、`manual`/`context` はロウ/ハイ問わず注入する。

#### 言語選択によるトークン削減

`buildPrompt` の既存コードには、ユーザーに見えない指示文の言語に既存の傾向がある。英語: 冒頭の `Rules:` ブロック（[AdviceService.ts:198-211](../src/services/AdviceService.ts#L198-L211)、役割定義・禁止事項などAIの挙動制御のみを担う部分）。日本語: `getInstructionByKind`・`getSlashCommandInstruction`・セクション見出し（`## 応答設定` 等）。英語は日本語よりトークン効率が良い傾向があるため、本機能では以下を採用する。

- (A) の要約結果自体を**英語の1文**で出力させる（13.5 で既述）。これにより (B) で注入する `goodPatterns` / `badAvoidPatterns` も自然に英語になる。
- (B) のセクション見出しも英語にする（`## Recent feedback trends (follow if possible)` 等、13.6 で既述）。
- 既存の `getInstructionByKind` 等の日本語指示文の英語化は、本機能のスコープ外（将来課題）。

#### 将来の精緻化（今回は実装しない）

- (A) の要約リクエストを毎回ではなく、一定件数バッチでまとめて要約する方式への変更（呼び出し頻度は下がるが、リアルタイム性と実装の単純さを優先し、今回は1件ずつ即時要約を採用）。
- `assistanceDepth` ごとに別々の `goodPatterns` / `badAvoidPatterns` を持たせる案。今回はデータ量が少ない初期段階のため、深さを問わず一括集計する。
- (A)・(B) 双方のトークン消費が `UsageMeter` の日次予算（`dailyBudgetUsd` / `isBudgetExceeded`）に近づいている場合に、要約リクエスト自体をスキップする（`summary_status: "skipped"` とする）連携。今回は両者を独立に保ち、連携は将来課題とする。
- `getInstructionByKind` / `getSlashCommandInstruction` / 各セクション見出しを含む既存プロンプト全体の英語化。本機能のスコープ外だが、トークン削減効果は最も大きいと見込まれるため優先度は高い。

### 13.7 `NavigatorController` の拡張

新規公開メソッド:

```ts
rateAdvice(conversationEntryId: string, rating: FeedbackRating): Promise<void>
submitBadFeedback(reasons: BadFeedbackReason[], comment: string): Promise<void>
cancelBadFeedback(): void
```

- `rateAdvice(id, "good")`: 対象 entry を特定し、まず即時に `feedback: "good"` をセットして再描画する（ボタンの disabled 化はここで確定させ、ユーザーを待たせない）。その後バックグラウンドで `AdviceService.summarizeFeedback({ rating: "good", adviceTextExcerpt })` を呼び、結果を `FeedbackStore.saveFeedback` に渡して DB 保存する。要約完了を待つ UI 上の特別な待機状態は設けない（13.5 のフォールバックにより、要約が失敗しても評価自体は保存済みのまま変化しない）。
- `rateAdvice(id, "bad")`: DB 保存・要約はまだ行わず、`pendingFeedbackEntryId` をセットし `screen: "feedback_form"` へ `pushScreen`（既存の `pushScreen` ヘルパーを利用、[NavigatorController.ts](../src/application/NavigatorController.ts) 内に同名パターンが既存）。
- `submitBadFeedback(reasons, comment)`: `pendingFeedbackEntryId` を使って対象 entry を特定し、`feedback: "bad"` を即時セットして元画面へ戻る（こちらも要約完了を待たずに画面遷移する）。その後バックグラウンドで `AdviceService.summarizeFeedback({ rating: "bad", adviceTextExcerpt, reasons, comment })` を呼び、結果を `FeedbackStore.saveFeedback` に渡して DB 保存する。
- `cancelBadFeedback()`: 保存せず、要約リクエストも発生させずに `pendingFeedbackEntryId` をクリアして `navigateBack()` 相当の処理。

要約リクエスト（`summarizeFeedback`）を画面遷移・再描画とは非同期に「投げっぱなし」で実行する設計にしているのは、評価操作自体の UI 応答性を Copilot のレイテンシに引っ張られないようにするため。要約が完了した時点で `FeedbackStore.saveFeedback` が呼ばれ DB へ反映されるが、この完了タイミングを UI に反映する必要はない（評価済み表示は要約結果を待たずに確定済みのため）。

`conversationHistory` の更新は `ConversationStore.saveStream` 経由で永続化されている（[ConversationStore.ts:150](../src/services/ConversationStore.ts#L150)）ため、`feedback` フィールドも `StoredConversationEntry` に含め、`toEntryParams` / `entryFromRow` に1カラム追加して永続化する必要がある。

`executeGuidanceRequest`（アドバイス生成本体、`NavigatorController` 内）で `AdviceService.requestGuidance` を呼ぶ直前に `feedbackStore.getTendencySummary()` を取得し、`GuidanceRequestInput.feedbackTendency` として渡す。このメソッドは LLM を呼ばず DB 読み取りのみのため、アドバイス生成のレイテンシに影響しない（13.10）。

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
3. Controller が対象 entry を特定し、`conversationHistory` 内の該当 entry に即時 `feedback: "good"` をセットして再描画（ボタンが disabled になる）。**この時点ではまだ LLM 呼び出しもDB保存も行わない。**
4. バックグラウンドで `AdviceService.summarizeFeedback({ rating: "good", adviceTextExcerpt })` を呼ぶ（ここで Copilot へのリクエストが1回発生、トークン消費）。
5. 要約結果（成功なら `summary_text`、失敗なら `summary_status: "failed"`）を `FeedbackStore.saveFeedback` に渡して DB 保存。`conversationHistory` の `feedback` は `ConversationStore.saveStream` で永続化。
6. 以後の `executeGuidanceRequest` で `getTendencySummary()` が `summary_status = 'ok'` のレコードを読み、`goodPatterns` に反映される（この読み取り自体は LLM を呼ばない）。

### Bad 評価

1. ユーザーが Bad ボタンを押す。
2. `rateAdvice(id, "bad")` が呼ばれ、`pendingFeedbackEntryId` をセットし `screen: "feedback_form"` へ遷移（DB 保存・要約はまだ発生しない）。
3. ユーザーが理由・自由記述を入力し送信、または取消。
4. 送信時: `submitBadFeedback(reasons, comment)` → 対象 entry を特定 → 即時 `feedback: "bad"` をセットして元画面へ戻る → バックグラウンドで `AdviceService.summarizeFeedback({ rating: "bad", adviceTextExcerpt, reasons, comment })` を呼ぶ（Copilot へのリクエストが1回発生）→ 要約結果を `FeedbackStore.saveFeedback` に渡して DB 保存・永続化 → `pendingFeedbackEntryId` クリア。
5. キャンセル時: DB 保存・要約リクエストともに発生させず `pendingFeedbackEntryId` クリア → 元画面へ戻る。

## ファイル単位の変更方針

### 変更対象

- `src/shared/types.ts` — 型追加（`FeedbackRating`, `BadFeedbackReason`, `AdviceFeedbackInput`, `FeedbackTendencySummary`, `ConversationEntry.feedback`, `NavigatorSessionState.pendingFeedbackEntryId`, `NavigatorScreen` に `"feedback_form"` 追加）
- `src/shared/messages.ts` — `WebviewToExtension` に3メッセージ追加
- `src/services/ConversationStore.ts` — `feedback` カラムの永続化対応（`migrate()` に `ensureColumn`、`toEntryParams`/`entryFromRow` に追加）
- `src/services/AdviceService.ts` — `summarizeFeedback` メソッド追加（13.5）、`GuidanceRequestInput.feedbackTendency` 追加、`buildPrompt` への注入処理
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
4. `src/services/AdviceService.ts` に `summarizeFeedback`（13.5）と `feedbackTendency` の注入処理（13.6）を追加する。`recordUsage` を通すことを忘れない（13.10）。
5. `src/application/NavigatorController.ts` に評価系メソッド（要約のバックグラウンド実行を含む）を追加し、`executeGuidanceRequest` を変更する。
6. `src/extension.ts` で `FeedbackStore` を組み立て、`NavigatorController` に DI する。
7. `src/shared/messages.ts` にメッセージ型を追加する。
8. `s09-feedback-form.tsx` / `.css` を新規作成し、`App.tsx` のルーティングに追加する。
9. `s04-conversation.tsx` の `ResponseActions` に Good/Bad ボタンを追加する。
10. 動作確認（受け入れ条件で確認）。

## 受け入れ条件

- チャットバブルの assistant 回答に Good / Bad ボタンが表示される。
- Good を押すと即時に評価済み表示になり、再度同じ回答への評価はできない（要約完了を待たずに UI 上は確定する）。
- Good を押した後、バックグラウンドで Copilot への要約リクエストが1回発生し、完了後に `advice_feedback.summary_text` に値が入る。
- Bad を押すとフィードバック入力画面に遷移する。
- フィードバック入力画面で理由 0件・自由記述なしでも送信できる（任意項目のため）。
- 送信完了後、元の画面に戻り、対象アドバイスが Bad 評価済み表示になる。送信後にバックグラウンドで要約リクエストが1回発生する。
- キャンセルを押すと DB に何も保存されず、要約リクエストも発生せず元の画面に戻る。
- Copilot 未接続など要約に失敗した場合でも、評価自体（`rating`/`reasons`/`comment`）は保存され、`summary_status` が `failed` になる。
- `globalStorageUri/feedback.sqlite` に `advice_feedback` テーブルが作成され、評価・要約結果が記録される。
- 拡張再起動後も評価履歴・評価済み表示が保持される（`ConversationStore` 経由の `feedback` カラム永続化を含めて確認）。
- 新しいアドバイス生成時のプロンプトに、`summary_status = 'ok'` の直近 good/bad 傾向に基づく追加指示セクションが含まれる（蓄積が無い、または全件要約失敗の場合は何も注入されない）。このとき新規の LLM 呼び出しは発生しない（要約済み文字列を読むだけ）。
- `always`（自動助言）には傾向注入が行われないことを確認する。
- 要約リクエストのトークン使用量が `UsageMeter` の当日集計（メイン画面の利用回数・概算トークン表示）に反映される。

## 残課題（将来検討）

- 評価集計のナレッジ画面・履歴画面への可視化。
- Bad 評価が一定数を超えた際のユーザーへの振り返り通知。
- Good 評価された回答を既存ナレッジ機能と連携してワンクリックでナレッジ化する導線。
- 評価データのエクスポート / リセット機能。
- `assistanceDepth` 別の傾向集計の分離（13.10）。
- (A)(B) のトークン消費と `UsageMeter` の日次予算管理との連携（要約リクエストのスキップ等、13.10）。
- 要約失敗（`summary_status: "failed"`）レコードの再要約バッチ処理（13.5）。
- 要約リクエストを1件ずつではなく一定件数バッチでまとめて実行する方式への変更（13.10）。
- `getInstructionByKind` / `getSlashCommandInstruction` / セクション見出しを含む、既存プロンプト全体の英語化によるトークン削減（13.10）。本機能のスコープ外だが、効果が大きいため別タスクとして優先度高く扱う価値がある。
