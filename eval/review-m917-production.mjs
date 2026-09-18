import {writePairReview} from './manual-pair-review.mjs';
import {manualScore as s} from './manual-assessment.mjs';
writePairReview('eval/results/m917-oll-production-comparison','be88143b2ac435db0059136310ba4dc75f55be38586b791aefd74131c5ea140d',[
 [0,'A_slight',s('222322234','結果1は正しいが、leftやrightがmiddleの値を更新するという説明は逆で、範囲変化の説明として不十分。',['incorrect_code_reasoning','weak_pedagogy'],false),s('000000000','JSON終端が欠け未配信。rawにも常にleftを進めるという不正確な説明がある。',['invalid_format','incorrect_code_reasoning'],false),'Aは値を配信できるが説明は不十分。Bは形式修正後も未配信。両方ともタスク全体には不合格。'],
 [1,'A_clear',s('444444444','正しいコピーと数値比較に適切に沈黙。'),s('332411124','提示済みのコピー・数値比較・重複保持を活用せず、正しいコードへ再確認を促す。',['unnecessary_intervention'],false),'Aだけが正しいコードへの自動介入を控える。']
]);
