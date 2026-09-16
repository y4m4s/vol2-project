import {manualScore as s,writeAssessment} from '../../manual-assessment.mjs';
const R='incorrect_code_reasoning',L='hint_leakage',U='unnecessary_intervention';
const notes={
 'alg-prefix-correct-py':[s('444444444','正しい閉区間和の実装で適切に沈黙。')],
 'alg-prefix-correct-js':[s('444444444','right+1のprefix差で閉区間を計算する正解に沈黙。')],
 'alg-prefix-bug-py':[s('112141244','prefix[right]-prefix[left]を閉区間和と誤認。保証済みのleft<=rightを問題にし、右端欠落を見逃す。',[R,'ignored_context'],false)],
 'alg-prefix-bug-js':[s('112141144','右端を含まない実装でno_advice。単要素区間でも失敗する欠陥を見逃す。',['missed_bug'],false)],
 'alg-bfs-correct-py':[s('012011244','distance+1を追加している正しいコードに、距離を保持していないという存在しない欠陥を指摘。',[R,U,'hallucination'],false)],
 'alg-bfs-correct-js':[s('112111244','有効な頂点・非空グラフという制約下で正しい実装。空グラフの-1を確認するという対象外の介入。',[U,'ignored_context'],false)],
 'alg-bfs-bug-py':[s('223312234','取り出す順序には着目するがFIFO/LIFOの説明がなく、pop(0)ではなくpopか確認するという誘導が曖昧。具体的な呼び出し式も開示。',[L,'weak_pedagogy'],false)],
 'alg-bfs-bug-js':[s('444444434','末尾からのpopではなく先頭/FIFOが必要と説明。shiftというAPI名の提案だけで完成した呼び出し式はなく許容。やや長い。')],
 'alg-stairs-correct-py':[s('444444434','結果5と、最後の1段/2段という互いに別の遷移を正しく説明。')],
 'alg-stairs-correct-js':[s('444444434','結果5とn-1またはn-2から到達する2通りの分割を説明。内容は正しく若干長い。')],
 'alg-stairs-bug-py':[s('223342244','solve(2)の不一致には触れるが、正しい漸化式を再確認させる。必要なのは0段の初期値であり着目点がずれる。',['weak_pedagogy'],false)],
 'alg-stairs-bug-js':[s('112141144','0段の初期値とsolve(2)の欠陥があるのに沈黙する。',['missed_bug'],false)],
 'alg-sort-correct-py':[s('443412144','数値順で新しい配列を返すという認識は正しいが、正解済みの自動支援では発話せずnoneを返す条件に違反。',[U],false)],
 'alg-sort-correct-js':[s('444444444','数値比較・コピー済みの正解実装で適切に沈黙。')],
 'alg-sort-bug-py':[s('444412444','key=strの文字列順を検出するが、key=intという変更後の引数まで提示。',[L],false)],
 'alg-sort-bug-js':[s('012041244','既定sortを数値順として正しいと誤認し、[...a]のコピーも無視。欠陥と修正対象を取り違える。',[R,'ignored_context'],false)]
};
writeAssessment('eval/results/alg-oll-holdout','3ad57ad6a08ef84890bb1ee024005ac46c60cc0f36d90ca113ee864b27f0cec3',notes);
