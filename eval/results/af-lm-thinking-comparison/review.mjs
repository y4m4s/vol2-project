import {manualScore as s} from '../../manual-assessment.mjs';
import {writePairReview} from '../../manual-pair-review.mjs';
writePairReview('eval/results/af-lm-thinking-comparison','ae948106da09142e9171d4cbed31655f4850da26a3175a866d93da9572b23937',[
 [0,'A_slight',s('444412444','末尾の加算漏れの原因は正しいが、i<a.lengthという完成した条件を提示。',['hint_leakage'],false),s('223212344','末尾欠落は捉えるが、a.length-1が範囲外になることを原因にしている。空配列でもループは実行されず範囲外アクセスは起きない。修正条件も開示。',['incorrect_code_reasoning','hint_leakage'],false),'両方解答開示があるが、Aは誤った範囲外診断を含まない。'],
 [1,'tie',s('444444444','正しい総和実装で適切に沈黙。'),s('444444444','正しい総和実装で適切に沈黙。'),'どちらも不要な介入なし。'],
 [2,'A_clear',s('223242324','8→9→11とfalseのトレースは合うが、和3の[1,2]を正解と誤記し、和6へ向けた移動方向の説明も弱い。長い。',['incorrect_code_reasoning'],false),s('000000000','リクエストが完了せず、ユーザーに回答を届けられない。モデルの意味的能力の誤答とは区別。',['infrastructure'],false),'Aにも誤答はあるが一部の動作情報が届く。Bは未配信。'],
 [3,'B_clear',s('223242344','結果1は合うが、重複時の根拠をleftの右移動に帰しており、等値時のright更新と逆。',['incorrect_code_reasoning'],false),s('444444444','結果1と等値時に右境界をmiddleへ移す動作を正しく説明。'),'Bだけが重複時の探索方向を正答。']
]);
