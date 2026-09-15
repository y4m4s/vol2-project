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
