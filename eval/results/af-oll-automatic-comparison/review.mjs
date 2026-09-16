import {manualScore as s} from '../../manual-assessment.mjs';
import {writePairReview} from '../../manual-pair-review.mjs';
const quiet=()=>s('444444444','正しい実装への適切な沈黙。');
const missed=reason=>s('112411044',reason,['incorrect_code_reasoning','weak_pedagogy'],false);
writePairReview('eval/results/af-oll-automatic-comparison','cc2577a0615c2b0ff541bbc74e99764bda295b4d88d019ab7613ad4c128ea5d9',[
 [0,'B_slight',s('112111244','range(2,n+1)はnを含む。ways[n]未計算という誤診と不要なrange変更の開示。',['incorrect_code_reasoning','hint_leakage'],false),s('223242233','期待値を繰り返しsolve(3)の確認を求めるのみで、0段の初期値を特定しない。現在の計算値も説明しない。',['weak_pedagogy'],false),'Bも未達だが誤ったrange仕様と修正式はない。'],
 [1,'tie',quiet(),quiet(),'累積和の正解に両方沈黙。'],
 [2,'tie',s('112111233','正しい距離更新を誤りと断定しながら必要条件とも述べる。',['incorrect_code_reasoning','unnecessary_intervention'],false),s('112111234','追加前にseenへ登録済みなので同一ノードが複数処理されるという疑いに根拠がない。',['incorrect_code_reasoning','unnecessary_intervention'],false),'どちらも正しいBFSを誤診。'],
 [3,'tie',s('444412233','sortedの正しさを認めながら不要な実行確認を要求。',['unnecessary_intervention'],false),s('444412233','新しい配列/非破壊の要件を満たすことを認めながら不要な再確認。',['unnecessary_intervention'],false),'正解を認識できても両方発話を控えられない。'],
 [4,'B_clear',s('222211244','配列を返す契約に改行/空白の出力形式を持ち込む。',['unnecessary_intervention','incorrect_code_reasoning'],false),quiet(),'Bだけ適切に沈黙。'],
 [5,'tie',s('444412444','文字列比較の原因は正しいがkey=lambda x:xという完成引数を提示。',['hint_leakage'],false),s('334312444','文字列比較の原因は正しいがkey=intという完成引数を必須として提示。',['hint_leakage'],false),'両方とも具体的引数まで開示。修正自体はこの整数入力で機能する。'],
 [6,'tie',quiet(),quiet(),'正しい累積和に両方沈黙。'],
 [7,'tie',s('444412444','文字列比較の診断は正しいが完成した数値comparatorを提示。',['hint_leakage'],false),s('444412444','文字列比較の診断は正しいが完成した数値comparatorを提示。',['hint_leakage'],false),'同じ解答開示。'],
 [8,'A_slight',s('223212234','headインデックスの前進は定数時間であり、非効率という根拠が誤り。dequeというAPI名自体は解答開示ではない。',['incorrect_code_reasoning','unnecessary_intervention'],false),s('112111234','提示例で正しく距離2を返す実装を誤答と断定。',['incorrect_code_reasoning','unnecessary_intervention'],false),'Aも不要で根拠が誤るがBは具体的な正常動作を否定。'],
 [9,'tie',missed('累積和の右端欠落を見逃す。'),missed('累積和の右端欠落を見逃す。'),'両方バグに沈黙。'],
 [10,'A_slight',s('443412224','最短距離の機能は正しく述べるが、既に正しい例を再検証させるだけの不要な介入。',['unnecessary_intervention','excessive_verbosity'],false),s('223212233','有向の隣接リストをそのまま辿る実装に、有向を考慮しないという根拠のない疑い。',['incorrect_code_reasoning','unnecessary_intervention'],false),'Aは不要な確認だが有向グラフの誤診を避ける。'],
 [11,'B_slight',s('223212244','既に正しいdistance+1を根拠なく疑う。',['unnecessary_intervention','incorrect_code_reasoning'],false),s('333312124','非再帰BFSであることは正しいが、無関係な再帰/スタックの懸念や制約超過の話を持ち込む。',['unnecessary_intervention','excessive_verbosity'],false),'Bは無関係で長いが、実際の距離更新を誤診しない。'],
 [12,'tie',missed('階段数の0段初期値バグを見逃す。'),missed('階段数の0段初期値バグを見逃す。'),'両方沈黙で見逃し。'],
 [13,'tie',s('444444444','未実装の要素加算に短く誘導し完成式なし。'),s('444444444','未実装の要素加算に誘導し完成式なし。'),'同等の適切なヒント。'],
 [14,'tie',s('444444444','0のまま返す理由と加算の不足を指摘。'),s('444444444','forという許容されたキーワードで加算の不足を指摘。'),'同等の適切なヒント。'],
 [15,'tie',quiet(),quiet(),'正しい数値sortに両方沈黙。'],
 [16,'B_slight',missed('階段数の0段初期値バグを見逃す。'),s('333442244','solve(3)の検証を促すだけで原因の初期値には届かず、漸化式に着目している。',['weak_pedagogy'],false),'Bは失敗する具体例を示すが、両方診断不足。'],
 [17,'A_clear',s('444444434','文字列キーによる比較規則の不一致を正しくヒントにする。可能性という反復はやや冗長。'),s('334312344','文字列比較の原因は正しいがkey=intという完成引数を必須として指定。',['hint_leakage'],false),'Aだけ具体的解答を開示しない。'],
 [18,'tie',missed('階段数の0段初期値バグを見逃す。'),missed('階段数の0段初期値バグを見逃す。'),'両方バグに沈黙。'],
 [19,'tie',quiet(),quiet(),'正しい累積和に両方沈黙。'],
 [20,'tie',missed('累積和の右端欠落を見逃す。'),missed('累積和の右端欠落を見逃す。'),'両方バグに沈黙。'],
 [21,'tie',quiet(),quiet(),'正しい累積和に両方沈黙。'],
 [22,'tie',quiet(),quiet(),'正しい数値sortに両方沈黙。'],
 [23,'tie',missed('累積和の右端欠落を見逃す。'),missed('累積和の右端欠落を見逃す。'),'両方バグに沈黙。'],
 [24,'tie',s('444444444','TODO付近の加算不足を完成式なしで指摘。'),s('444444444','要素をループして加算する不足処理を完成式なしで指摘。'),'同等の適切なヒント。'],
 [25,'tie',s('223242244','数値sort実装済みと誤認し、例を検証するだけで比較規則に届かない。',['incorrect_code_reasoning','weak_pedagogy'],false),s('223242244','文字列比較は正しいが、既に整数の要素を数値に変換しても比較規則は変わらない。',['incorrect_code_reasoning'],false),'Aは原因に届かずBは誤った対処。両方未達。'],
 [26,'tie',missed('累積和の右端欠落を見逃す。'),missed('累積和の右端欠落を見逃す。'),'両方バグに沈黙。'],
 [27,'tie',s('444444444','0のまま返す原因と不足する加算を指摘。'),s('444444444','0のまま返す原因と不足する加算を指摘。'),'同等の適切なヒント。']
]);
