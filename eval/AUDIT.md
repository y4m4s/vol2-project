# ローカルLLM経路調査 — 2026-09-15

調査基準 commit: `90924d3129e88d553f0c57a8e8246755abf84ce2`。変更開始時のworktreeはclean。

## 実際の入力経路

ContextCollector → RequestPlanner → AdviceService.buildPrompt → PromptBuilder → ConnectionService → provider client → GuidanceResponsePolicy。評価はCollector出力に相当する合成snapshotから開始し、planner以降を再現する。VS Codeの実viewport抽出そのものは別途統合テストの対象。

| 項目 | 現行動作・根拠 |
|---|---|
| system | 英語中心のnavigator方針、Japanese指定、depth、ヒント優先、JSON契約、参照データ境界。automaticは日本語の判断規則と課題達成指示が追加される。`PromptBuilder.ts` |
| user | active file識別子→automatic観測/cursor→selectionまたはactive excerpt→diagnostics→recent edits→symbols→tree→related files→project overview。context閉じ→additional→knowledge→feedback→automatic decision→user question |
| active file | Collectorはselection優先、次に最初のvisibleRange、fallback先頭。selection 4,000文字、active 8,000文字。全文送信ではない |
| 関連ファイル | Collector最大5件、各3,000文字、200KB以下。Planner lowは送らない。slash presetでも絞る |
| lowの切り詰め | Plannerでactive excerpt先頭2,000文字。追加マーカーなし。OllamaはeffectiveDepthが常にhighなのでこの切り詰めを通らない |
| prompt予算 | ローカルprofileはmaxInputTokensを持たず8,000想定。全文を24,000文字以内に制限。additionalは先に25%（automatic 10%）確保するが、提示順は後ろ。各blockは先頭保持、後部を落とす。質問は切らない |
| 会話履歴 | 通常guidanceはstateless。前ターンを送らず、UIの会話表示とは別。knowledge作成だけ直近7件を各1,800文字で利用。過去の助言はknowledge/feedbackとして限定利用 |
| LM Studio | reasoning指定ありの通常経路は`/api/v1/chat`: system_prompt,input,reasoning=off/on,max_output_tokens,store=false,integrations=[]。未指定時のみOpenAI互換 |
| Ollama | `/v1/chat/completions`: system+userの2 messages、reasoning_effort=none/high、max_tokens。referenced pathsは独自metadataでありファイル本文はuser内 |
| Thinkingと内容 | UI high→Thinking high。low→none。**Ollamaだけ説明深さ・文脈をhighへ変換**。LM Studio lowはlowのまま |
| max output | LM Studio low 2,048（flow 3,072）、high 8,192。Ollamaは常に8,192。thinkingも同じ予算を消費する |
| sampling | 両providerともtemperature/top_p/top_k/min_p/penalty未送信。backendのmodel/preset/runtime値に依存 |
| context length | 両providerとも未送信。8,000というprofile予算は実ロードcontextと同期しておらず出力枠も予約しない |
| 応答処理 | JSON等の形式検査→失敗時に1回だけformat repair。出力上限到達は再送しない。automaticでは既存コードを再提案したcontinueをno_adviceへ抑制する処理もある。raw/delivered両方を評価する |
| Copilot | 同じprompt builderだがモデル情報でdelimiterとbudgetが変わる。system相当もUser roleとして送る。VS Code Language Model API、countTokens対応 |
| OrcaRouter | system/userを分離するOpenAI互換。モデル情報によるprofile差があり、比較対象も同じrubricで評価する必要がある |

## 実環境（読み取りのみ）

- Ollama 0.34.0、`qwen3:8b`、8.2B、Q4_K_M、digest `500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`。
- Ollama `/api/show`: model parameters temperature=.6、top_p=.95、top_k=20、repeat_penalty=1。min_pは記載なし。これはThinking推奨に一致する部分があるが、Non-Thinking推奨のtemperature=.7/top_p=.8とは異なる。NaviCom側で意図的に選んだ値ではなくモデル継承。effective min_pは未確認。
- Ollama templateはGo templateでsystem/user区切りと、Thinking指定に応じた`/think`/`/no_think`、空のthink blockを組み立てる。正確なtemplateとhashをenvironment artifactに保存。
- LM Studio `qwen/qwen3-8b`、Q4_K_M、ロード済みcontext=8,192、parallel=4、flash_attention=true。API metadataの最大値は32,768。Ollama model metadataの40,960とは別物であり、どちらも実割当の証明にはならない。
- 同じQ4_K_M表記でもLM StudioとOllamaのファイルサイズは異なる。重み・template・runtimeまで同一だとは仮定しない。
- LM Studio未指定samplingの実効値はAPI model情報だけでは不明。グローバル設定を変更して値を揃えることはしない。
- LM StudioのGGUF埋込templateをヘッダから読み取り、`results/lmstudio-gguf-metadata.json`へ保存。Jinja2の`enable_thinking=false`で空のthink blockを付ける。OllamaのGo templateとは異なる。これは埋込templateの証拠であり、runtime overrideがないことまで証明しない。
- 実推論後のOllama `/api/ps` は **4,096 tokens** を報告。長い追加文脈の処理済みpromptは2,050 tokens、LM Studio側は4,543 tokens。provider prompt自体もdepthによる小差があるため、同一promptのnative context sweepで再確認する。
- LM Studioの履歴metadataの最終記録app versionは0.4.21。GPU機種/VRAM全量のOS照会は実行環境で拒否され、nvidia-smiも利用不可。APIのGPU配置情報以上のハードウェア同一性は主張しない。

## 疑わしい箇所と検証順

1. 確定した入力欠落: lowの先頭2,000文字、additionalの先頭保持。末尾に答えがあるケースでpromptに証拠が含まれるかを機械記録。
2. Provider差: content depth、出力予算、API、template。provider比較は複数要因を含む観測比較であり、単一原因の証明にしない。Ollama native adapterはtransportだけを先に比較。
3. 小規模モデルに長い制約群が与える影響、曖昧な断定禁止と直接回答の関係。baselineの実際の失敗に基づいて検討。
4. Thinking ON/OFFのみを比較。内容のdepthとoutput budgetを同時に変えない。
5. 公式sampling presetを候補として比較。preset全体の比較と個別parameterの因果効果を区別。
6. Ollama native APIのrequest-local num_ctxで4K/8K/16Kを計測。実allocは`/api/ps`、処理promptはprompt_eval_count、生成速度はeval_count/eval_durationで観測。入力不足と生成枠不足を分離する。

公式確認: [Qwen3-8B model card](https://huggingface.co/Qwen/Qwen3-8B)、[Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)、[Ollama context length](https://docs.ollama.com/context-length)、[LM Studio chat fields](https://lmstudio.ai/docs/developer/rest/chat)。Ollama OpenAI互換はnum_ctx/top_k/min_pをサポート項目に挙げていないため、未対応の値を黙って送らずeval専用native adapterを使う。
