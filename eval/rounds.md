# Experiment decisions

## Baseline — frozen before tuning

- LM Studio: `results/baseline-lmstudio`。13件、最初の独立sample。形式hard passは12/13だが、Setの挿入順、配列境界など意味上の誤答があり、形式合格は品質保証ではない。
- 長いactive末尾: parsePort定義がPlannerで消え、不足を認める回答。長いadditional末尾: 最新17秒が消え、旧30秒を有効だと推測。入力欠落と幻覚を分けて記録する。
- 現在Champion: production baseline（provider別）。単発実測だけで優劣確定しない。

## Round 1 — pre-registered hypothesis

- 失敗カテゴリ: missing_context。active末尾の情報欠落は送信promptから確定。
- 仮説: lowの2,000文字予算を維持し、先頭+末尾を残すと、後半の定義を参照できる。
- 最小変更: eval専用 `head-tail-v1`。system、sampling、Thinking、context length、出力予算は変更しない。
- Candidate: `configs/r1-head-tail.json`。同じ13 tuning casesを比較。追加文脈の切り詰めは別仮説として残す。
- 採否: 評価待ち。holdoutは候補選定後まで実行しない。

### Round 1 result

- Candidate win rate 0.538; case-bootstrap 95% CI [0.385,0.692]。critical-axis gate不合格。末尾定義の送信は回復したがNumber空文字をNaNと誤答。採用せずBaselineを維持。
- 変更のない他ケースでも回答が変わっており、単発の改善を切り詰め変更の効果とはしない。

## Round 2 — pre-registered hypothesis

- 失敗: incorrect_code_reasoning/hallucination。入力が届いていても言語挙動を誤説明。
- evidence-v1の規則1項目のみをsystem末尾へ追加し、参照と推測を分ける。context/Thinking/sampling/outputはBaselineのまま。
- Candidate: configs/r2-evidence.json。同じtuning 13件。

### Round 2 result

- evidence-v1は不採用。コード境界説明は改善例がある一方、欠落したparsePortの実装を捏造し、旧版メモを最新と取り違えた。ChampionはBaselineのまま。

## Round 3 — pre-registered hypothesis

- 同じ入力でも言語仕様の誤答が続く。Thinkingのみhighにして確認能力を検証する。system/context/sampling/max outputはBaselineと同じ。lowケースの出力枠2048も固定し、枠不足は別失敗として記録する。
- Candidate configs/r3-thinking.json。同じ13 tuning cases。

### Round 3 result

- Win rate 0.346; 95% CI [0.115, 0.577]。median latency 6786 → 27562 ms。不採用。
- 縦横判定と次の学びは改善例があるが、ヒント漏洩・過剰な確認・日本語の退行がある。
- 3ラウンドで明確な改善なし。追加prompt探索は停止。Championはprovider別production baseline。モデル能力の制約が候補だが、欠落contextと未固定samplingも残るため能力だけに帰属しない。
- 残る公式presetとcontext sweepは依頼された特性測定として行い、新たなprompt探索や自動採用には使わない。

## Required reference characterization

- 公式presetは失敗分析4件（境界、比較、ヒント、自動配置）と説明control1件の固定subsetで測定。選定はtuning内、holdout未使用。full-setの改善や個別sampling値の因果効果は主張しない。
- LM Studio公式Non-Thinking測定はAPI到達不能で5件失敗。既存結果を残し、利用可能なOllamaへ切り替える。サーバー停止原因は未確認、設定変更や自動再起動はしていない。
- native Ollama未変更controlsの13件比較はwin rate0.538、CI[0.385,0.692]で明確な品質差なし。transport移行だけでは品質改善を確認できない。

### Restart and official reference results

- ユーザーがLM Studioを再起動後、公式Non-Thinkingを再実行。5/5通信成功、hard4/5。同じ5件のBaseline比較win rate0.600、CI[0.500,0.800]、instruction-following gate不合格。不採用。
- 公式Thinkingは4/5通信成功、hint-onlyでHTTP500。サーバーログにEngine protocol predict request failed: fetch failed。単独再試行は成功したが元の失敗を置換・隠蔽しない。
- 公式Thinkingの有効回答でもSet順序の誤りが残り、auto-layoutは内容を認識してもfocus=explainで不合格。採用しない。通信失敗を除いたsemanticOnlyをsummary.jsonに別保存。
- Ollama公式Non-Thinkingは5/5通信成功、hard4/5。既存native設定比win rate0.400、CI[0.200,0.500]。改善なし。
- context sweep18観測では実割当4K/8K/16Kを確認。観測Pareto frontierは4Kと8K、16Kは8Kに劣位。ただし3診断ケース各2回のみ、cacheとcold loadがあり一般的最適値を主張しない。

## Round 4 — user clarification and context repair

Rubric v2 permits naming await as a hint, but prohibits concrete replacement code. Historical v1 scores remain unchanged. Fresh r4-baseline-v2 freezes this dataset before production edits. Hypothesis: remove redundant 2,000-character planner cap; only when the actual prompt budget is exhausted, preserve named middle evidence and both edges with omission markers. No sampling, Thinking, backend context or output changes. Deterministic evidence retention tests plus 13 tuning cases; no holdout-driven tuning.

## Round 5 — hint boundary only

User-authorized product policy: permit concepts/API names/keywords and direct factual answers, prohibit completed replacement code unless explicitly requested. Remove the conflicting blanket ban on declarative suggestions. Compare against r4-context-v2 on all 13 tuning cases; no language-reference injection yet.

## Round 6 — bounded language reference

Hypothesis: relevant standard-library facts supplied as a small versioned reference reduce errors that generic instructions did not fix. Only local providers receive the notes; selection uses language ID and API names, never case IDs or expected outputs. Covers numeric conversion, ordered collections, array iteration/bounds/reduce, async/fetch including negative applicability caveats. Compare r5-hint-v3 vs r6-language-v4, same 13 tuning cases. Language notes are unit-checked with independent examples. The topics were motivated by tuning failures, so do not claim general reasoning improvement without independent confirmation.

## Round 7 — clarify reference terminology only

R6 corrected Number empty-string but Set answered contradictorily (order not retained / insertion order), and async facts were misapplied to Promise.json. Keep R6 unadopted. R7 changes only the ordered-collection reference wording: define insertion order in positive terms and distinguish updating from delete/reinsert. Other note topics and generation controls unchanged. This is a final bounded reference wording experiment, not evidence of general model repair.

## Round 8 — remove reference topics with observed misuse

R7 correctly explains Set insertion order and Number empty-string, but broad async/array notes still cause incorrect application and do not prevent completed fixes. Preserve rejected outputs. R8 removes only array and async reference cards; numeric conversion and ordered collections remain, other prompts/settings unchanged. Validate retained benefits and no new hint misapplication.

## Round 9 — enforce the clarified hint boundary

Only replace the main hint policy with explicit Japanese wording: naming a keyword/API is permitted; a changed expression/call/argument must not be disguised as a checking method. The user requested this boundary. Final reference scope is numeric conversion plus ordered collections; no further parameter search. Compare against R8, then freeze before transfer/holdout. Four separately written reference-transfer cases cover whitespace/partial numeric parsing, Set delete/reinsert, Map update order and local Number shadowing. They are supplemental tuning diagnostics, not a replacement for the six frozen holdout cases. Run two repeats with reference off/on, keeping all other controls identical.

## Final selection — stop broad reference exploration

Transfer reference-on vs off: numeric conversion correct twice only with notes; Set reinsert still wrong twice, while shadowed Number acquired an extra space. Broad reference variants are rejected, not promoted. Select only numeric reference plus a conservative visible-binding suppression, retain deterministic context repair and the user-authorized hint policy. No sampling/backend changes. Freeze this source for final tuning and the six held-out cases; no tuning to holdout answers. Set/Map reasoning, async hints and uncertainty remain unresolved capability/prompt-following issues.

### Final minimization before holdout

The broadened hint-generation policies in R5/R9 produced concrete fixes and irrelevant hints; do not promote that prompt rewrite. Restore the original generation policy and keep rubric v2 (keyword suggestions are acceptable) as the correction to the evaluator. Final production candidate is context preservation plus numeric reference only. Re-run tuning before the untouched holdout. This is removal of failed components, not continued sampling/prompt search. Set errors remain explicitly unresolved.

## 2026-09-16 decision summary

Champion scope: deterministic context repair plus numeric reference only. No statistically established overall quality champion. Generic hint-generation rewrites were reverted; rubric v2 remains.

| Candidate | Win rate | Median ms | Decision | Next hypothesis |
|---|---:|---:|---|---|
| r4-context-v2 | 57.7% | 6844 | 情報欠落修正を採用。全般的な品質優越は未確認。 | 数値変換の仕様を参照しても誤るか。 |
| r5-hint-v3 | 42.3% | 7658 | 生成指示変更は棄却。評価基準v2のみ保持。 | 指示追加でなく標準仕様の参照を検証。 |
| r6-language-v4 | 53.8% | 7576 | 広い仕様メモは棄却。Numberは改善、Set/Promiseの誤適用あり。 | 挿入順の用語定義だけで矛盾を減らせるか。 |
| r7-set-reference | 50.0% | 8633 | Set説明の改善例はあるが全体では棄却。 | 副作用のある配列・非同期メモを外す。 |
| r8-focused-reference | 46.2% | 7888 | 棄却。新しい形式不正とSetの矛盾が残る。 | ユーザーのヒント境界を明確化して確認し探索終了。 |
| r9-keyword-hints | 53.8% | 6299 | 日本語指示の変更は棄却。出力変動と誤ヒントが残る。 | 別入力で参照の効果と誤適用を確認。 |
| reference-transfer-production | 43.8% | 8437 | 広い参照を棄却。数値変換の2反復のみ正答改善。 | 数値変換だけを残し、独自定義では参照しない。 |
| final-numeric-context | 42.3% | 7129 | 数値補強は保持候補。生成指示変更を含む全体は棄却。 | 失敗した生成指示変更を元に戻して確認。 |
| champion-context-numeric | 53.8% | 7291 | 取得済み情報の欠落修正と数値変換の補強だけを保持。総合優越未認定。 | holdoutの失敗を報告し、以後は新holdout/独立Judgeと別能力検証が必要。 |

Each comparison report linked by results/followup-decisions.json records all nine axis deltas, including regressions, per-case reasons and the baseline. Holdout: 6/6 hard checks pass, 3/6 meet the main semantic requirement. No tuning after reviewing holdout. See FOLLOWUP.md for the final scope and remaining failures.

## Small/medium rounds — new dataset, three repeats (2026-09-16)

User priority: precision on small/medium code; large files/projects are outside this tuning scope. New 10-case tuning and 6-case holdout are independent of the old holdout. Preregistration, frozen selection, speed caveats and final confirmation: [SMALL_MEDIUM.md](SMALL_MEDIUM.md).

| Change | Win/tie/loss | Tie-adjusted win rate | Decision | Next hypothesis |
|---|---|---|---|---|
| bounded whole active file vs viewport (LM Studio) | 15/11/4 | 68.3% | Keep limited information-loss fix; latency gate fails (+35.4%), so no unconditional overall champion. | With evidence present, does lower temperature reduce remaining errors? |
| temperature 0.2 only | 8/16/6 | 53.3% | Reject: instruction-following -0.267; array errors persist. | Separate Ollama transport and allocation effects. |
| native Ollama at same 4K | 1/6/2 | 44.4% | Reject transport migration. | Does 8K change processed input or answer quality? |
| native 4K→8K | 2/6/1 | 55.6% | Reject global/default increase: same processed input, short-code errors persist. | Stop settings search; confirm bounded collection on new holdout. |

All nine axes and all rejected outputs are retained. Changes on the seven LM cases with identical wire input are sampling variation, not evidence for collection's causal effect. Source frozen in `results/sm-freeze.json` before holdout; no prompt/source tuning after inspecting holdout.

## Algorithm round — Python and JavaScript (2026-09-16)

Scope: original short coding-test functions, 6 tuning problem groups / 4 separate holdout groups, 16 cases per split. Fixtures verified against independent finite-domain oracles. See [ALGORITHM_RESULTS.md](ALGORITHM_RESULTS.md) for settings, all axes, examples, latency and limits.

| Candidate | Baseline | Outcome | Champion / next hypothesis |
|---|---|---|---|
| Problem/constraints/examples headings only, LM Studio | Current production, 48 observations | 12 wins / 27 ties / 9 losses; problem-balanced 52.3%, 95% CI 41.7–66.2%. Correctness unchanged; instruction +0.04, actionability -0.06, conciseness -0.08. Median 8.48→7.93s; block order not counterbalanced. Rejected. | Keep current production. Test reasoning/automatic intervention with fresh problem groups, not more heading variations. |

Current baselines: LM 30/48 and Ollama 33/48 meet the primary semantic task; both pass 48/48 hard checks. Separate holdout confirmation: 6/16 meet the task on each provider. Unnecessary automatic advice on correct code: LM 4/6, Ollama 3/6; silence on defective code: 2/6 each. No tuning after confirmation. No new production changes or backend/global settings changes.

The initial LM hard-check focus metadata was corrected without new generation; `alg-lm-baseline-v2` is a derived recheck, not another 48 samples. Raw evidence remains. Total new observations: 176. Holdout has now been observed and must not be reused as unseen selection evidence in a later round.
