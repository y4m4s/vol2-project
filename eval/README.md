# NaviCom local quality loop

現在の実推論対象は **Qwen3 14B / Qwen3.5 9B**。Qwen3 8Bの設定・結果は履歴用で、新しいテストには使用しない。新モデルとWindows GPUの評価手順: [MODEL_REFRESH_20260917.md](MODEL_REFRESH_20260917.md)。

Thinkingと不要な自動介入の検証: [THINKING_INTERVENTION_RESULTS.md](THINKING_INTERVENTION_RESULTS.md)。160回答を比較し、速度・見逃し・新holdoutの結果から今回の候補は本番未採用。再現手順と事前条件: [FOLLOWUP_THINKING_PLAN.md](FOLLOWUP_THINKING_PLAN.md)。

アルゴリズム問題の新しい評価設計: [ALGORITHMS.md](ALGORITHMS.md)。結果: [ALGORITHM_RESULTS.md](ALGORITHM_RESULTS.md)。PythonとJavaScriptの同一問題を評価し、fixtureの実行結果で参照情報を検証する。

最新の小〜中規模向け検証: [SMALL_MEDIUM.md](SMALL_MEDIUM.md)。採用範囲と速度の代償、未解決の誤答を分けて記録している。

調査: [AUDIT.md](AUDIT.md)。判断履歴: [rounds.md](rounds.md)。評価基準: [rubric.md](rubric.md)。生成APIはlocalhostのみ。グローバル設定・モデルファイルを変更しない。推論時にモデルがロードされ、request-local context変更で再ロードされることはある。Judge APIは明示実行時のみ利用する。

## Run

```powershell
npm run compile:ext
node --test eval/harness.test.mjs
node eval/run.mjs --config eval/configs/m917-lm-q3-14b.json --out eval/results/my-baseline --repeat 3
node eval/run.mjs --config eval/configs/m917-lm-q35-9b.json --out eval/results/my-candidate --repeat 3
node eval/compare.mjs --baseline eval/results/my-baseline --candidate eval/results/my-candidate --out eval/results/my-comparison
```

Run directories must be new; existing evidence is never overwritten by a new inference run. Each observation checkpoints immediately, including errors. `--dry` freezes prompts without generation. `--filter` supports a diagnostic subset; cannot compare against a different subset. Case order randomized; inference serial to avoid contention. For stronger latency evidence, alternate baseline/candidate runs on a quiet machine and use at least 3 repeats. Initial single samples are screening only.

## Judge

Give only `blind.json` to a reviewer. **Do not give `key.private.json`, run names or latency** to the judge. Each pair randomizes A/B. `node eval/compare.mjs --reverse-of ORIGINAL_COMPARISON --out NEW_DIRECTORY` produces an exact reversal for a second judge pass. Fill judgments.template.json, keeping packet/pair hashes. The hash detects accidental editing, not malicious judges.

```powershell
node eval/judge.mjs --packet eval/results/my-comparison/blind.json --out eval/results/my-comparison/judgments.json --endpoint https://YOUR-HOST/v1/chat/completions --model YOUR-JUDGE
node eval/report.mjs --comparison eval/results/my-comparison --judgments eval/results/my-comparison/judgments.json
```

API credential is read only from `NAVICOM_JUDGE_API_KEY` and is never saved. A custom ES module `export async function judge({rubric,schema,pair})` can be passed with `--adapter ABSOLUTE_PATH`; it returns verdict/reason and A/B scores/reasons/failures. Qwen3 8B cannot be the only judge. Manual Codex reviews must disclose shared experiment context. Imported Copilot/OrcaRouter answers must record model, input snapshots, limits, finish status and actual latency (missing metrics stay null); evaluate them with this same packet schema, not as gold answers. No credentials are scraped from VS Code.

## Freeze / adopt

`cases/tuning.json` contains reused historical synthetic failures and new representative tasks. `cases/holdout.json` is a separate, prewritten set; do not inspect holdout responses during tuning. Run once after selection with `--split holdout --confirm-holdout`. Dataset and actual built-code hashes are recorded per run. A prompt snapshot and request JSON permit exact replay even if source later changes, although stochastic hardware/runtime outputs need not match byte-for-byte.

Candidate controls stay inside the evaluation harness until evidence justifies production changes. Rejected candidates, raw outputs, invalid envelopes and repair attempts are retained. No automatic adoption based on one aggregate score. Use rubric gates, axes, case reasons, repeats, independent judges and latency tradeoffs. Freeze a new holdout if adapting after a holdout failure.

## Observability and limits

- `prepared`: actual planner-filtered context, full prompt, 3-char token estimate explicitly labelled approximate, evidence-presence probe.
- `calls`: actual wire JSON, per-attempt timing, backend usage/stats, reasoning character count (not private reasoning text).
- `attempts`: raw final answer, normalized delivered answer, hard checks before semantic judgment. Format repair exactly once; no semantic retry.
- `environment-before/after`: API version/model/quantization/digest/template and loaded context when exposed. Unknown sampling fields remain unknown; absence is not zero.
- Tokens reported by the backend are **processed prompt tokens**, not proof that the complete submitted prompt survived truncation. Compare the identical wire prompt at larger allocation; an 8K profile is not an 8K actual allocation. No tokenizer-based preflight claim is made.
- LM Studio provides decode tokens/sec, TTFT. Native Ollama provides eval_count/eval_duration and load duration. Production Ollama OpenAI path lacks decode duration: never substitute total latency and call it decode throughput.
- GGUF metadata inspector reads only selected header metadata; it never changes weights/templates.
- Saved model metadata replaces machine-specific directories with `<MODEL_DIRECTORY>` (GGUF file) or `<OLLAMA_MODELS>` (Ollama blob). Filenames, blob digests, templates and template hashes are preserved. These are descriptive placeholders: substitute your actual directory before using a saved `FROM` line. Evaluation prompts, answers and historical provenance hashes are not rewritten.
- Fixtures start at the collector output boundary. VS Code cancellation, UI, live collector selection, usage limits and trust/exclusion configuration require existing integration tests. The synthetic planner uses empty excluded globs because all fixtures are non-sensitive.

Official Qwen presets are in `configs/official-*.json`; they are **candidates**, not adopted defaults. Ollama top_k/min_p/num_ctx require the eval-only native API adapter. First compare native transport with unchanged controls, then the preset, then context sweep. Do not compare different providers as if weight/template/hardware were controlled.

## Diagnostic tools

```powershell
node eval/context-sweep.mjs --out eval/results/new-context-sweep --repeat 2
node eval/context-report.mjs eval/results/new-context-sweep YOUR_MANUAL_JUDGMENTS.json
node eval/registry.mjs
```

`--ids ID,ID` selects an explicit, validated tuning subset. `subset.mjs SOURCE NEW_DIRECTORY ID,ID` creates a labelled view of saved observations, never an independent run. Keep server failures and later retries separate. Reports contain end-to-end delivery scores and `semanticOnly` scores excluding transport failures. Context diagnostics use a single forward pass without format repair to keep the wire prompt identical across allocations. They do not replace full end-to-end evaluation.

The current completed work is summarized in [REPORT.md](REPORT.md). Experiment settings and metrics are indexed in [results/experiments.json](results/experiments.json) and [results/experiments.tsv](results/experiments.tsv).

## 2026-09-15 follow-up

Rubric v2 permits concept/API/keyword hints, including suggesting `await`; concrete replacement expressions remain disallowed when code was not requested. Historical v1 packets are preserved and must not be scored as if they used v2.

`--cases-file eval/cases/reference-transfer.json` selects supplemental tuning diagnostics; it cannot override the frozen holdout. `languageReference: "off"` is an eval-only ablation control. Production settings and prompt behavior are identified by source hashes and policy/reference revisions; `production` means the checked-out implementation, not the original September 11 implementation. Historical wire requests in `responses.json` are the frozen replay source. Do not infer that a rejected run can be regenerated from a later checkout using its config alone.

Context preservation covers the collected excerpt, not the entire repository. Visible/selected text is still bounded by ContextCollector; related files still follow depth/exclusion policies. Backend context allocation is unchanged by these fixes.

## Small/medium suite (2026-09-16)

`--suite small-medium` selects the new, separately frozen tuning/holdout files. It cannot be combined with `--cases-file`; holdout still requires `--confirm-holdout`. Each editor fixture records both the complete document and the viewport. `collectorContext: viewport` replays the old capture boundary; `bounded-file` calls the same bounded full-file helper used by ContextCollector. This is a simulated editor snapshot: live VS Code/provider behavior is covered only by the documented integration limits, not inferred from these fixtures.

```powershell
node eval/run.mjs --suite small-medium --config eval/configs/sm-lm-file.json --repeat 3 --out eval/results/new-small-medium-run
node eval/small-medium-report.mjs
```

The report command recomputes metrics for the named saved small/medium experiments; it does not re-run models or choose settings. Individual scores/reasons remain in comparison `judgments.json` and holdout `assessment.json`. `sm-freeze.json` anchors the final source and unseen holdout before confirmation.

Current collection retains an entire active file up to 8,000 characters when nothing is selected, **only for LM Studio and Ollama**. Copilot, OrcaRouter and unspecified providers retain the previous viewport/fallback policy. Explicit selection and larger-file viewport limits are preserved. Request previews use the same provider policy and invalidate their cache on provider changes. This repairs off-screen definitions in small files; it does not retrieve missing cross-file dependencies, guarantee every middle-sized project is understood, or make the three-character token estimate exact. Ollama's app-side budget and loaded context can still differ; no new backend default is adopted from the small/medium sweep.
