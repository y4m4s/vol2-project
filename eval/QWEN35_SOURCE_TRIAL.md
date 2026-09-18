# Qwen3.5 9B: production source experiment

## 結論（2026-09-17）

**Qwen3.5 9Bを対象に、本番の`src`を変更して48件を実測した。2案とも採用条件を満たさず、本体と本体のテストは評価前へ戻した。Championは`2ef6bea`の実装を維持する。精度改善を達成したとは報告しない。**

全体の平均だけを見ると改善に見える案があったが、送信したリクエストが同一のケースでも回答が変わっていた。変更の影響を受けるケースと、それ以外を分けたことが今回の重要な確認点。

| 試験 | 変更した本番処理 | 変更対象だけのA/B結果 | タスク達成 | 対象ケースの待ち時間中央値 | 判定 |
|---|---|---|---|---|---|
| R1 | ローカル手動相談の事実回答とヒント制約を区別 | 2勝・2敗・2分 | 2/6 → 3/6 | 15.84 → 23.55秒 | 棄却 |
| R2 | ローカル自動助言で戻り値・表示・状態変更を区別 | 3勝・3敗・4分 | 5/10 → 5/10 | 12.80 → 11.96秒 | 棄却 |

各試験は同じ既存16ケースを使用し、PythonとJavaScriptを評価した。修正対象外のケースも含めた全体はBaseline 7/16、R1 10/16、R2 8/16だったが、この全体差を修正効果として扱わない。A/Bはモデル名・設定名を除き表示順をランダム化した。同一エージェントによる評価で、独立Judgeではない。各ケース1回で、推論順はBaseline→R1→R2。統計的確証はない。

### 具体的な改善と退行

- **R1:** 二分探索の戻り値を求める2件で、回答を避ける挙動から`結果: 1`を出す挙動に変化。ただしPythonでは境界の説明が誤っており、数値だけのHard Check通過を正解とは数えない。Pythonのtwo-pointer説明は悪化し、JavaScriptのtwo-pointerでは120秒のタイムアウトが新たに発生した。
- **R2:** 正しい`sorted(a)`と数値比較付き`.sort()`への誤指摘が沈黙へ改善。一方、誤った比較関数なしの`.sort()`にも沈黙し、バグを見逃した。Pythonの`sorted(a, key=str)`には意味の通る説明を生成したが、文字列内の引用符をエスケープせず、再生成後もJSON不正で回答を届けられなかった。
- **R2のstairs:** 不要なprint要求は消えたが、実在しない`ways[-1]`参照を原因として挙げた。JavaScriptでも`n=2`なのに`ways[3]`を返すと誤診した。説明対象を直してもコード追跡の誤りが残る。
- R1の全体勝率は65.625%（問題単位bootstrap 95% CI 35.42–85.42%）、R2は50%（43.75–56.25%）。同点は0.5勝。改善の確証はなく、新規Hard Check失敗もある。

### 評価軸の変化（変更対象ケースのみ、0–4点）

| 軸 | R1 差分 | R2 差分 |
|---|---:|---:|
| correctness | -0.50 | -0.40 |
| groundedness | -0.50 | -0.20 |
| context utilization | -0.67 | -0.40 |
| hallucination（高いほど捏造が少ない） | -0.50 | -0.10 |
| instruction following | +0.17 | +0.20 |
| pedagogical usefulness | -0.67 | -0.10 |
| actionability | -0.50 | +0.10 |
| conciseness | -0.67 | 0.00 |
| Japanese quality | -1.00 | -0.30 |

回答未配信は配信込みの評価で0点のため、これらは純粋な文章能力の差ではない。R1のタイムアウトはinfrastructure、R2の引用符不正はinvalid_formatとして区別している。各軸の理由は比較ディレクトリの`judgments.json`、ケース別の変更有無は`q35-src-summary.json` / `q35-contract-summary.json`に保存。

### 設定・速度・メモリ

- LM Studio、Qwen3.5 9B Q4_K_Mのみで推論。Thinking OFF、実割当context 8192、parallel 4、最大出力2048。14Bと8Bは使用せず、Ollama比較も今回の範囲外。
- temperature/top_p/top_k/min_p/penaltyは現行製品どおりAPI未指定。継承値は不明として記録し、0とみなさない。このため別セッションでの厳密な再現には限界があり、次のsampling実験では明示固定が必要。
- 全16件の応答時間中央値/p95はBaseline 14.43/44.91秒、R1 12.08/120.02秒、R2 12.52/29.95秒。ただし全体中央値の改善は修正効果の根拠にしない。decode速度中央値は順に14.56、12.49、15.32 tokens/sec。再生成を含めた待ち時間とdecode速度は別指標。
- Baseline推論中の1時点で、llama-serverのワーキングセットは約12.24 GiB、private bytesは約7.65 GiB。PC全体は約31.63 GiB中、空き約6.46 GiB。全体使用量には他アプリも含まれ、共有・GPUメモリとの合算やピーク値の推定はしない。
- メモリを減らす変更は今回は未実施。グローバル設定・モデルファイル・ロード済みモデルの構成は変更していない。テストのため停止中だったローカルAPIサーバーを起動した。

### 残したもの・次の検証

本体の有効な差分はない。棄却した本番ソースとテストの差分は`q35-src-factual.patch`と`q35-src-contract.patch`に残し、再現可能にした。結果・九軸評価・棄却理由を保存し、実験一覧にも登録した。

既存holdoutは過去に評価済みだったため、新たな確認用8件を`local-contract-holdout.json`に作成・凍結した。Python/JS/TSの小さなWeb用途と表示・状態変更を含む。**2案目がtuningで落ちたため、これらへのモデル推論は未実行。改善の証拠として数えない。** `q35-contract-freeze.json`は棄却したR2候補と未実行ケースを記録したもの。次の候補を確認する際には候補ソースを改めて凍結する。

次は以下を独立した変更として検証する。今回の2案だけでモデル能力の限界とは断定しない。

1. **出力形式の保証:** JSON Schemaによる生成制約をローカルClientへ組み込み、再生成率・未配信率・待ち時間を比較する。ただしThinking制御を維持できるAPI経路の確認が先。[LM Studio native chat](https://lmstudio.ai/docs/developer/rest/chat)の公開仕様にはstructured outputフィールドを確認できず、[structured outputの説明](https://lmstudio.ai/docs/developer/openai-compat/structured-output)はOpenAI互換経路を対象としている。
2. **標準APIの事実補助:** `LanguageReference.ts`の既存方式を利用し、必要なAPIだけに短い公式仕様の補助を渡す。入力コードの束縛・型・比較関数を無視して適用しない。単なる指示追加より、誤答の原因となった知識を限定的に補えるかを比較する。
3. **メモリの独立比較:** 同じ9B・同じcontextでparallel 4→1の一時ロード設定を比較し、その後必要ならcontext 8192→4096を別実験にする。現時点では節約量・品質への影響を実測していない。製品からグローバル設定を上書きする実装にはしない。

最終確認: 本体の既存テスト334件と評価基盤20件が成功。候補を有効にした時点でも、それぞれ336件が成功した。しかし単体テスト通過と回答品質の改善は別であり、採用理由にはしていない。

## Plan recorded before candidate inference

- Target: LM Studio Qwen3.5 9B Q4_K_M, native production client, Thinking off, loaded context 8192, parallel 4. Do not load 14B. Do not change model files or persistent settings.
- Control: commit `2ef6bea`, current production prompt, freshly generated answers. Same fixed 16 Python/JavaScript cases from `results/m917-selection.json`. These are previously observed tuning cases, not unseen holdout.
- Hypothesis: the low-depth prohibition on final answers, combined with the prohibition on declarative language, incorrectly suppresses direct factual answers about existing code. Distinguish a factual explanation from providing a completed fix.
- Candidate: change `src/services/PromptBuilder.ts` for local manual questions only, excluding slash commands. Keep hint-only restrictions. Do not change automatic guidance, cloud prompts, context collection, Thinking, sampling, output limits, transport or parsing.
- Sequential baseline then candidate, independently shuffled case order, one sample/case. No inference concurrency. This design cannot distinguish every sampling/session-order effect; identical automatic requests serve as negative controls.
- Evaluate hard checks before anonymous pairwise judgment. Preserve all nine axes, reasons, raw responses, retries, actual prompt tokens and timings. Compare serialized request hashes to identify unaffected cases.
- Do not promote a global Champion from this exploratory screen. Retain/reject the source candidate according to the existing rubric gates; any follow-up confirmation must be reported separately. Preserve rejected patches and results.
- JSON failures are a separate hypothesis. Do not combine transport/schema changes with this change: LM Studio's native chat endpoint documents reasoning controls but does not document a structured-output field. Do not silently drop Thinking control to switch endpoints.

## Reproduction

Baseline uses the compiled source at `2ef6bea`; candidate uses the recorded source patch. Compile with `npm run compile:ext` before each run. Never overwrite existing result directories.

```powershell
$caseIds = (Get-Content eval/results/m917-selection.json | ConvertFrom-Json).ids -join ','
node eval/run.mjs --config eval/configs/m917-lm-q35-9b.json --suite algorithms-v2 --ids $caseIds --out eval/results/q35-src-baseline --repeat 1
# Apply candidate source patch and compile before the next command.
node eval/run.mjs --config eval/configs/q35-src-factual.json --suite algorithms-v2 --ids $caseIds --out eval/results/q35-src-factual --repeat 1
node eval/compare.mjs --baseline eval/results/q35-src-baseline --candidate eval/results/q35-src-factual --out eval/results/q35-src-comparison
```

Memory snapshots are in `results/q35-src-memory.json` and `results/q35-src-system-memory.json`. They are single observations during baseline inference, not peaks, not exclusive allocations, and not a before/after memory comparison. Working sets can include shared/mapped memory; private bytes and GPU memory must not be summed blindly. All applications contribute to system memory usage.

## Round 1 decision

Reject `q35-src-factual`; keep production Champion at `2ef6bea`. Patch preserved in `q35-src-factual.patch` (`git apply --ignore-space-change` supports Windows line endings).

- Changed requests only (6 manual cases): task success 2/6 -> 3/6; 2 wins, 2 losses, 2 ties. Median latency 15.84 -> 23.55 s (+49%); new 120 s timeout on JS two-pointer case.
- Explicit scalar answers: missing in both languages before, present in both after. Python still describes the left boundary incorrectly; JS has imprecise wording. Do not equate passing scalar hard checks with correct full explanations.
- Whole-set win rate 65.625%, problem-bootstrap CI 35.42–85.42%; adoption gates fail. Five wins occurred on identical automatic requests, so attributing the total gain to the source change would be incorrect.
- Same-agent review and a single sample do not establish the cause of the timeout or a model capability ceiling. No holdout used.

## Round 2 plan (before inference)

Reset Round 1 source changes. Test a separate production change in `PromptBuilder.ts` / `ModelProfile.ts`: for local automatic guidance with supplied requirements, distinguish the required observable result (return value, display output, state change). Do not invent a print/call requirement for a function-return task. Retain the requirement for actual display when explicitly requested.

Keep manual/cloud/no-additional-context prompts unchanged. Use an explicit profile flag separate from standard-library reference notes. Same fixed 16 cases, same baseline, model/settings unchanged; one fresh candidate sample/case. Check identical manual requests as negative controls. Primary error: invented display requirement for Python stairs. Also inspect missed bugs and new unnecessary interventions. Do not adopt just because one known case improves.

```powershell
node eval/run.mjs --config eval/configs/q35-src-contract.json --suite algorithms-v2 --ids $caseIds --out eval/results/q35-src-contract --repeat 1
node eval/compare.mjs --baseline eval/results/q35-src-baseline --candidate eval/results/q35-src-contract --out eval/results/q35-contract-comparison
```
