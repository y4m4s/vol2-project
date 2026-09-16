import {manualScore as s} from '../../manual-assessment.mjs';
import {writePairReview} from '../../manual-pair-review.mjs';
const quiet=()=>s('444444444','正しい実装に対して適切に沈黙。');
const missed=reason=>s('112411044',reason,['incorrect_code_reasoning','weak_pedagogy'],false);
writePairReview('eval/results/af-lm-automatic-comparison','62700d3280a754a600f660019bda459cc15a680b08b82cdcc721784d529908c8',[
 [0,'tie',quiet(),quiet(),'数値sortの正解コードに両方沈黙。'],
 [1,'tie',s('223242244','辞書順比較の指摘は合うが、既に整数の要素/引数をNumberに変換してもsortの比較規則は変わらない。',['incorrect_code_reasoning'],false),s('223242244','辞書順比較の指摘は合うが、整数要素のNumber変換を要求しても修正にならない。',['incorrect_code_reasoning'],false),'両方が同じ誤った数値変換へ誘導。'],
 [2,'B_clear',s('112111244','整数sorted(a)が例を満たさないという誤診。不要なkey=intの完成引数も提示。',['incorrect_code_reasoning','unnecessary_intervention','hint_leakage'],false),s('332312244','sortedが正しいことは認めるが、戻り値の契約に対し不要な出力確認を要求。',['unnecessary_intervention','weak_pedagogy'],false),'両方不要な介入だがBにはsortedの誤った仕様説明がない。'],
 [3,'B_slight',s('223211233','start=target時に既に0を返すのにreturn 0の別処理を要求する矛盾した確認。',['unnecessary_intervention','incorrect_code_reasoning'],false),s('443412233','BFSと距離の返却は正しく述べるが、既に正しい距離更新への不要な再確認。',['unnecessary_intervention'],false),'Bは誤った別処理を求めないが、両方沈黙すべき。'],
 [4,'B_slight',s('333442244','範囲やprefix計算を一般的に再確認するだけで、右端の欠落を絞り込めない。',['weak_pedagogy'],false),s('334443344','誤っているreturn式と区間の要件を対置しているが、両端を含むことと右端欠落の関係を特定しない。',['weak_pedagogy'],false),'Bは着目場所が具体的だが、どちらも端点の欠落を説明しない。'],
 [5,'A_clear',s('223212244','正しいdistance+1を根拠なく疑う。',['unnecessary_intervention','incorrect_code_reasoning'],false),s('001001144','start=targetで常に-1という誤診。distance===0を条件に足す修正は他の到達先でも即0を返す誤った変更。',['incorrect_code_reasoning','hallucination','unnecessary_intervention','hint_leakage'],false),'Aも不適切だがBは正常コードを壊す具体的修正。'],
 [6,'B_clear',s('001011234','headを順に進めるFIFOをLIFO/DFSと誤認している。',['incorrect_code_reasoning','hallucination','unnecessary_intervention'],false),s('443412224','BFSと探索順の正しさは認めるが、同じ正しい距離更新を再確認させる不要な介入。',['unnecessary_intervention'],false),'BはDFSという誤診を避けているが不要な確認が残る。'],
 [7,'A_clear',s('444412444','ways[0]が0のためsolve(2)が1になるという原因は正しいが、ways[0]に1を設定という完成した代入指示を開示。',['hint_leakage'],false),s('112111234','現在のsolve(2)/solve(3)を正答と誤認し、range(0,n+1)という不要で壊れる変更を開示。',['incorrect_code_reasoning','hint_leakage'],false),'Aは原因が正しい。両方ヒントの範囲を超える。'],
 [8,'tie',missed('ways[0]=0による階段数の不具合を見逃して沈黙。'),missed('ways[0]=0による階段数の不具合を見逃して沈黙。'),'両方バグを見逃す。'],
 [9,'tie',quiet(),quiet(),'正しい累積和に両方沈黙。'],
 [10,'B_slight',missed('右端を含まないバグに沈黙。'),s('332442234','区間和を検証するという課題の言い換えのみ。端点欠落の具体的ヒントがない。',['weak_pedagogy'],false),'Bは確認を促すが診断として不足。どちらも未達。'],
 [11,'tie',s('444444444','未実装の加算処理を具体的な完成式なしで指摘。'),s('444444444','未実装の加算処理を具体的な完成式なしで指摘。'),'同等の適切なヒント。'],
 [12,'A_slight',s('444412124','式が正しいと自分で認めながら繰り返す不要な介入。既存コードの引用は新しい修正開示ではない。',['unnecessary_intervention','excessive_verbosity'],false),s('222211234','戻り値を返す関数の課題に呼び出し/画面出力が足りないという未要求の要件を追加。',['incorrect_code_reasoning','unnecessary_intervention'],false),'Aは不要だが仕様外の処理追加を求めない。'],
 [13,'tie',quiet(),quiet(),'正しい累積和に両方沈黙。'],
 [14,'tie',quiet(),quiet(),'正しい数値sortに両方沈黙。'],
 [15,'tie',s('444444444','要素をtotalに加える未実装処理への適切なヒント。forというキーワードは許容。'),s('444444444','常に0になる理由と未実装処理を適切に指摘。'),'両方短く原因と着目点を示す。'],
 [16,'tie',s('222211234','sortedは正しいが戻り値だけの契約に不要なprintを要求。',['incorrect_code_reasoning','unnecessary_intervention'],false),s('222211244','sortedは正しいが戻り値だけの契約に不要なprintを要求。',['incorrect_code_reasoning','unnecessary_intervention'],false),'同じ出力契約の取り違え。短さは採否を変えない。'],
 [17,'tie',missed('0段の初期値と階段数の不具合を見逃す。'),missed('0段の初期値と階段数の不具合を見逃す。'),'両方バグを見逃す。'],
 [18,'B_slight',s('444412434','文字列比較の原因は正しいがkey=str削除という完成した編集指示を開示。',['hint_leakage'],false),s('334443334','文字列キーの診断は正しい。別のキーが必要との断定は、キーを省略してよいことを落とす軽い過剰指定。具体的引数は示さない。',[],true),'Bは修正引数を開示せず比較基準に誘導。キー必須という弱点は記録。'],
 [19,'A_slight',s('334344344','文字列比較と数値順の不一致は正しく特定。出力形式という呼び方は不正確だが、原因となる比較規則を明示。',[],true),s('444412444','比較規則の診断は正しいが完成した数値comparatorを提示。',['hint_leakage'],false),'Aは表現に弱さがあるがヒント制約を守る。'],
 [20,'B_clear',s('334312344','key=strの問題は正しく指摘するがkey=intという完成引数を提示し、それが必須と過剰に限定。',['hint_leakage'],false),s('444444444','文字列比較と数値順の要件の不一致へ短く誘導し修正式なし。'),'Bだけが適切な短いヒント。'],
 [21,'tie',missed('累積和の右端欠落を見逃す。'),missed('累積和の右端欠落を見逃す。'),'両方沈黙で見逃し。'],
 [22,'tie',missed('累積和の右端欠落を見逃す。'),missed('累積和の右端欠落を見逃す。'),'両方沈黙で見逃し。'],
 [23,'A_clear',quiet(),s('223212233','有効なleft/rightとN+1個のprefixという根拠を使わず、正しい境界に不要な注意を促す。',['unnecessary_intervention'],false),'Aだけ適切に沈黙。'],
 [24,'tie',s('444444444','不足している累積処理に誘導。'),s('444444444','不足している累積処理に誘導。for/sumの名前のみで完成コードなし。'),'どちらも許容されたヒント。'],
 [25,'A_slight',s('223242244','0段の要件は正しいが、0で初期化済みなのに未初期化と述べ、正しいループ範囲まで誤診。',['incorrect_code_reasoning'],false),s('112111234','初期値が既に0なのに未初期化と誤認し0の代入を要求。range(0,n+1)への誤った具体的変更も開示。',['incorrect_code_reasoning','hint_leakage'],false),'Aには0段の正しい要件があるが、両方原因分析に誤り。'],
 [26,'A_slight',s('112211244','距離を既に保持するFIFOを根拠なく疑い、実装済みの保持を求める。',['incorrect_code_reasoning','unnecessary_intervention'],false),s('111111233','appendとheadによる線形BFSを非効率とし、有向グラフで不要な逆辺を要求。',['incorrect_code_reasoning','unnecessary_intervention'],false),'両方誤診だがBは有向グラフの意味まで取り違える。'],
 [27,'tie',s('444444444','未実装の合計にfor/reduceという許容されたキーワードで誘導。'),s('444444434','未実装の合計にfor/reduceという許容されたキーワードで誘導。やや反復。'),'本質的に同等の適切なヒント。']
]);
