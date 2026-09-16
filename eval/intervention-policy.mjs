// Evaluation-only. No fixture identifiers, expected answers, algorithm-specific rules or examples.
export const AUTOMATIC_EVIDENCE_POLICY = [
  '自動助言の追加条件: 課題の契約（戻り値・画面への出力・変更してよい対象）をそのまま尊重する。発話前に、具体的な入力または条件、現在のコードの挙動、要求との差が整合しているか照合する。',
  '具体的な未達要件・不足処理を根拠付きで特定できるときだけ、その場所への短いヒントを返す。推測上のリスク、実行結果が未提示であること、正しい処理の再確認、達成済み要件の言い換えや称賛だけなら、{"kind":"no_advice","focus":"none"}を返す。',
  '目的は沈黙を増やすことではない。現在のコードから具体的な不一致や未実装が分かる場合は必ず助言し、確認質問だけに置き換えない。最終回答は着目点に留め、完成した修正式・引数は示さない。'
].join('\n');
