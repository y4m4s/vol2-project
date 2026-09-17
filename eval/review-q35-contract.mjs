// Manual anonymous review; no A/B identity key was used to assign scores.
import {manualScore as s} from './manual-assessment.mjs';
import {writePairReview} from './manual-pair-review.mjs';
const silent=()=>s('444444444','正しい実装に指定どおり沈黙。');
writePairReview('eval/results/q35-contract-comparison','44ec9222ff4bf0208ed8b7ac3fac3af9a20cb71046977c4a95e7810ac36bd191',[
  [0,'tie',s('111122234','整数入力なのに要素型の変換へ誘導。比較規則の問題を外す。',['incorrect_code_reasoning','ignored_context'],false),
    s('000400044','文字列順になる既存バグに沈黙。',['incorrect_code_reasoning'],false),'Aは誤った変換へ誘導、Bは見逃し。いずれも有効なヒントを届けない。'],
  [1,'A_slight',s('444412234','1要素で欠落する説明は正しいが完成条件i<a.lengthを提示。',['hint_leakage'],false),
    s('111121244','空配列は既に0を返す。実際の末尾欠落を説明せず空配列のための調整と誤診。',['incorrect_code_reasoning'],false),'Aにも漏洩があるが、コード挙動の説明は正しい。双方タスク失敗。'],
  [2,'tie',s('333323334','追跡を促すだけで要求された結果1を答えない。',['instruction_following','weak_pedagogy'],false),
    s('223323334','結果未回答。right更新をleftの変化と呼ぶ説明も不正確。',['instruction_following','weak_pedagogy'],false),'双方とも数値を回答せず、要求を満たさない。'],
  [3,'A_clear',s('434433334','文字列順の原因は正しい。整数入力に数値変換を要求するのは余分だが完成式なし。'),
    s('000000000','本文の比較説明は正しいが、引用符がエスケープされずJSON不正。再生成後も回答未配信。配信込みで0点。',['invalid_format'],false),'Aは配信可能。Bは正しい説明を含むが形式不正で利用者へ届かない。'],
  [4,'tie',silent(),silent(),'正しい総和への沈黙。'],
  [5,'A_clear',s('334443344','n=2で1になる不一致と初期化に着目。0段の基底までは明示しない。'),
    s('111121234','n=2でways[3]を返すという事実はない。返すのはways[2]で1。誤った添字とループ条件を指摘。',['incorrect_code_reasoning','hallucination'],false),'Aは具体的な不一致を正しく述べ、Bは存在しない配列参照を診断。'],
  [6,'B_clear',s('111122124','片方だけポインタを動かすこと自体を原因とし、和の増減を説明しない。',['incorrect_code_reasoning'],false),
    s('233333323','左右移動と和の増減は正しいが、片方だけ動かすことを原因とする最終総括は不正確。',['incorrect_code_reasoning'],false),'Bの増減の説明は有用。どちらも片方だけ動かすこと自体を原因にしてしまう。'],
  [7,'tie',s('444444444','末尾欠落と既存の反復範囲を短く指摘。完成式なし。'),
    s('444444434','末尾を含まない範囲と全要素という要件を正しく照合。完成式なし。'),'どちらも正しい短いヒント。'],
  [8,'tie',s('333323334','等しい時のright更新に注目させるが結果1を答えない。',['instruction_following','weak_pedagogy'],false),
    s('333323334','重複時のright更新を説明するが結果1を答えない。',['instruction_following','weak_pedagogy'],false),'双方とも直接質問への数値回答がない。'],
  [9,'A_clear',silent(),s('111111134','比較関数が既にあるのに文字列比較の問題を捏造。',['incorrect_code_reasoning','unnecessary_intervention'],false),'Aは正しいコードに沈黙、Bは誤指摘。'],
  [10,'A_clear',silent(),s('111111134','sorted(a)が新しいリストを返すことを取り違えコピーを要求。',['incorrect_code_reasoning','unnecessary_intervention'],false),'Aは適切な沈黙、Bはsortedの誤認。'],
  [11,'tie',s('334333324','断定不能という中心回答は適切。動作例からの推測とNの定義確認は余分で厳密性に弱さ。'),
    s('334333334','実装不明で断定不能。N回呼ぶだけで二乗とは言えず条件の説明は粗い。'),'双方とも実装の未提示を理由に断定を避ける。'],
  [12,'tie',silent(),silent(),'正しい総和への沈黙。'],
  [13,'B_slight',s('111101123','戻り値が契約なのに表示処理を要求し不要なprintコードを提示。',['hallucination','incorrect_code_reasoning','hint_leakage'],false),
    s('122122234','solve(2)=1という不一致は正しいがways[-1]の参照は存在しない。',['incorrect_code_reasoning','hallucination'],false),'Bは実際の戻り値の不一致へ進むが原因は誤診。改善しても成功とは数えない。'],
  [14,'B_clear',s('111122124','一致時にreturn trueがあるのにその欠落を仮定。和の増減を説明しない。',['incorrect_code_reasoning','hallucination'],false),
    s('333433323','ポインタ移動と和の増減の関係、および8からさらに増やしてしまう例を説明。やや長く最後の問いは余分。'),'Bは単調性と具体例の核心を説明。'],
  [15,'tie',s('444433334','実装不明で断定できないと回答。動作例だけでは計算量の証明にならない。'),
    s('444433324','実装不明で断定不能と回答。未提示のテストから推測する誘導は余分。'),'中心回答は双方適切、付随する推測の誘導には弱さ。']
]);
