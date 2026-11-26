# 18. 学習プロファイルと既知言語との比較（Phase 1・Phase 2）

ユーザーが経験のある言語を登録し、比較が理解を助ける場面でだけ、その言語と比べた説明を受けられるようにする。
設計検討の全体（つまずき検知を含む）は、設計書 [学習プロファイル・言語比較支援・つまずき検知 設計検討](learning-support-design.md)（r4）にある。この文書は Phase 1・Phase 2 で実装した範囲の仕様である。

## 目的と範囲

- 既知の言語との比較は、理解を助ける補助として使う。毎回は出さない
- Phase 1: **明示的な比較要求**（`/compare`、質問文での言語の指定）のときに学習プロファイルを使う
- Phase 2: 比較が役立ちそうな場面をローカルで判定し、モードに応じて **控えめに提案する**（`suggest`）か、**助言の中に短く含める**（`auto`）
- つまずき検知（設計書 Phase 3）は未実装
- 送るプロファイルの言語は常に **1つ**。ユーザーが指定した言語を別の言語へ差し替えない
- 比較の判定のためだけの AI 呼び出しはしない。判定はすべてローカル（`ComparisonPolicy`）で行う。提案チップも、押されるまで AI を呼ばない

## データと保存

| 項目 | 内容 |
|---|---|
| 型 | `LearningProfile`（`src/shared/learningProfile.ts`） |
| 経験のある言語 | `knownLanguages`。最大8件。言語は `LANGUAGE_CATALOG` のファミリーID（`typescriptreact` は `typescript` へ寄せる）。習熟度 `level` は任意（`basic` / `working` / `advanced`） |
| 学習中の言語 | 設定項目は設けず、常に編集中のファイルの言語（ファミリーへ寄せたもの）とする。カタログ外の言語（json など）のときは未指定。設計書 §3.4 の「固定する」案は、使う場面が少なく設定を複雑にするため採用しなかった。以前の保存値に `targetLanguage` が残っていても読み捨てる |
| 比較の設定 | `comparisonMode`。`off` / `onRequest`（既定）/ `suggest` / `auto` |
| 今後出さない | `dismissedConcepts`。提案チップで「今後出さない」を選んだ内容。キーは `学習中の言語:概念ID`（例 `typescript:nullability`）。最大100件 |
| 保存先 | `globalState` のキー `aiPairNavigator.learningProfile.v1`（`LearningProfileService`）。ユーザー単位の情報なので、ワークスペース単位の設定（`workspaceState`）とは分ける。Settings Sync の対象にしない |
| 正規化 | `normalizeLearningProfile()`。未知の言語・重複を捨て、件数を上限で切り、壊れた値は既定値へ寄せる。Webview からの入力は `messages.ts` でも検証する。設定画面の保存は `dismissedConcepts` を送らず、保存済みの値を引き継ぐ |

言語カタログは、VS Code の languageId から比較の対象になるプログラミング言語だけを選んでいる（json・markdown などは含めない）。C と C++ は別のファミリーにする。

## 動作表（`ComparisonPolicy.resolveComparisonRequest`）

モードを判定するのはこの関数だけ。比較が内容的に成り立つか（`assessComparison`）はモードを見ない。

| 相談の種類 | `off` | `onRequest`（既定） | `suggest` | `auto` |
|---|---|---|---|---|
| R1 手動相談（言語の指定なし） | なし | なし | 適用可なら回答の後に **チップ** | 適用可なら **背景**（短く含める） |
| R2 手動相談で、比較の語と一緒に登録済みの言語を **1つ** 指定（例「PHPでいう〜」） | なし | **背景** | **背景** | **背景** |
| 手動相談で、未登録の言語・2つ以上の言語を指定 | なし | なし | なし | なし（別の言語を混ぜない） |
| R3 `/compare` | **案内** | **背景** | **背景** | **背景** |
| R4 他のスラッシュコマンド | なし | なし | なし | なし |
| R5 常時モードの自動助言 | なし | なし | 適用可で `advice` なら **チップ** | 適用可なら **背景**（選んだ focus の中に短く） |
| R8 チップのクリック | — | — | **背景**（提案時の言語・概念に固定） | — |

- プロファイルが未登録なら、`/compare` は案内、それ以外はすべて「なし」
- `/compare` の引数: 未登録の言語・複数の言語は案内（差し替えない）。学習中の言語と同じ言語も案内
- 比較の語の判定: 言語名の **直後** に「でいう」「と比べ」「と比較」「との違い」「の違い」「みたいな」「のような」「に相当」「風に」「比較」「vs」が続く場合だけを明示要求とする。言語名が出てきただけ（「PHPのバージョンの違い」など）は数えない
- 学習中の言語自体への言及（「TypeScriptとPHPの違い」の TypeScript）は、指定された言語の数に含めない
- 言語名の検出は単語の一部や拡張子を拾わない（`JavaScript` の `Java`、`index.ts` の `ts`、`Node.js` の `js`）。`Go` は大文字小文字を区別する
- `no_advice` の後にはチップを出さない。チップは1つだけで、次の回答が出たら消える

### 比較言語の決定順

1. 質問文での指定（登録済みの言語が1つのとき）
2. `/compare` の引数
3. チップに固定した言語（クリック時に再計算しない）
4. 自動選択: 概念が特定できたら、その概念に対応のある言語を「対応度（近い > 一部）→ 習熟度 → 登録順」で選ぶ。特定できなければ習熟度の高い順（同点なら登録順）。学習中の言語は除く

明示指定（1〜3）では、対応する概念がない言語でも差し替えない。

## 比較の適用可否（`assessComparison`、Phase 2）

R1・R5 で使う。次の順に判定し、最初に当たった理由で「適用不可」とする。

1. プロファイルが未登録（`no_profile`）
2. 学習中の言語がカタログ外、または学習中の言語を「高度」で登録している（`not_learning`）
3. 概念の候補がない（`no_candidate`）、診断がスペルミスなど些末なものだけ（`trivial`）、候補はあるが裏付けがない（`unconfirmed`）
4. 「今後出さない」にした概念（`dismissed`）
5. 登録した言語に対応のある言語がない（`no_counterpart`）
6. 同じ概念・言語を30分以内に提示済み（`recently_shown`。セッション内のメモリで管理）

### 概念の検出（候補と裏付け）

概念カタログ `src/shared/languageConcepts.ts` は、学習中の言語が TypeScript / JavaScript のときに使う6概念（null / undefined の扱い、構造的型付け、非同期処理、配列の操作、ジェネリクス、等価比較）と、それぞれの各言語との対応（近い / 一部 / なし と短い説明）を持つ。

診断コードやキーワードは **候補** を出すだけに使い、別の種類の証拠で **裏付け** が取れた概念だけを採用する。

| 候補の出どころ | 裏付けとして使うもの |
|---|---|
| 診断コード（例: TS18048、TS2322） | 診断メッセージの形（例: `undefined` を含む、`is missing in type`）、または診断の前後2行のコード |
| 選択範囲・カーソル行のキーワード（例: `?.`、`await`、`.map(`） | その位置にあること自体 |
| 質問文の語（例:「Promise」「インターフェース」） | カーソルの前後3行のコードにキーワードがあること、または同じ概念の診断 |

- TS2322 のように、単なるプリミティブ同士の不一致（`string` と `number`）でも出る診断は、構造的型付けの候補にしない
- 「文字列と数値の扱い」（`primitive_types`）はカタログにあるが、誤った類推の危険が比較的大きいため無効（評価で効果を確かめてから有効にする）
- 証拠（診断コード・周辺のコード・カーソル行）はローカルの判定にだけ使い、プロンプトには入れない。送信用の `DiagnosticSummary` は変えていない（`ContextCollector.collectComparisonEvidence`）
- 送信対象から除外したファイル（保護パターン・追加の除外パターン。`RequestPlanner.isFileExcluded` と同じ規則）では証拠を集めない。そのため除外ファイルでは、`suggest` / `auto` の提案や背景は出ない（明示要求の `/compare` などでは、言語だけの背景を送る）
- 証拠の読み取り量は固定する。診断は先頭20件、診断ごとの周辺コードは「開始行の2行前〜終了行の2行後」を最大7行、カーソル付近は前後3行。読む行数は全体で120行、1行は400文字まで（文書全体を覆う診断でも同期走査しない）

## プロンプトと送信予定

- `PromptBuilder` は `learnerBackground` があるときだけ、`<learner-background>` ブロックを末尾（ナレッジの後）に追加する。内容は学習中の言語名、比較に使う言語1つの名前・習熟度、特定できたときは概念名と対応の説明だけ
- ブロックには「違いを少なくとも1つ述べる」「構文が似ているだけで同じだと言わない」「対応がなければ無理に類推しない」「他の言語を持ち出さない」「習熟度に合わせる」の制約を付ける
- `auto` で含める背景（`source: "inline"`）には、加えて「役立つときだけ、回答（自動助言では選んだ focus）の中に2文以内で添える。独立した節にしない」の制約を付ける
- 任意情報なので、入力予算に収まらなければ途中で切らずに丸ごと省く。閉じタグは区切り注入対策で無効化する
- 送信予定には、背景を送るときだけ「学習プロファイル」カテゴリが表示される
- 背景を送らない場合、プロンプト・送信予定・自動助言の fingerprint は従来と同一（評価シナリオ 78 件 × 推論強度 2 種で一致を確認）。自動助言の fingerprint には背景を含めない（同じ文脈では再送しない）
- 自動助言の JSON 契約は変えていない。比較を実際に提示したかは、回答に比較の言語名が含まれるかで判定し、提示済みとして記録する
- `/compare` の指示は `shared/skills.ts` のレジストリにある。送る文脈は `/hint` と同じ（アクティブファイル、選択範囲、Diagnostics、最近の編集）

## 提案チップ（`suggest`、Phase 2）

- 会話画面の入力欄の上に1つだけ表示する（`LearningSuggestionChip.tsx`）。文言の例「PHPと比べて『null / undefined の扱い（?. ・ ??）』を説明する」
- 操作: 「説明する」（比較の説明を1回生成）、「今後出さない」（`dismissedConcepts` に保存）、「✕」（閉じる）
- 提案には、提案時の文書 URI・version・言語・概念を持たせる（Extension Host 側で保持し、Webview には ID と文言だけを渡す）
- 提案元とは別のファイルを開いている間は表示しない。戻ると再表示する
- クリック時の再検証: 別のファイルを開いていれば提案元を開き直してから実行する。開けなければ案内だけを出して破棄する。比較がオフになった・言語の登録を外した場合も案内だけ
- クリック時は、まず現在の除外設定を毎回確かめる。提案元のファイルが送信対象から除外されていれば（チップ表示後に除外パターンへ追加し、編集せずに押した場合を含む）、生成せずに提案を取り下げる。除外されたファイルを開いている間はチップも表示しない（`checkSuggestionClick`）
- 提案の後に文書の version が変わっていれば、提案時の概念がまだ当てはまるかを、提案時と同じ規則（候補＋裏付け、質問から出た候補は提案時の質問も使う）で確かめ直す（`suggestionStillApplies`）。当てはまらなければ（修正済み・別のコードに変わった・除外ファイルになった）生成せずに提案を取り下げ、案内を出す
- クリックしたときの質問は「PHPと比べて『…』を説明してください」として会話に残る
- 新しい回答が出たとき、会話を切り替えたとき・作成したとき・削除したときに消える
- 提案を出した時点で、その概念・言語を提示済みとして記録する（30分は同じ提案を出さない）

## 設定画面

設定画面の「共通設定」に「学習プロファイル」節がある（`LearningProfileSettings.tsx`）。

- 経験のある言語: 1言語1行で「言語名・習熟度・削除」。「＋ 言語を追加」から追加する。選択には設定画面用のドロップダウン `SettingsSelect` を使う（ネイティブの select は見た目が揃わないため）
- 既知言語との比較: 「オフ」「求めたときだけ」「控えめに提案する」「助言に自動で含める」。選んだモードの説明を表示する
- 「今後出さない」にした提案があれば件数と「すべて戻す」を表示する（保存バーを経由せず、すぐに保存する）
- つまずきの記録（試験中）: 「記録する」（既定）／「記録しない」。Phase 3a の機能で、仕様は [19. つまずき検知のシャドーモード](19-stuck-detection-shadow-mode.md)
- それ以外は既存の保存バーから保存する。学習プロファイルだけを変更した場合は `saveLearningProfile` だけを送り、接続の再確認を伴う `saveSettings` は送らない
- 「初期値に戻す」（設定の初期化）では学習プロファイルは消えない。別の保存先のため

## 診断ログ

NaviCom Diagnostics に次を記録する。質問文・コード・診断メッセージは記録しない。

- `learning_profile_comparison`: 背景を送ると決めたとき（出どころ・言語ID・学習中の言語ID・概念ID）
- `learning_profile_suggestion_shown`: 提案チップを出したとき（言語ID・概念ID・学習中の言語ID）
- `learning_profile_suggestion_withdrawn`: 文書の変更で提案を取り下げたとき（概念ID・理由）

## 実装と検証の入口

| 責務 | 主なファイル |
|---|---|
| 型・言語カタログ・正規化 | `src/shared/learningProfile.ts` |
| 概念カタログ | `src/shared/languageConcepts.ts` |
| 保存 | `src/services/LearningProfileService.ts`、`src/extension.ts` |
| 比較の判定 | `src/services/ComparisonPolicy.ts`（`assessComparison`、`resolveComparisonRequest`、`resolveSuggestionBackground`） |
| ローカルの証拠 | `src/services/ContextCollector.ts`（`collectComparisonEvidence`、`normalizeDiagnosticCode`） |
| 配線 | `src/application/NavigatorController.ts`（`resolveComparison`、`askForGuidance*`、`handleAutomaticGuidance`、`completeComparison`、`acceptLearningSuggestion`、`dismissLearningSuggestion`）、`RequestPlanCoordinator.ts`（送信予定のプレビュー） |
| プロンプト・送信予定 | `src/services/PromptBuilder.ts`、`src/services/RequestPlanTransmission.ts` |
| スキル | `src/shared/skills.ts`（`/compare`） |
| UI・メッセージ | `LearningProfileSettings.tsx`、`SettingsSelect.tsx`、`SettingTitle.tsx`、`LearningSuggestionChip.tsx`、`s06-settings.tsx`、`s04-conversation.tsx`、`src/shared/messages.ts`、`src/views/NavigatorViewProvider.ts` |
| テスト | `test/ComparisonPolicy.test.ts`（設計書の C1〜C24 と動作表の全セル）、`test/LearningProfile.test.ts` |

## 次の段階へ進む前の確認

- 実機で `suggest` / `auto` を使い、提案・比較が役立つ場面で出るか、不要な場面で出ていないかを確認する（Diagnostics の `learning_profile_comparison` と `learning_profile_suggestion_shown`）
- 提案チップの表示回数・クリック・「今後出さない」の割合を見て、提案が多すぎないかを確かめる
- 概念カタログの対応の説明に誤りがないか、回答と合わせて確認する
- 「文字列と数値の扱い」を有効にするかは、評価（設計書 C11・C12）で決める
