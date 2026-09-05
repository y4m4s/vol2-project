# 18. OrcaRouter連携における不都合リスク

[17. OrcaRouter導入設計・実装](17-orca-router-integration-design.md)を前提とした、外部仕様（OrcaRouter側）の変更・挙動によってこのプロダクトに不都合が起こりうる箇所の洗い出し。実装調査時点のコードに基づく。

## 共通する構造

自動テストは固定のモック応答に対して書かれており、実APIキーを使った通信試験は自動テストに含めない方針（[17番 テスト方針](17-orca-router-integration-design.md#テスト方針)）。そのため、OrcaRouter側の実仕様が変わっても、それを検知する仕組みがない。以下のリスクはすべてこの前提の上に成り立つ。

## 1. 429の「Retry-Afterの有無」で意味を判別する分岐が脆い

`free_rate_limited`エラーの場合、`Retry-After`ヘッダーの有無だけで次を切り分けている（[AdviceService.ts:616-620](../src/services/AdviceService.ts#L616-L620)）。

- あり: レート上限。時間を置けば解決する
- なし: 無料モデルの1リクエスト入力上限。文脈を短くしないと解決しない

OrcaRouterがヘッダー付与ルールを変更すると誤爆する。例えば入力上限超過時にも`Retry-After`を付けるようになれば「再試行すれば直る」と誤案内し、ユーザーが同じ長さのプロンプトで無駄なリトライを繰り返す。逆のケースでは「文脈を短くしろ」という的外れな案内になる。

## 2. `free_quota_exhausted` / `free_rate_limited`という文字列コードへの直接依存

[AdviceService.ts:613,616](../src/services/AdviceService.ts#L613-L616)はOrcaRouterが返す`error.code`の正確な文字列一致でのみ専用メッセージを出す。コード名が変更・別名に統合されると、静かに汎用メッセージ（quota/rateLimit分岐）にフォールバックし、テストが失敗しない限り気づけない。

## 3. Guardrailのエラーコード集合もハードコード

[OrcaRouterErrorPolicy.ts:5-9](../src/services/OrcaRouterErrorPolicy.ts#L5-L9)の`GUARDRAIL_ERROR_CODES`（`guardrail_blocked` / `prompt_blocked` / `sensitive_words_detected`）に無い新しいGuardrail拒否コードが追加されると、Guardrailだと分からない汎用メッセージにフォールバックする（[OrcaRouterErrorPolicy.ts:42](../src/services/OrcaRouterErrorPolicy.ts#L42)）。ユーザーはGuardrailに引っかかったと気づかず、モデル設定を無駄に疑う可能性がある。

## 4. コスト表示の信頼性がOrcaRouter依存で、乖離を検知する手段がない

[UsageMeter.ts:98](../src/services/UsageMeter.ts#L98)は応答の`cost_usd`をそのまま採用する。design doc自身が「確定請求額とは限らない」と認めている通り、OrcaRouterが応答時点の見積もりを甘くしたり後から遡及値上げする料金体系にした場合、プロダクト上の表示額と実際の請求額が乖離しうる。UI上の免責表示がどこまで実装されているかは別途確認が必要。

## 5. 固定モデル名`orcarouter/free` / `orcarouter/auto`のハードコード

design docに明記の固定選択肢としてUIに出しているため（[17番 モデル一覧](17-orca-router-integration-design.md#モデル一覧)）、OrcaRouterが命名規則やモデルIDを変更・廃止すると、存在しないモデルIDをユーザーが選択できてしまう。実行時に初めて404/other系エラーになり、「選んだのに動かない」という体験になる。取得したモデル一覧との突き合わせによる事前検証がない。

## 6. Retry-Afterの単位・書式の前提

コードは`error.retryAfter`をそのまま秒数として文言に埋め込む（[AdviceService.ts:618,628](../src/services/AdviceService.ts#L618)）。HTTPの`Retry-After`ヘッダーは仕様上「秒数」または「日付」のどちらも許容されるため、OrcaRouterが日付形式で返すと「Wed, 21 Oct 2026...秒後に再試行してください」のような破綻した文言になりうる。[OrcaRouterClient.ts:159](../src/services/OrcaRouterClient.ts#L159)ではヘッダーの生文字列を保持するのみで、秒数へのパース・検証がない。

## まとめ

最大のリスクは、OrcaRouter側の「エラーコード文字列」「ステータスコードの意味づけ」「Retry-Afterの付与規則」が変わったときに、プロダクト側が気づかず誤った案内を出し続けること。これらは自動テストの対象外であるため、実際のOrcaRouter仕様変更を検知する仕組みが現状ない。対策候補としては、未知のエラーコード・不正な形式のRetry-Afterを検出して汎用的な安全側メッセージにフォールバックさせる、モデル一覧との突き合わせで固定モデル名の存在を確認する、などが考えられる。

## 検知の実装方針

新規の通信は発生させず、既存フローで受け取ったレスポンスをその場で検証する方式に限定する。実APIキーでの定期疎通チェック（監視目的の能動的なリクエスト）は、既存の「実API通信試験は自動テストに含めない」方針と衝突するため今回は対象外とし、別途合意した上で検討する。

### 対象1: 未知のエラーコード・不正なRetry-Afterのログ検知（リスク1, 2, 3, 6 に対応）

`OrcaRouterErrorPolicy.ts`と`AdviceService.ts`のエラー分類パスに、想定外の値が来た場合の`console.warn`を追加する。ユーザー向け文言は変更せず、開発者が事後に気づけるようにするだけの防御的ログ。

- `classifyOrcaRouterFailure`が`requestRejected`と判定したが、`error.code`が`GUARDRAIL_ERROR_CODES`のいずれにも一致しない場合 → 「Guardrail判定漏れの可能性」としてコード値ごとログ
- `error.code`が`free_quota_exhausted` / `free_rate_limited`と完全一致しないが、`quota` / `rateLimit`種別かつコード文字列に`free`を含む場合 → 「free系コードの命名変化の可能性」としてログ（新コードへの追従漏れの早期発見用）
- `error.retryAfter`が存在するが、秒数として解釈できない文字列（`Number.isFinite`でパース不能）の場合 → ログに加え、文言生成時は「時間を置いて再試行してください」等の値非依存の表現にフォールバックする（現状の「破綻した文言」を防ぐ実質的な修正を兼ねる）

ログはユーザーには表示せず、開発者が拡張機能の出力ログ（既存の`console.warn`/`console.error`の使用箇所と同様の経路）から確認できれば十分とする。

### 対象2: 固定モデル名の存在検証（リスク5に対応）

モデル一覧取得（`GET /models`、既存の正規フロー）の結果に対して、`orcarouter/free` / `orcarouter/auto`が含まれるかを突き合わせる。

- 含まれない場合、その固定選択肢をUI上で選択不可または警告表示にする（実行時エラーで初めて気づく状態を防ぐ）
- 含まれないこと自体も`console.warn`でログし、命名変更の可能性を記録する

### 対象外（今回やらないこと）

- 定期的な能動的疎通チェック（監視ジョブ）: 実APIキー通信を伴うため方針との調整が必要。別途相談する。
- コスト表示の乖離検知（リスク4）: OrcaRouter側の確定請求額と比較する手段がなく、プロダクト単体では検知不可能。UI上の免責表示の見直しで対応する方が筋が良い。
