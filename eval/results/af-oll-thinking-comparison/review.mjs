import {manualScore as s} from '../../manual-assessment.mjs';
import {writePairReview} from '../../manual-pair-review.mjs';
writePairReview('eval/results/af-oll-thinking-comparison','68363d7c79dcd553131fefa62f27907347cb4534982caec43d0f2de3cb6b7516',[
 [0,'A_slight',s('333343324','8→9→11と見逃す組の位置は正しい。ただしleft=2,right=3で直ちに条件不成立とする説明は不正確で、その後のleft増加を落としている。和を小さくする必要性も明示しない。',['incorrect_code_reasoning','weak_pedagogy'],false),s('334412344','小さい和を大きくする方向は正しいが、例が最初に通る大きい和の分岐を説明しない。条件とleft++の具体的な修正を開示。',['hint_leakage','weak_pedagogy'],false),'Aは例の実際の動きを追えているが終了説明に誤り。Bは例の原因説明が不足し具体的な修正も提示。両方未達。'],
 [1,'tie',s('444444444','結果1と右境界をmiddleへ絞る規則を正しく説明。'),s('444444444','結果1と等値時に右境界をmiddleへ絞り最初の位置へ収束することを説明。'),'両方とも重複時の探索と戻り値を満たす。'],
 [2,'tie',s('444444444','正しい総和実装で適切に沈黙。'),s('444444444','正しい総和実装で適切に沈黙。'),'どちらも不要な介入なし。'],
 [3,'tie',s('444412444','末尾の加算漏れは正しいが、i<a.lengthという完成した条件を提示。',['hint_leakage'],false),s('444412444','末尾の加算漏れは正しいが、i<a.lengthという完成した条件を提示。',['hint_leakage'],false),'原因は両方正しいが、同じ解答開示でヒント制約未達。']
]);
