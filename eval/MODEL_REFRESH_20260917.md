# 新モデル・Windows GPU評価（2026-09-17）

## 結果の要約

68回答（主要比較64＋本番API接続確認4）を保存・採点した。現時点では**Qwen3 14Bを次の改善実験の基準**とする。Qwen3.5 9Bは生成速度とメモリ使用量に利点がある一方、現在のNaviCom入力・既定samplingでは形式不正や誤答が残り、置き換えを採用する根拠は得られなかった。Qwen3 8Bの実推論は行っていない。

Intel Arc 140Vでは**Vulkanを選定し、両モデルでGPU推論を実測**した。Ollama通常起動のGPU認識不良は、検証プロセスだけにDLL読み込み先を指定して回避した。SYCL / OpenVINO / ONNX Runtimeの速度比較は実施しておらず、Vulkanがそれらより最速とは結論しない。

本番`src/`・ユーザーの永続設定は変更していない。変更は評価用config、モデル比較runner、起動補助、記録・レポートと、そのテストに限る。終了時にLM StudioはQwen3 14Bのみ、context8192 / parallel4でロード済みと確認。検証サーバー11435は停止済み。LM Studio APIは停止状態を維持した。

## 対象と事前条件

- ユーザー指定により、今後の実推論にはQwen3 8Bを使わない。既存の8B設定・結果は履歴として保持する。
- LM Studio: `qwen3-14b` / `qwen3.5-9b`、ともにlmstudio-community製GGUF Q4_K_M。ロード済みcontextは8192。Vulkan runtime 2.38.0。
- Ollama 0.34.0: 公式`qwen3:14b` / `qwen3.5:9b`のQ4_K_Mを追加する。既存モデルの削除・上書きや永続的な環境変数変更は行わない。
- 実機: Windows、Core Ultra 7 258V、Intel Arc 140V、物理メモリ約31.6 GiB。GPUは共有メモリを使用するため、モデルファイル容量だけで常駐可否を判断しない。

## 比較設計（回答を見る前に固定）

`results/m917-selection.json`の16ケース（8変種 × Python/JavaScript）を各モデル1回実行。二分探索、two-pointer、総和、階段DP、ソート、未提示関数を含む。正解への不要な介入と不正解への沈黙を分けて評価する。既に観測済みのtuning問題を用いる探索的スクリーニングであり、新しいholdoutによる最終採用判定ではない。

- 同一provider内でモデルだけを明示的に切り替え、ケース順を無作為化し先行モデルを交互にする。逐次推論。
- production prompt/context、全文取得上限、言語参照は固定。Thinking OFF、出力上限2048。
- samplingは現状のモデル/backend既定値を継承し、未知の値をゼロと扱わない。したがって比較対象は「そのモデルの現在の配備構成」であり、重みだけの因果比較ではない。
- LM Studioは本番native chat API。Ollamaは`num_ctx=8192`とdecode計測が可能なeval用native adapter。このためprovider間の速度差をモデル能力差と解釈しない。
- 機械判定後、provider・モデル名・速度・A/Bキーを除いたpacketをCodexが9軸で評価。設計者とJudgeは同じであり、完全な独立性はない。
- 回答・エラー・再整形・実際のリクエスト・token量・量子化・context・速度を保持。タイムアウトを誤答と同一視しない。単一試行の勝率で本番既定値を自動変更しない。

## 再現

```powershell
npm run compile:ext
$ids = ((Get-Content eval/results/m917-selection.json -Raw | ConvertFrom-Json).ids -join ',')
node eval/run-paired.mjs --baseline eval/configs/m917-lm-q3-14b.json --candidate eval/configs/m917-lm-q35-9b.json --out eval/results/my-lm-models --ids $ids --model-comparison
node eval/run-paired.mjs --baseline eval/configs/m917-oll-q3-14b.json --candidate eval/configs/m917-oll-q35-9b.json --out eval/results/my-oll-models --ids $ids --model-comparison
```

`--model-comparison`は同一provider・同一リクエスト制御のみ許容する。通常の設定比較は引き続き同一モデルを要求する。出力先は新しい名前を指定する。中断後は同じ引数に`--resume`を追加できる。

## Windowsバックエンド選定

| 候補 | 今回の扱い | 根拠・追加作業 |
|---|---|---|
| Vulkan | 第一候補として実測 | LM Studioで選択済み。Ollama 0.30以降は既定有効でIntel GPUにも対応。実際のoffloadをログで検証する |
| SYCL | 今回は未実測 | llama.cppはWindows/Intel GPUをサポート。別バイナリとoneAPI依存関係の検証が必要。Ollamaのモデルタグ設定では切り替えられない |
| OpenVINO GenAI | 次段階候補、今回は未実測 | 公式対応表にQwen3.5-9Bあり。別runtime・モデル変換/量子化・NaviCom接続adapterを揃えて比較する必要がある |
| ONNX Runtime GenAI | 今回は未実測 | Qwen系exportを提供。ただしQwen3.5 recurrent operatorとexecution providerの組合せに制約があり、Intel GPUでの実行可否・性能は未確認 |

公式資料（確認日2026-09-17）:

- [Ollama hardware support](https://docs.ollama.com/gpu)
- [Ollama 0.30 / Vulkan](https://ollama.com/blog/improved-performance-and-model-support-with-gguf)
- [Qwen3:14b](https://ollama.com/library/qwen3:14b) / [Qwen3.5:9b](https://ollama.com/library/qwen3.5:9b)
- [llama.cpp SYCL](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/SYCL.md)
- [OpenVINO GenAI supported models](https://openvinotoolkit.github.io/openvino.genai/docs/supported-models/)
- [ONNX Runtime GenAI model builder](https://github.com/microsoft/onnxruntime-genai/blob/main/src/python/py/models/README.md)

未実測backendがVulkanより遅い、または非対応であるという結論は出さない。

## 中断・再開時の環境変化

LM Studioの32回答は中断前に完了していた。再開時のユーザー指定は「14Bのみロード」。この時点でCLI/APIからはLM Studioサーバー停止・モデル未ロードと観測した。完了済み回答は再生成していない。

Ollamaは再開までに0.34.0から0.34.1へ更新されていた（本作業では更新していない）。通常サーバー11434の起動ログは`OLLAMA_VULKAN:true`にもかかわらずCPUのみを検出し、`size_vram=0`。最初の評価は完了回答0件で中断し、`m917-oll-*`に診断用のmanifestを保持した。

同じインストールの`llama-server --list-devices`は通常起動ではGPUなし、`GGML_BACKEND_PATH`に既存`ggml-vulkan.dll`を指定するとArc 140Vを検出した。これはDLL読み込み経路が関係することを示すが、更新が唯一の原因とは断定しない。

グローバル設定を変えず、プロセス単位でDLLを指定した検証サーバー11435を起動。`OLLAMA_MAX_LOADED_MODELS=1`でモデル常駐の競合を避け、`OLLAMA_NOPRUNE=1`でこのサーバーからの未使用blob整理を抑止した。測定用configは`m917-oll-vulkan-*.json`、出力は`m917-oll-vulkan-*`。モデル切替時のロード時間は別途保存し、LM Studioの常駐時速度と同一条件と扱わない。

```powershell
# 別のPowerShellプロセスで実行。終了はCtrl+C。永続環境変数は変更しない。
powershell -NoProfile -File eval/serve-ollama-vulkan.ps1
# 別ターミナルで評価する
$ids = ((Get-Content eval/results/m917-selection.json -Raw | ConvertFrom-Json).ids -join ',')
node eval/run-paired.mjs --baseline eval/configs/m917-oll-vulkan-q3-14b.json --candidate eval/configs/m917-oll-vulkan-q35-9b.json --out eval/results/my-oll-vulkan --ids $ids --model-comparison
```

この回避策は通常の11434サーバーの設定を修正するものではない。NaviComで継続利用する場合は、上の専用サーバー起動中に接続先を11435にするか、別途通常サーバーの起動環境を修正してGPU認識を再検証する。

## Samplingの解釈

Ollama `qwen3:14b`の配布既定値はtemperature=0.6、top_p=0.95、top_k=20、repeat_penalty=1。公式Qwen3のNon-Thinking候補（0.7 / 0.8 / 20 / min_p=0）とは異なる。今回はモデル変更前後の配備状態を先に記録するため既定値を保持し、最適値とは扱わない。次のsampling比較では公式Non-Thinking値を候補に含める。

Qwen3.5では公式カードがThinkingの精密コーディング用にtemperature=0.6、top_p=0.95、top_k=20、min_p=0、presence_penalty=0、repetition_penalty=1を示す。一方、Non-Thinkingのreasoning用値は同じカード内のAPI節とBest Practices節に相違があるため、「唯一の公式推奨値」として固定しない。mode・用途・参照節を明記して別実験とする。

- [Qwen3-14B公式カード](https://huggingface.co/Qwen/Qwen3-14B)
- [Qwen3.5-9B公式カード](https://huggingface.co/Qwen/Qwen3.5-9B)

今回の出力2048 tokenはNaviComの短い説明・ヒントの制約を揃えるための上限。モデルカードの長文競技推論benchmark設定とは用途が異なる。Thinking ONの能力上限を今回のOFF結果から推定しない。

## 追加の接続確認（Ollamaの回答内容を評価する前に固定）

Ollama本番経路はOpenAI互換APIであるため、native adapterの16ケースが終了してから、本番transportでも二分探索Python・正しいソートJavaScriptの2ケースを各モデルで確認する。通常サーバーのGPU不認識を避け、同じ専用サーバー11435を使用。`num_ctx`は本番APIから指定できないためnullとし、実際の割当を記録する。これは接続・形式・Thinking設定のsmoke testであり、16ケースの成績とは混ぜない。

速度集計ではOllamaの全リクエストの`load_duration < 1秒`である回答を「低ロード時間の回答」として別掲し、件数も示す。キャッシュやOS負荷の完全な統制はしていないため、厳密な定常性能benchmarkとは呼ばない。

## LM Studio結果

[匿名比較の全9軸・ケース別理由](results/m917-lm-comparison/report.md)。判定の再生成は`node eval/review-m917-lm.mjs`、集計は`node eval/report.mjs --comparison eval/results/m917-lm-comparison --judgments eval/results/m917-lm-comparison/judgments.json`。

| 指標 | Qwen3 14B | Qwen3.5 9B |
|---|---:|---:|
| タスク達成（手動評価） | 8/16 | 9/16 |
| Hard Check通過 | 13/16 | 11/16 |
| 応答時間中央値 | 11.15秒 | 14.40秒 |
| 応答時間p95 | 28.19秒 | 39.32秒 |
| decode速度中央値 | 7.17 token/秒 | 13.47 token/秒 |
| 形式修正を試した回答 | 5/16 | 5/16 |
| 最終形式不正 | 0/16 | 2/16 |
| 全生成token（修正分を含む） | 1,068 | 2,169 |

9Bの対14B勝率は43.75%（引分0.5、5勝7敗4分）、問題単位bootstrap 95% CIは25～50%。タスク達成件数では9Bが1件多いが、対比較・形式・応答時間を合わせると明確な品質改善とは言えない。新Championには昇格しない。14Bへのユーザーの現在の選択を維持して次の実験を行う。

具体的な差:

- JavaScriptの階段DP: 14Bは沈黙してバグを見逃した。9Bは`n=2`で1となる反例を挙げ、初期化への着目を促せた。
- Pythonの同じDP: 14Bは見逃し、9Bは課題にない画面表示を要求した。別言語で成功したことを全般的な理解と扱わない。
- Pythonの二分探索: 9Bは範囲変化を正確に追ったが指定の結果ラベルを欠く。14Bは結果1を示したが範囲変化の説明が不足。Hard Checkと意味的評価は区別した。
- JavaScriptの正しい数値ソート: 14Bは適切に沈黙。9Bは形式不正となり、raw回答にも比較関数を無視した誤診があった。
- 両モデルともtwo-pointerの指定例を十分に説明できず、正しいPython `sorted(a)`に不要な確認を促した。

9Bの生成速度は速いが、長い回答と再生成を含む最終待ち時間は短くならなかった。日本語などの軸にも未配信回答の0点を含むため、平均値をモデル単体の言語能力の点数とは解釈しない。LM Studio実行中にはモデルのダウンロードや短いハーネステストもあり、バックグラウンド負荷を完全に揃えた速度測定ではない。

## Ollama + Vulkan結果

[匿名比較の全9軸・ケース別理由](results/m917-oll-vulkan-comparison/report.md)。Ollama 0.34.1、Q4_K_M、native API、Thinking OFF、context8192。ロード後のAPIで両モデルの`size_vram > 0`とcontext8192を確認し、ログでも14Bは41/41層、9Bは34/34層のGPU配置を確認した。

| 指標 | Qwen3 14B | Qwen3.5 9B |
|---|---:|---:|
| タスク達成（手動評価） | 11/16 | 4/16 |
| Hard Check通過 | 13/16 | 6/16 |
| 全応答の時間中央値（ロード込み） | 38.64秒 | 34.87秒 |
| 応答時間p95 | 62.24秒 | 73.46秒 |
| 低ロード時間の回答：件数 / 中央値 | 7件 / 14.59秒 | 8件 / 22.95秒 |
| decode速度中央値 | 8.73 token/秒 | 15.06 token/秒 |
| 形式修正を試した回答 | 5/16 | 8/16 |
| 最終形式不正 | 0/16 | 6/16 |

9Bの対14B勝率は28.125%（1勝8敗7分、引分0.5）。問題単位bootstrap 95% CIは8.3～41.7%。現在の配備条件では14Bを基準として維持する。9Bの能力全体や別sampling・Thinking ONまで棄却する結果ではない。

具体例:

- 総和Python: 14Bは末尾欠落を正しく指摘。9Bは既に0を返す空配列について修正を求め、別の問題を指摘した。
- ソートJavaScript: 14Bは引数なし`sort()`の文字列順を指摘。9Bは沈黙して見逃した。
- 未提示の`transform`の計算量: 14Bは断定を避けて回答。9Bは両言語でJSON終端が欠け、最終回答が未配信となった。
- two-pointer: 14Bにも「右を減らすと和が大きくなる」という誤った説明が残る。形式が通ることだけでタスク達成とは扱っていない。
- 正しいPythonソートへの不要な介入、Python階段DPの見逃しは両方に残る。

### 本番APIのsmoke test

[2ケースの比較](results/m917-oll-production-comparison/report.md)。両モデルとも通信は成功し、Thinkingの出力は観測されなかった。14Bは2/2で応答形式・機械判定を通過したが、二分探索の説明が不正確で、タスク全体の達成は1/2。9Bは正しいソートへの不要な介入と二分探索の形式不正で0/2。

本番APIからcontextを指定しない場合、最後にロードされた14Bの割当は4096と実測された。9Bは終了時にはunloadされていたため、終了snapshotからその割当を推測しない。本番APIの結果をcontext8192の主要比較へ合算しない。2ケースのCIは参考値であり、一般的な勝率の証拠とはしない。

## 原因の切り分けと次の実装候補

1. **回答形式の保証を先に比較する。** 9Bでは内容が部分的に正しくてもJSON終端欠落などで未配信となる。response format/schemaなど、backendが対応する構造化出力を評価用adapterで一項目ずつ試し、意味的な誤答率と再生成回数も測る。形式だけ直して正解としない。
2. **直接回答とヒントを分ける。** 戻り値・計算量の明示的な質問には直接答え、修正実装を求めていないときだけ完成コードを抑制する。二分探索の結果を伏せる挙動はモデルサイズだけでは説明できず、現在の指示との相互作用を疑う。
3. **戻り値の契約と画面表示の契約を区別する。** 現system promptには出力配置・printについての指示があり、9Bは戻り値の課題に表示処理を要求した。入力を保った最小prompt変更で、総和・DP・Webの関数戻り値と、実際に画面出力を要求するケースを両方比較する。
4. **14Bにも残るコード推論の誤りを検証する。** two-pointerの和の単調性やDP初期条件の誤答は、必要コードが届いた上でも残った。短い診断prompt、Thinking ON、公式sampling候補を順に比較する。今回だけでモデル固有の能力限界と断定しない。

provider横断の優劣は決めない。現在の`GuidanceDepthPolicy`はOllamaの内容深度をhighへ変換し、LM Studioはlowを維持するため、同じケースでもsystem promptは完全には同一ではない。配布weights、chat template、既定sampling、context、常駐条件も異なる。上の採用判断は同一provider内の比較に限定した。

## 記録と検証

- [主要4構成の再計算可能な集計](results/m917-summary.json): `node eval/summarize-m917.mjs`
- [言語・問題別集計](results/m917-algorithms.json)
- [GPU認識の切り分け](results/m917-backend-diagnostic.json)、[実際のロードsnapshot](results/m917-oll-vulkan-loaded-samples.json)、[GPUログ抜粋](results/m917-vulkan-evidence.json)
- `m917-*-baseline/candidate/`に実際の入力・リクエスト・回答・再生成・token量・モデルmetadataを保存。未指定sampling値は未知のまま保持。
- `review-m917-*.mjs`は匿名packetに対する明示的な手動判定を再シリアライズする。採点を自動推測するスクリプトではない。
- `npm run test:quality-eval`: **19/19成功**。fixtureの実行根拠、9軸Judge、モデル比較の制御ガードを含む。PowerShell起動補助の構文確認も成功。

小規模なアルゴリズム問題の単一試行であり、Web開発・長いファイル・未観測holdoutへの精度保証ではない。新モデルの選択後は新しい問題群で確認する。Qwen3 8Bの過去結果との厳密な改善率は算出していない。
