# 18. 学習プロファイルと既知言語との比較（Phase 1）

ユーザーが経験のある言語を登録し、明示的に求めたときだけ、その言語と比べた説明を受けられるようにする。
設計検討の全体（Phase 2 以降の比較の自動判定、つまずき検知を含む）は、設計書 [学習プロファイル・言語比較支援・つまずき検知 設計検討](learning-support-design.md)（r4）にある。この文書は Phase 1 で実装した範囲の仕様である。

## 目的と範囲

- 既知の言語との比較は、理解を助ける補助として使う。毎回は出さない
- Phase 1 では **明示的な比較要求** のときだけ学習プロファイルを使う。自動の判定（`suggest` / `auto`）とつまずき検知は Phase 2 以降
- 送るプロファイルの言語は常に **1つ**。ユーザーが指定した言語を別の言語へ差し替えない
- 比較のためだけの追加の AI 呼び出しはしない。判定はすべてローカル（`ComparisonPolicy`）で行う

## データと保存

| 項目 | 内容 |
|---|---|
| 型 | `LearningProfile`（`src/shared/learningProfile.ts`） |
| 経験のある言語 | `knownLanguages`。最大8件。言語は `LANGUAGE_CATALOG` のファミリーID（`typescriptreact` は `typescript` へ寄せる）。習熟度 `level` は任意（`basic` / `working` / `advanced`） |
| 学習中の言語 | 設定項目は設けず、常に編集中のファイルの言語（ファミリーへ寄せたもの）とする。カタログ外の言語（json など）のときは未指定。設計書 §3.4 の「固定する」案は、使う場面が少なく設定を複雑にするため採用しなかった。以前の保存値に `targetLanguage` が残っていても読み捨てる |
| 比較の設定 | `comparisonMode`。既定は `onRequest`。設定画面で選べるのは `off` と `onRequest`。`suggest` / `auto` は Phase 2 で追加するまで `onRequest` と同じに扱う |
| 保存先 | `globalState` のキー `aiPairNavigator.learningProfile.v1`（`LearningProfileService`）。ユーザー単位の情報なので、ワークスペース単位の設定（`workspaceState`）とは分ける。Settings Sync の対象にしない |
| 正規化 | `normalizeLearningProfile()`。未知の言語・重複を捨て、件数を上限で切り、壊れた値は既定値へ寄せる。Webview からの入力は `messages.ts` でも検証する |

言語カタログは、VS Code の languageId から比較の対象になるプログラミング言語だけを選んでいる（json・markdown などは含めない）。C と C++ は別のファミリーにする。

## 比較の判定（`ComparisonPolicy.resolveComparisonRequest`）

結果は「背景を送る」「何もしない」「案内（AI を呼ばない）」のいずれか。

| 相談の種類 | `off` | `onRequest`（既定） |
|---|---|---|
| 通常の手動相談（言語の指定なし） | なし | なし |
| 手動相談で、比較の語と一緒に登録済みの言語を **1つ** 指定（例「PHPでいう〜」） | なし | **背景** |
| 手動相談で、未登録の言語を指定（例「Rubyでいう〜」） | なし | なし（登録済みの別の言語を混ぜない） |
| 手動相談で、言語を2つ以上指定（登録の有無を問わない） | なし | なし |
| `/compare`（引数なし） | **案内** | **背景**（自動選択） |
| `/compare <登録済みの言語>` | **案内** | **背景**（その言語） |
| `/compare <未登録の言語>` | **案内** | **案内**（登録を促す。差し替えない） |
| `/compare <言語> <言語>` | **案内** | **案内**（1つに絞るよう促す） |
| 他のスラッシュコマンド | なし | なし |
| 常時モードの自動助言 | なし | なし |

- プロファイルが未登録なら、`/compare` は案内、それ以外はすべて「なし」
- 比較の語の判定: 言語名の **直後** に「でいう」「と比べ」「と比較」「との違い」「の違い」「みたいな」「のような」「に相当」「風に」「比較」「vs」が続く場合だけを明示要求とする。言語名が出てきただけ（「PHPのバージョンの違い」など）は数えない
- 学習中の言語自体への言及（「TypeScriptとPHPの違い」の TypeScript）は、指定された言語の数に含めない
- 学習中の言語と同じ言語は比較に使わない（`/compare` では案内を出す）
- 言語名の検出は単語の一部や拡張子を拾わない（`JavaScript` の `Java`、`index.ts` の `ts`、`Node.js` の `js`）。`Go` は大文字小文字を区別する

### 比較言語の決定順

1. 質問文での指定（登録済みの言語が1つのとき）
2. `/compare` の引数
3. （Phase 2）チップに固定した言語
4. 自動選択: 習熟度の高い順（`advanced` > `working` > 指定なし > `basic`）、同点なら登録順。学習中の言語は除く

明示指定（1〜3）では、対応する概念がない言語でも差し替えない。

## プロンプトと送信予定

- `PromptBuilder` は `learnerBackground` があるときだけ、`<learner-background>` ブロックを末尾（ナレッジの後）に追加する。内容は学習中の言語名と、比較に使う言語1つの名前・習熟度だけ
- ブロックには「違いを少なくとも1つ述べる」「構文が似ているだけで同じだと言わない」「対応がなければ無理に類推しない」「他の言語を持ち出さない」「習熟度に合わせる」の制約を付ける
- 任意情報なので、入力予算に収まらなければ途中で切らずに丸ごと省く。閉じタグは区切り注入対策で無効化する
- 送信予定には、背景を送るときだけ「学習プロファイル」カテゴリが表示される
- 背景を送らない場合、プロンプト・送信予定・自動助言の fingerprint は従来と同一（評価シナリオ 78 件 × 推論強度 2 種で一致を確認）
- `/compare` の指示は `shared/skills.ts` のレジストリにある。送る文脈は `/hint` と同じ（アクティブファイル、選択範囲、Diagnostics、最近の編集）

## 設定画面

設定画面の「共通設定」に「学習プロファイル」節を追加した（`LearningProfileSettings.tsx`）。

- 経験のある言語の追加・削除、習熟度の選択（任意）
- 既知言語との比較: 「オフ」「求めたときだけ」
- 保存は既存の保存バーから行う。学習プロファイルだけを変更した場合は `saveLearningProfile` だけを送り、接続の再確認を伴う `saveSettings` は送らない
- 「初期値に戻す」（設定の初期化）では学習プロファイルは消えない。別の保存先のため

## 診断ログ

背景を送ると決めたとき、NaviCom Diagnostics に `learning_profile_comparison`（出どころ・言語ID・学習中の言語ID）を記録する。質問文やコードは記録しない。

## 実装と検証の入口

| 責務 | 主なファイル |
|---|---|
| 型・言語カタログ・正規化 | `src/shared/learningProfile.ts` |
| 保存 | `src/services/LearningProfileService.ts`、`src/extension.ts` |
| 比較の判定 | `src/services/ComparisonPolicy.ts` |
| 配線 | `src/application/NavigatorController.ts`（`resolveComparison`、`askForGuidance*`、`runGuidanceRequest`）、`RequestPlanCoordinator.ts`（送信予定のプレビュー） |
| プロンプト・送信予定 | `src/services/PromptBuilder.ts`、`src/services/RequestPlanTransmission.ts` |
| スキル | `src/shared/skills.ts`（`/compare`） |
| UI・メッセージ | `src/views/webview/components/LearningProfileSettings.tsx`、`src/views/screens/s06-settings.tsx`、`src/shared/messages.ts`、`src/views/NavigatorViewProvider.ts` |
| テスト | `test/ComparisonPolicy.test.ts`（設計書の C6・C7・C15〜C24 ほか）、`test/LearningProfile.test.ts` |

## Phase 2 へ進む前の確認

- 実機で `/compare` と「PHPでいう〜」の回答を10件以上確認し、違いに触れているか・誤った類推がないかを評価する
- 比較の語の検出が、通常の質問を誤って拾っていないか（Diagnostics の `learning_profile_comparison` で確認）
