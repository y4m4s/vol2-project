import {manualScore as s} from '../../manual-assessment.mjs';
import {writePairReview} from '../../manual-pair-review.mjs';
const quiet=()=>s('444444444','正しい両配列の末尾処理を含むmergeに適切に沈黙。');
const missed=reason=>s('112411044',reason,['incorrect_code_reasoning','weak_pedagogy'],false);
writePairReview('eval/results/af-lm-confirmation-comparison','bb21d8f9808f9878275a37a597a2bad09ef457d226cafd5c2e70f1806c347cd1',[
 [0,'B_clear',s('112111234','balance<0を0以下と誤読し、検出済みの閉じ括弧先行を未対応と誤診。',['incorrect_code_reasoning','unnecessary_intervention'],false),s('443412224','途中の負数検出が正しいと認めるが、既に満たす空文字と長さ制約への不要な確認を付け足す。',['unnecessary_intervention','excessive_verbosity'],false),'Bは先行括弧の誤診を避けるが、両方沈黙すべき。'],
 [1,'A_slight',missed('全負配列で空部分列を許すバグに沈黙。'),s('112111234','非空制約で全負配列が失敗するのに正しいKadane実装と述べ、一般的な確認に留まる。',['incorrect_code_reasoning','weak_pedagogy'],false),'両方見逃しだがBは誤った正解保証も与える。'],
 [2,'A_slight',s('444444444','途中で閉じ括弧が先行する不足処理を指摘。負のbalanceへの着目という概念的ヒントで、完成した条件式やreturnは示さない。'),s('344443343','先行する閉じ括弧と反例は正しいが、差を括弧の総数と呼び、true判定を正しい結果と呼ぶ表現が紛らわしい。',[],true),'両方根本原因に届くがAの説明が明瞭。'],
 [3,'B_slight',s('444443444','結果-2とa[0]初期化を説明するが、非空制約との関係は暗黙。'),s('444444444','結果-2と、少なくとも1要素を含む初期化の根拠を説明。'),'Bは非空という理由が明示的。'],
 [4,'A_slight',s('444444444','結果-2とa[0]による非空制約の維持を説明。'),s('444443444','全負の場合に最大が配列内の要素になる説明は正しいが非空制約との関係は暗黙。'),'Aは制約と初期化の関係が明瞭。'],
 [5,'B_clear',s('112111244','互除法の交換により入力順が結果に影響すると誤診。実際はreturn bで常に0。',['incorrect_code_reasoning'],false),s('444444444','bが0で終了するのにbを返すという矛盾へ具体的に着目させ、修正コードなし。'),'Bだけが終了時の値とreturnを結び付ける。'],
 [6,'B_slight',s('112111234','既に展開してpushしているaの末尾処理を未展開と誤読。重複保持にも問題はなく、欠落するbの末尾を見つけない。',['incorrect_code_reasoning'],false),missed('bの残りを追加しないバグを見逃す。'),'両方未達。Aは存在しない重複/展開の問題へ誤誘導。Bの沈黙も見逃しとして計上。'],
 [7,'tie',s('444443444','結果6とbが0になったときaが最大公約数となる関係を説明。余り更新は短く一般的。'),s('444443444','結果6とbが0になったときaが最大公約数となる関係を説明。余り更新は短く一般的。'),'同等の正しい説明。'],
 [8,'A_slight',s('112111244','既にbalance<0で検出する処理を未対応と誤診し、同じ処理を求める。',['incorrect_code_reasoning','unnecessary_intervention'],false),s('001011234','閉じ括弧で減算する処理を無視し、入力にない波括弧の対応を要求。',['incorrect_code_reasoning','hallucination','unnecessary_intervention'],false),'両方誤診だがBは文字集合の制約まで無視。'],
 [9,'tie',s('444444443','閉じ括弧が先行するケースの見逃しを短く指摘。できてませんという口語はやや粗い。'),s('344444434','先行閉じ括弧と反例の指摘は正しい。総合計という表現は差のカウントとしてやや曖昧。'),'どちらも適切に不足条件をヒントにする。'],
 [10,'B_clear',s('223242344','結果6は正しいがaとbが0になるまでという終了状態は誤り。aは6で残る。',['incorrect_code_reasoning'],false),s('444443444','結果6とbが0のとき非零aが答えになることを説明。'),'Bだけが質問された終了時の変数関係を正答。'],
 [11,'tie',quiet(),quiet(),'正しいmergeに両方沈黙。'],
 [12,'tie',missed('全負配列で0を返す非空制約違反を見逃す。'),missed('全負配列で0を返す非空制約違反を見逃す。'),'両方バグに沈黙。'],
 [13,'tie',missed('終了時b=0をそのまま返すGCDバグを見逃す。'),missed('終了時b=0をそのまま返すGCDバグを見逃す。'),'両方バグに沈黙。'],
 [14,'tie',quiet(),quiet(),'正しいmergeに両方沈黙。'],
 [15,'tie',missed('bの残りを追加しないmergeバグを見逃す。'),missed('bの残りを追加しないmergeバグを見逃す。'),'両方バグに沈黙。']
]);
