# ローカルモデル向け言語仕様メモ

小型モデルが組み込みAPIの仕様を取り違える場合に備えた、短い参照情報。
評価ケースID・変数名・期待回答では検索せず、送信対象コードと質問のAPI名、およびエディタの言語IDで選ぶ。
ユーザーのコードは実行せず、ネットワーク取得も推論時には行わない。
これは対象コードの実行結果や静的解析の証明ではない。独自定義、上書き、prototypeの変更には標準APIの仕様を無条件に適用しない。

## 出典（2026-09-15確認）

- 数値変換: [ECMAScript ToNumber / StringToNumber](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tonumber)
- 反復順・計算量: [ECMAScript Set / Map](https://tc39.es/ecma262/multipage/keyed-collections.html#sec-set-objects)
- 配列の走査・初期値: [ECMAScript Array](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.filter)
- fetch / json: [WHATWG Fetch](https://fetch.spec.whatwg.org/#fetch-method)

採用対象はJavaScript/TypeScriptの数値変換だけ。Set/Map、配列、Promise/fetchの参照も試したが、
操作の追跡ミスや参照の誤適用が残ったため採用しない。回答と棄却理由はeval/resultsに保持する。
Number/parseInt/parseFloatの独自定義・引数・代入がコード内に見える場合は参照を省く。
これは保守的な文字列検査であり、スコープ解析ではない。省略された別ファイルの上書きは検出できず、
コメントなどによる偽陽性では任意の参照情報が省かれる。既知の言語仕様を実装の実測結果と混同しない。
参照が誤答防止を保証するわけではない。モデルは参照を無視したり、対象外のコードに誤適用したりしうる。
追加する仕様は独立した実行例で検証し、品質・入力量・速度・ヒントへの影響を比較する。
既知失敗を契機に選んだ領域なので、新しい課題やholdoutでの確認なしに汎化を主張しない。
