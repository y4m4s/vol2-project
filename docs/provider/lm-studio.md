# LM Studioの現状実装

確認日: 2026-09-09。[プロバイダー一覧](README.md)

## 接続とモデル選択

- 内部IDは `lmStudio`。既定URLは `http://127.0.0.1:1234`、保存項目は `lmStudioBaseUrl` と `lmStudioModelKey`。
- HTTP(S)のルートURLで、ホストは `127.0.0.1`、`localhost`、`::1` のみ許可する。設定画面にURLの自由入力欄はない。
- `GET /api/v1/models` を5秒でタイムアウトさせる。`type === "llm"` かつ `loaded_instances.length > 0` のモデルだけを選択肢にする。識別子は `models[].key`。
- 保存済みモデルがロード中なら再利用する。見つからない・未ロードなら選択を解除し、ロード中モデルが1件なら自動選択、複数ならQuickPick、0件なら `unavailable` とする。
- モデル一覧取得と選択で接続を確認し、生成probeは送らない。モデルのダウンロード・自動ロード・個別アンロードは実装しない。
- APIトークンの設定やAuthorizationヘッダーはない。401/403は認証設定の確認を案内する。

## 推論

Thinking指定付きの助言は `POST /api/v1/chat` を使用する。モデル一覧の `capabilities.reasoning.allowed_options` を確認し、低は `reasoning: "off"`、高は `"on"`（段階式モデルでは `"high"`）を送る。非対応なら生成前にエラーにし、設定を無視した再送はしない。system_prompt/input、max_output_tokens、stream:false、store:false、integrations:[] を送り、サーバー会話保存・外部ツール連携を使わない。形式修復でもThinking指定を維持する。指定のないナレッジ生成などは従来の `/v1/chat/completions` を使う。タイムアウト120秒、キャンセル・受信サイズ制限・リダイレクト拒否は共通処理を利用する。

参照ファイル本文はプロンプト内に含まれる。ネイティブAPIではoutput内のmessageだけを回答として扱い、reasoning本文は表示・保存しない。statsの入力・総出力・推論トークン数、生成速度、最初のトークンまでの秒数を取得し、診断ログに記録する。出力上限に到達した場合はlengthとして扱う。互換APIの経路では従来のusage、model、finish_reasonと参照パスの付加を維持する。トークン数が得られない場合は共通の概算を使い、日次トークンガードも適用する。

仕様: [Chat with a model](https://lmstudio.ai/docs/developer/rest/chat)、[List your models](https://lmstudio.ai/docs/developer/rest/list)。対応するネイティブAPIとThinking設定を公開するモデルが必要。

2026-09-11、Qwen3 8Bで低用の同一プロンプトをThinking off/onで各1回比較した。offは約11秒・推論0トークン、onは約23秒・推論196トークン。どちらも単独printを複数行と誤説明しており、速度改善と内容の正確性は別に扱う。この誤答を落とす個数評価も追加した。低で完成済みHelloは約2.3秒・推論0トークン・no_advice。高の本番相当設定でも推論222トークンを確認したが、回答内容には不正確な改行説明が残る。記録は `.test-out/lm-thinking-off.json`、`lm-thinking-on-same.json`、`lm-thinking-complete.json`、`lm-thinking-high.json`。単体テスト220件・通信テスト5件・lint・ビルド成功。識別子は `2026-09-11-lmstudio-thinking-v1`。測定は各1回で、ロードやキャッシュ、他の処理による時間変動を含みうる。

接続切り替えに失敗した場合、Coordinatorは設定をCopilotへ戻し、既存Copilot接続を利用するか接続を試す。推論失敗時は他プロバイダーへ再送しない。

## サーバー操作と画面

設定画面からLocal Serverの状態更新・起動・停止を実行できる。`LmStudioServerService` は `lms server status --json --quiet`、`lms server start --port … --bind 127.0.0.1`、`lms server stop` を実行する。CLIはユーザーの `.lmstudio/bin` とPATHから検出し、`execFile` で実行する。

CLIの状態だけでなくHTTP応答・ポート状態も照合する。起動中、停止中、CLI未検出、認証要求、ポート競合、設定ポートとの不一致などを区別する。CLIの通常待機は15秒、起動は75秒、HTTP確認は2秒、遷移確認は10秒。

ポート不一致時は「実行中ポートへ接続先を変更」または「設定ポートで再起動」を選べる。起動成功後はロード中モデルを更新するが、モデル未ロードはサーバー停止と区別する。LM Studio利用中の停止成功後は接続を解除し、Copilot設定へ戻して接続を試す。

Workspace Trust未許可では操作できず、生成などの処理中は起動・停止を抑止する。設定タイトルのアイコンとサーバーカードは設定画面に実装済みで、旧文書の追加実装手順は不要になっている。

## 実装・検証箇所

### 課題達成判定の実機評価

LM Studioのローカルサーバーを起動し、モデルをロードしてから実行する。APIキーは不要なローカル構成を対象とする。サーバーの保存設定を変更せず、各リクエストでThinkingを指定する。本番と同じ `LmStudioClient` を使い、低はThinkingオフ・2,048、高はThinkingオン・8,192トークンを要求する。`--reasoning-effort high` または `none` を評価時だけ指定すると、同じ深さ・プロンプトでThinking有無を比較できる。

```powershell
npm run eval:lmstudio-completion -- --list-models
npm run eval:lmstudio-completion -- --model qwen/qwen3-8b --filter vertical --depth low --repeat 3 --output lmstudio-low.json
npm run eval:lmstudio-completion -- --model qwen/qwen3-8b --filter vertical --depth high --repeat 3 --output lmstudio-high.json
npm run eval:lmstudio-completion -- --model qwen/qwen3-8b --filter hello-reported --depth low --output lmstudio-hello.json
```

`--model` は一覧にあるキーを指定する。既定の接続先は `http://127.0.0.1:1234`。異なるローカルポートには `--base-url` を指定する。`--filter` はケースIDの部分一致、未指定なら全課題ケース。`--suite automatic` で既存の自動助言ケースも使える。各ケースに最大1回の形式修復を行うため、最大リクエスト数はケース数×反復数×2。評価するのは合成したコードと課題で、エディターや個人ファイルは収集しない。

結果には接続先種別、モデル、生成応答、表示前検証結果、利用トークン、応答時間、推論フィールドの文字数を保存する。内部推論の本文は保存しない。`--capture-prompts` と `--replay-prompts` で同じプロンプトを保存・再利用できる。失敗ケースがあれば終了コード1。通信テストは `npm run test:local-eval` で実行でき、模擬サーバーだけを使用する。

Ollamaは低でも高相当の文脈・指示を使うため、UIの「低」が同じでも送信条件は同一ではない。モデルや実行環境だけの差を測る場合は、保存プロンプトやThinking設定も揃えて比較する。

2026-09-10にロード済みのQwen3 8B（Q4_K_M、コンテキスト8,192）で検証した。低の縦並び3件はすべてcontinue、うち2件は完成コード提示で不合格。高の縦並び2件はcontinue、完成済みHelloは低・高各1件ともno_adviceだった。高の回答にも「printを1つに統合する必要がある」と実装方法を限定する表現が残り、機械評価の合格は内容の完全な正確性を保証しない。記録は `.test-out/lmstudio-vertical-low.json`、`lmstudio-vertical-high.json`、`lmstudio-hello-low.json`、`lmstudio-hello-high.json`。既存テスト214件、追加通信テスト5件、lint、ビルド成功。

- [LmStudioClient.ts](../../src/services/LmStudioClient.ts)、[OpenAICompatibleClient.ts](../../src/services/OpenAICompatibleClient.ts)
- [LmStudioServerService.ts](../../src/services/LmStudioServerService.ts)、[LmStudioServerProtocol.ts](../../src/services/LmStudioServerProtocol.ts)
- [LmStudioCoordinator.ts](../../src/application/coordinators/LmStudioCoordinator.ts)
- [LmStudioClient.test.ts](../../test/LmStudioClient.test.ts)、[LmStudioServerProtocol.test.ts](../../test/LmStudioServerProtocol.test.ts)、[ConnectionService.test.ts](../../test/ConnectionService.test.ts)

実機確認では、サーバー未起動・モデル未ロード・複数モデル・認証有効・ポート不一致・停止後のCopilot復帰を確認する。F5で画面自体が出ない場合は、ビルド結果に加えてVS Codeの保存済みview stateや `View: Reset View Locations` も確認する。
