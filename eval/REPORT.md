# NaviCom ローカルLLM評価レポート

## 結論

**Championは現行実装のまま維持する。** 評価基盤を構築し、3ラウンドを実測・9軸評価・匿名A/B比較したが、採用基準を満たす改善はなかった。変更は評価用コードとnpm scriptsに限定し、本番のprompt・provider設定を変更していない。

評価可能な状態になったことと、回答品質が改善したことを区別する。今回達成したのは再現可能な評価系、実際の失敗の特定、改善しない変更の棄却である。

## 再起動後のLM Studio再テスト

- Qwen3 8B / Q4_K_M、実ロードcontext 8,192を確認。
- 公式Non-Thinking（temperature .7 / top_p .8 / top_k 20 / min_p 0）: **5/5通信成功、hard check 4/5**。配列境界説明の正答例は得たが、Setの挿入順の誤り、ヒントで答えを漏らす挙動、縦横の見逃しが残る。
- 公式Thinking（.6 / .95 / 20 / 0）: **4/5通信成功**。1件はHTTP 500。ログの原因表記は `Engine protocol predict request failed: fetch failed`。その1件の同条件再試行は成功した。最初の失敗を成功に置き換えて集計していない。
- Thinkingの縦横ケースは配置の違いを説明できたが、期待する`focus=continue`に対して`explain`を返したためhard checkは不合格。
- 再試行結果: [Non-Thinking](results/official-lm-none-comparison/report.md)、[Thinking](results/official-lm-thinking-comparison/report.md)、[単独再試行の評価](results/official-thinking-lmstudio-hint-retry/assessment.json)。停止中の失敗5件も別ディレクトリに保存。

## 評価方法と信頼性

- tuning 13件、holdout 6件を分離。既存の課題達成・配置判定の失敗ケースをtuningへ採用し、説明、境界バグ、ヒント、次の学び、比較、追加文脈、関連ファイル、履歴不足、長文を追加。
- 本番のRequestPlanner、PromptBuilder、provider clients、validationと1回のformat repairを利用。入力はContextCollector出力相当の合成snapshotで、実際のVS Code viewport抽出そのものは対象外。
- correctness / groundedness / context utilization / hallucination / instruction following / pedagogical usefulness / actionability / conciseness / Japanese qualityを0–4で採点。hallucinationは高いほど捏造が少ない。
- Hard Checkを先に記録し、形式合格でも意味上の誤答をJudgeが検出する。raw回答とユーザーに届く回答を両方保存。
- A/Bにはprovider/configを渡さず表示順をランダム化。9軸と理由を各回答に保存。同一タスク・同一回答は既存の手動採点を再利用し、不必要なJudgeの揺れを避けた。
- **Codexが設計とJudgeを兼任している。** 事前にBaseline回答も見ているため完全なidentity blindingや独立評価ではない。外部Judge未設定。交換可能adapterと順序反転packet作成機能は実装済みだが、独立Judgeによる検証は未実施。
- 3ラウンドは各ケース1 sampleのscreening。case単位bootstrap 95% CIを示すが、samplingの揺らぎを十分に推定した試験ではない。context測定のみ各設定・各ケース2回。各モデルやproviderが本質的に劣るとの一般化はしない。
- 明確な採用候補が残らなかったため、holdout回答は生成していない。holdoutを調整用に消費せず保持した。

## 3ラウンドの結果

勝率は同等を0.5として計算。通常の勝ち数/負け数、全9軸、各ケースの根拠はリンク先にある。

| 候補 | 変更 | A/B勝率・95% CI | 所要時間中央値 | 判断 |
|---|---|---|---:|---|
| Baseline LM Studio | 現行経路 | 比較の基準 | 6.79秒 | 維持 |
| [R1](results/r1-comparison/report.md) | lowの2,000文字を先頭＋末尾保持へ | 53.8% [38.5, 69.2] | 6.63秒 | 不採用 |
| [R2](results/r2-comparison/report.md) | 挙動確認・不足時に推測しない規則を1項目追加 | 46.2% [30.8, 61.5] | 6.48秒 | 不採用 |
| [R3](results/r3-comparison/report.md) | ThinkingのみON | 34.6% [11.5, 57.7] | 27.56秒 | 不採用 |

### 何がどれくらい変わったか

- **R1 / long-active-tail**: 必要な関数定義が送信されない状態から、送信される状態へ改善。ただし回答は`Number('')`を`NaN`と誤説明した。正しくは0であり、Nodeで参照事実を確認済み。入力保持の改善を回答品質の改善と混同しない。全体のcontext utilizationは+0.23だがinstruction followingは−0.38。
- **R2 / bug-boundary**: 配列範囲外とundefined加算の説明が正しくなった例がある。一方、long-active-tailでは入力にない型や返却値を創作。groundednessは−0.15、instruction followingは−0.54。規則を追加するだけでは安定しない。
- **R3 / auto-layout**: 沈黙から縦横の不一致を説明する回答へ変化。correctnessは全体+0.46、context utilizationは+0.62。ただし解決方法を直接述べるなどinstruction followingは−0.46、concisenessは−0.23。中央値は約4.1倍に増加した。
- 他のケースで同じpromptから異なる回答が出ている。特にR1の変更対象外ケースの改善を、切り詰め変更の因果効果とは扱わない。

3回続けて明確な改善が得られなかったため、追加prompt探索は停止した。公式presetとcontextは依頼された特性測定として別に実施し、追加の最適化ラウンドや自動採用にはしていない。

## Providerと公式推奨値

| 比較 | 結果 | 解釈 |
|---|---|---|
| [現行LM Studio vs Ollama](results/provider-comparison/report.md) | Ollama勝率57.7%、CI[42.3,73.1] | 明確な優劣なし。depth、API、template、重みが統制されていない |
| [Ollama OpenAI互換 vs native](results/native-comparison/report.md) | native勝率53.8%、CI[38.5,69.2] | transport移行だけの品質改善は確認できない |
| [Ollama公式Non-Thinking](results/official-ollama-comparison/report.md) | 5件、勝率40.0% | 改善なし |
| [LM Studio公式Non-Thinking](results/official-lm-none-comparison/report.md) | 5件、勝率60.0%、CI[50.0,80.0] | 小標本で指示遵守の退行あり、不採用 |
| [LM Studio公式Thinking](results/official-lm-thinking-comparison/report.md) | 5件中1件は通信失敗 | 通信失敗除外のsemanticOnlyも保存。採用根拠なし |

公式preset用5件はtuningの既知失敗4件＋説明control1件。全用途での性能を代表する追加試験ではない。preset全体の比較であり個々のtemperature等の因果効果は未分離。

Ollamaのmodel parametersはtemperature=.6、top_p=.95、top_k=20、repeat_penalty=1。Non-Thinkingでもこの値を継承していた。LM Studioの未指定sampling実効値はAPIから確定できずunknownとして保存した。min_pの未指定を0と決めつけていない。公式値は[Qwen3-8B model card](https://huggingface.co/Qwen/Qwen3-8B)で確認した。

## Context lengthと速度

Ollamaの実割当は初期4,096。NaviComの想定8,000 token予算とは同期していなかった。`/api/ps`で各request-local設定の実割当4K/8K/16Kを確認。

| 実割当 | Hard pass | 所要時間中央値 | load 1秒未満の中央値 | decode tokens/sec中央値 |
|---:|---:|---:|---:|---:|
| 4,096 | 4/6 | 4.53秒 | 4.53秒 | 14.1 |
| 8,192 | 6/6 | 9.19秒 | 6.57秒 | 10.9 |
| 16,384 | 6/6 | 11.75秒 | 7.95秒 | 11.7 |

- 同じ長文promptが、4Kでは2,050 tokens、8K/16Kでは4,550 tokensとして処理された。送信文字数・概算token・処理済みtokenは別々に保存した。
- 送信前に消えた最新仕様は、contextを増やしても復元しない。8Kは形式を回復し、2回とも不足を認めた。16Kは片方で古い値を最新と誤答したが、2回だけなので16Kが幻覚の原因とは断定しない。
- 同じ正答が可能な短文632 tokensと不要メモ付き3,992 tokensも比較。どちらも17秒に正答したが、不要メモによる品質向上はなかった。処理時間にはprefillとcacheの影響が大きい。
- **観測されたPareto frontierは4Kと8K**。16Kはこの小さな診断セットでは8Kに劣位。3課題各2回のみであり、一般的な最適context値ではない。全情報が4Kを超えて必須になる成功課題は今後の独立検証対象。

全9軸・各回答・cold load・prompt hashは[contextレポート](results/context-sweep/report.md)を参照。グローバル設定は変更していない。request-local context変更に伴う一時的なモデル再ロードは計測に含まれる。

## 原因の切り分け

| 分類 | 確認した事実 | 現段階の解釈 |
|---|---|---|
| NaviComの情報保持 | lowの先頭2,000文字、additionalの先頭保持で必要情報が消える | 実装上の改善余地が確定。ただし単純head-tailは品質改善を証明できなかった |
| 実割当との不整合 | 8,000想定に対しOllama実割当4,096、長文処理tokenが減る | 実装側の予算管理とbackend context同期を次に検証すべき |
| 会話理解 | 過去turnを送らないstateless設計 | 以前の案への言及に回答できない。モデルの記憶能力だけの問題ではない |
| 知識・code reasoning | 入力が届いてもSetの順序、添字範囲、Number空文字を誤る | モデル能力・prompt following・samplingの複合要因。モデルサイズだけに帰属できない |
| 指示遵守・教育 | ヒント依頼へawaitや修正式を直接提示 | Thinkingや公式presetでも残る課題。単なる正答率では採用できない |
| verbosity・日本語 | HTMLタグ、英語混在、不要な確認が出る | 独立軸で退行を検出した。長い回答を高評価にしない |
| backend安定性 | 停止中の到達不能、再起動後の一時500 | 生成品質と分離。再試行成功は元の失敗を取り消さない |

Copilot/OrcaRouterの同一入力への比較回答は今回は取得できなかった。外部Judgeも未設定。従って能力差の大きさや、8Bでは埋められない差の定量値は未測定である。単にクラウド側を正解として扱っていない。今後の比較は同じrubricでknowledge/reasoning、context、prompt following、code reasoning、verbosity、hallucination、pedagogyに分解できる。

## 次に検証すべきこと

1. 独立Judgeで保存済みA/Bを再評価し、完全な順序反転で判断の安定性を確認する。新しいprompt探索より先に評価の確度を上げる。
2. 単純な先頭/末尾保持ではなく、質問で言及する定義・現在の編集位置・最新要件を残す方法を新しいtuningセットで検証する。改善候補選定後に保持中のholdoutを1回実行する。
3. 同一promptの正確なtokenizer見積もりと実割当を同期し、入出力枠を別管理する。長い必須文脈の独立課題で4K/8Kのトレードオフを再確認する。
4. その上でも知識・推論の誤りが残る場合に、別のモデルサイズ・量子化を比較する。今回はQ4_K_M以外のモデルを導入・変更していない。

## 成果物・検証

- [実装調査](AUDIT.md)、[再実行手順](README.md)、[rubric](rubric.md)、[判断履歴](rounds.md)
- [全実験JSON](results/experiments.json)、[一覧TSV](results/experiments.tsv)。設定、量子化、prompt version、context、Thinking、sampling、penalty、出力上限、9軸、勝率、所要時間、tokens/sec、失敗分類を保存。unknownは明示。
- `npm test`: 228件成功。評価基盤テスト9件成功。lint成功。外部依存追加なし。
- 合計117観測（通常評価99、context診断18。通信失敗6件を含む）。派生subsetは観測数に重複計上しない。8組のA/B評価、JSON152ファイルの構文・Judgeのpacket hash整合、全評価スクリプトの構文を検証。未完了runはない。
- 未実施: holdout回答生成、独立Judge、Copilot/OrcaRouter比較、別量子化、実エディタcollectorの新たな統合評価。これらを実施済みとは扱わない。
