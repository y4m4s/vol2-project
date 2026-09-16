import {manualScore as s,writeAssessment} from '../../manual-assessment.mjs';
const R='incorrect_code_reasoning',L='hint_leakage',U='unnecessary_intervention';
const notes={
 'alg-prefix-correct-py':[s('223212244','right+1を使う正しい閉区間の式に、根拠のない添字確認を要求する。具体的な欠陥はない。',[U],false)],
 'alg-prefix-correct-js':[s('444444444','正しい閉区間和の実装で適切に沈黙。')],
 'alg-prefix-bug-py':[s('112141234','右端を含まない差を正しい閉区間和と誤認。戻り値が要件なのにprint不足へ話題を変える。',[R,'ignored_context'],false)],
 'alg-prefix-bug-js':[s('112141144','右端欠落があり、単要素区間も誤るコードでno_advice。',['missed_bug'],false)],
 'alg-bfs-correct-py':[s('223212244','正しい距離更新とFIFO処理に、欠陥の根拠なく確認を要求。正解済みの自動支援で不要な介入。',[U],false)],
 'alg-bfs-correct-js':[s('012011244','隣接リストの向きをそのまま辿る正しい実装に、有向グラフを考慮していないという存在しない欠陥を指摘。',[R,U,'hallucination'],false)],
 'alg-bfs-bug-py':[s('444444444','popによるLIFOと必要なFIFOを区別。可能性という留保は弱いが、具体的修正式なしで正しい着目点。')],
 'alg-bfs-bug-js':[s('444444444','現在はLIFO、必要なのはFIFOという原因を短く説明。完成コードなし。')],
 'alg-stairs-correct-py':[s('334443343','結果5と最後の1段/2段の考え方は合うが、直前のがという日本語が崩れ、状態の説明が粗い。')],
 'alg-stairs-correct-js':[s('444444444','結果5と最後の遷移がn-1またはn-2である理由を簡潔に説明。')],
 'alg-stairs-bug-py':[s('112141244','range(2,n+1)ではi=2が実行されないと誤答。本当の原因はways[0]の初期値。',[R],false)],
 'alg-stairs-bug-js':[s('112141144','0段やsolve(2)で不一致がある実装に沈黙。',['missed_bug'],false)],
 'alg-sort-correct-py':[s('443412143','sortedが新しいリストを返し要件を満たすと認識するが、さらに確認を要求。正解済みの自動支援では沈黙すべき。',[U],false)],
 'alg-sort-correct-js':[s('444444444','数値比較とコピーを行う正しい実装で適切に沈黙。')],
 'alg-sort-bug-py':[s('223212234','key=strの問題は検出するが、既定値でもあるreverse=Falseの追加は文字列順を直さない。具体的引数の変更まで提示。',[R,L],false)],
 'alg-sort-bug-js':[s('444412444','文字列順の原因は正しいが、完成した比較関数を含むsort呼び出しを提示し解答を開示。',[L],false)]
};
writeAssessment('eval/results/alg-lm-holdout','bbd8b40707ae5728173c55936691d761f52e2c37b5221a7aeb46c96af937d6c3',notes);
