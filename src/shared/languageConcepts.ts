import type { LanguageFamilyId } from "./learningProfile";

/**
 * 既知言語との比較に使う概念カタログ（Phase 2）。
 *
 * LanguageReference と同じく、小さくキュレーションした表にする。誤りが混入しやすい資産なので、
 * 各対応の note は「似ている点」と「違う点」を対で短く書き、評価ケース（test/ComparisonPolicy.test.ts）と
 * 合わせて管理する。対応の確認日: 2026-11-26（各言語の公式ドキュメントの一般的な仕様の範囲）。
 *
 * 判定の考え方（docs/learning-support-design.md §5.1）:
 *   - 診断コード・キーワード・質問文は「候補」を出すだけに使う
 *   - 候補とは別の種類の証拠（メッセージの形・周辺のコード・選択位置）で裏付けが取れたときだけ採用する
 */

export type CounterpartSupport = "direct" | "partial" | "none";

export interface ConceptCounterpart {
  support: CounterpartSupport;
  note: string;
}

export interface LanguageConcept {
  id: string;
  label: string;
  /** この概念を判定する学習中の言語 */
  targets: readonly LanguageFamilyId[];
  /** false の概念は判定しない（評価で効果を確認するまで無効にしておくもの） */
  enabled: boolean;
  /** 候補を出す診断（source が ts のもの）のコード */
  diagnosticCodes: readonly string[];
  /** 診断から出た候補の裏付け: メッセージがこの形なら採用 */
  messagePattern?: RegExp;
  /** 診断から出た候補の裏付け: 診断の周辺のコードにこれがあれば採用 */
  nearbyPattern?: RegExp;
  /** 診断から出た候補を打ち消す形（例: プリミティブ同士の型の不一致は構造的型付けではない） */
  messageExclude?: RegExp;
  /** 選択範囲・カーソル行にこれがあれば、候補かつ裏付けありとする */
  codePattern?: RegExp;
  /** 質問文にこれがあれば候補。裏付けは、周辺のコード（カーソル付近）に codePattern があること */
  questionPattern?: RegExp;
  counterparts: Partial<Record<LanguageFamilyId, ConceptCounterpart>>;
}

const PRIMITIVE = "(?:string|number|boolean|bigint|symbol|null|undefined)(?:\\[\\])?";
const PRIMITIVE_MISMATCH = new RegExp(`Type '${PRIMITIVE}' is not assignable to type '${PRIMITIVE}'|Argument of type '${PRIMITIVE}' is not assignable to parameter of type '${PRIMITIVE}'`);

export const LANGUAGE_CONCEPTS: readonly LanguageConcept[] = [
  {
    id: "nullability",
    label: "null / undefined の扱い（?. ・ ??）",
    targets: ["typescript", "javascript"],
    enabled: true,
    diagnosticCodes: ["18047", "18048", "18049", "2531", "2532", "2533"],
    messagePattern: /\b(?:null|undefined)\b/,
    codePattern: /\?\.|\?\?/,
    questionPattern: /null|undefined|オプショナル|optional/i,
    counterparts: {
      javascript: { support: "partial", note: "?. と ?? は同じだが、JavaScript には型による null の検査がなく、実行時のエラーで初めて気づく" },
      python: { support: "partial", note: "None は1種類で undefined に相当する値はない。Optional[T] は型ヒントで、検査は mypy などの型チェッカーが行う" },
      php: { support: "partial", note: "?Type（nullable 型）・??・?->（PHP 8.0）は近いが、undefined に相当する値はない" },
      java: { support: "partial", note: "参照型はすべて null になりうる。Optional は値の入れ物で、コンパイラは null を検査しない" },
      csharp: { support: "direct", note: "null 許容参照型（T?）・?. ・?? と、コンパイラの警告で検査する点が近い。undefined はない" },
      kotlin: { support: "direct", note: "T? と ?. ・?:（エルビス演算子）、コンパイル時の null 検査が近い。undefined はない" },
      swift: { support: "direct", note: "Optional（T?）・?. ・?? が近い。undefined はない" },
      go: { support: "partial", note: "nil はポインタ・スライス・マップなどだけで、基本型はゼロ値になる。?. に相当する構文はない" },
      ruby: { support: "partial", note: "nil と &.（ぼっち演算子）は近いが、型による検査はない" },
      rust: { support: "partial", note: "Option<T> で値がないことを型で表す点は近いが、null 自体はない" },
      cpp: { support: "partial", note: "nullptr はポインタだけ。std::optional は値の入れ物で、?. に相当する構文はない" }
    }
  },
  {
    id: "structural_typing",
    label: "構造的型付け（interface・型の互換）",
    targets: ["typescript"],
    enabled: true,
    diagnosticCodes: ["2322", "2345", "2741", "2739", "2740", "2559", "2353"],
    messagePattern: /is missing (?:the following properties|in type)|Object literal may only specify known properties|does not exist in type '\{|'\{[^']*\}'|has no properties in common/,
    messageExclude: PRIMITIVE_MISMATCH,
    nearbyPattern: /\binterface\s+\w+|\btype\s+\w+\s*=|\bimplements\b|[:=(,]\s*\{\s*\w+\s*:/,
    codePattern: /\binterface\s+\w+|\bimplements\b/,
    questionPattern: /インターフェース|interface|構造的|型が合わない|互換/i,
    counterparts: {
      javascript: { support: "none", note: "JavaScript には静的な型がない" },
      python: { support: "partial", note: "typing.Protocol は構造的部分型だが、検査は型チェッカーだけ。実行時はダックタイピング" },
      php: { support: "none", note: "interface は implements で明示する名前的な型" },
      java: { support: "none", note: "interface は implements で明示する名前的な型" },
      csharp: { support: "none", note: "interface は明示的に実装する名前的な型" },
      kotlin: { support: "none", note: "interface は明示的に実装する名前的な型" },
      swift: { support: "none", note: "protocol への準拠は明示する" },
      go: { support: "direct", note: "interface は暗黙に満たされる。ただし Go はフィールドではなくメソッドの集合で判定する" },
      ruby: { support: "partial", note: "ダックタイピングは近い考え方だが、静的な検査はない" },
      rust: { support: "none", note: "トレイトは impl で明示的に実装する" },
      cpp: { support: "partial", note: "テンプレートは構造で受け入れる（コンパイル時の展開）が、型どうしの互換ではない" }
    }
  },
  {
    id: "async_promise",
    label: "非同期処理（Promise・async / await）",
    targets: ["typescript", "javascript"],
    enabled: true,
    diagnosticCodes: ["1308", "1378", "2801", "80007"],
    messagePattern: /\bawait\b|Promise|\basync\b/,
    codePattern: /\bawait\b|\basync\b|\bPromise\b|\.then\s*\(/,
    questionPattern: /非同期|async|await|Promise|プロミス/i,
    counterparts: {
      javascript: { support: "direct", note: "同じ Promise と async / await" },
      python: { support: "direct", note: "async def / await は近い。イベントループを自分で起動する（asyncio.run）点が異なる" },
      php: { support: "none", note: "標準では同期的に実行する。Fiber（PHP 8.1）は別の仕組み" },
      java: { support: "partial", note: "CompletableFuture は Promise に近いが、async / await の構文はない" },
      csharp: { support: "direct", note: "Task と async / await が近い" },
      kotlin: { support: "partial", note: "suspend 関数とコルーチンは近いが、Promise のような値ではなく呼び出しの仕組み" },
      swift: { support: "direct", note: "async / await と Task が近い" },
      go: { support: "partial", note: "goroutine と channel は別のモデル（並行実行）で、await に相当する構文はない" },
      ruby: { support: "none", note: "標準の async / await はない（Fiber・スレッドは別の仕組み）" },
      rust: { support: "partial", note: "async / await と Future は近いが、Future は poll されるまで実行されない" },
      cpp: { support: "partial", note: "std::future や co_await はあるが、イベントループを前提にしない" }
    }
  },
  {
    id: "array_methods",
    label: "配列の操作（map・filter・reduce）",
    targets: ["typescript", "javascript"],
    enabled: true,
    diagnosticCodes: [],
    codePattern: /\.(?:map|filter|reduce|flatMap|forEach|find|some|every)\s*\(/,
    questionPattern: /\b(?:map|filter|reduce)\b|配列/,
    counterparts: {
      javascript: { support: "direct", note: "同じ Array のメソッド" },
      python: { support: "partial", note: "map / filter は遅延評価のイテレータを返す。内包表記で書くことが多い" },
      php: { support: "partial", note: "array_map(fn, arr) と array_filter(arr, fn) で引数の順序が違う。array_filter はキーを保持する" },
      java: { support: "partial", note: "Stream API（stream().map(...).collect(...)）。終端操作まで実行されない" },
      csharp: { support: "partial", note: "LINQ の Select / Where / Aggregate。遅延評価" },
      kotlin: { support: "direct", note: "map / filter / reduce がほぼ同じ。Sequence にすると遅延評価" },
      swift: { support: "direct", note: "map / filter / reduce がほぼ同じ" },
      ruby: { support: "direct", note: "map / select / reduce（inject）がほぼ同じ" },
      go: { support: "none", note: "標準ではループで書く" },
      rust: { support: "partial", note: "iter().map().filter() は遅延評価で、collect() が必要" },
      cpp: { support: "partial", note: "<algorithm> の std::transform など、または C++20 の ranges" }
    }
  },
  {
    id: "generics",
    label: "ジェネリクス（型引数）",
    targets: ["typescript"],
    enabled: true,
    diagnosticCodes: ["2314", "2344", "2558", "2707"],
    messagePattern: /type argument|Type parameter|generic/i,
    codePattern: /<\s*[A-Z]\w*\s*(?:extends\b|,|>)/,
    questionPattern: /ジェネリクス|ジェネリック|generics?|型引数|型パラメータ/i,
    counterparts: {
      javascript: { support: "none", note: "JavaScript には静的な型がない" },
      python: { support: "partial", note: "TypeVar や 3.12 の型パラメータ構文があるが、実行時には検査されない" },
      php: { support: "none", note: "言語としてのジェネリクスはなく、PHPDoc の @template で静的解析ツールに伝える" },
      java: { support: "direct", note: "ジェネリクスと型境界（extends）が近い。どちらも実行時には型引数が残らない" },
      csharp: { support: "direct", note: "ジェネリクスと制約（where）が近い。C# は実行時にも型引数が残る" },
      kotlin: { support: "direct", note: "ジェネリクスと上限境界が近い" },
      swift: { support: "direct", note: "ジェネリクスと制約が近い" },
      go: { support: "partial", note: "Go 1.18 からの型パラメータ。制約は interface で表す" },
      rust: { support: "partial", note: "ジェネリクスとトレイト境界。コンパイル時に型ごとに展開される" },
      cpp: { support: "partial", note: "テンプレート。コンパイル時に型ごとに展開される" }
    }
  },
  {
    id: "equality",
    label: "等価比較（=== と ==）",
    targets: ["typescript", "javascript"],
    enabled: true,
    diagnosticCodes: ["2367"],
    messagePattern: /comparison appears to be unintentional/,
    codePattern: /[^=!<>]==[^=]|!=[^=]/,
    questionPattern: /===|==|等価|比較演算/,
    counterparts: {
      javascript: { support: "direct", note: "同じ演算子と変換規則" },
      php: { support: "direct", note: "== は型を変換して比較し、=== は型も比較する点が近い（変換の規則は異なる）" },
      python: { support: "partial", note: "== は値の比較（__eq__）、is が同一性。暗黙の型変換はほとんどない" },
      java: { support: "partial", note: "== は参照の比較で、値の比較は equals()" },
      csharp: { support: "partial", note: "== の意味は型（演算子の定義）による。暗黙の型変換はほとんどない" },
      kotlin: { support: "partial", note: "== は equals()、=== は参照の同一性（JavaScript の === とは意味が違う）" },
      swift: { support: "partial", note: "== は値の比較、=== は参照の同一性" },
      go: { support: "partial", note: "== は同じ型どうしでしか使えず、暗黙の変換はない" },
      ruby: { support: "partial", note: "== は値、equal? は同一性" },
      rust: { support: "partial", note: "PartialEq による比較で、暗黙の変換はない" },
      cpp: { support: "partial", note: "== は型ごとの演算子定義による" }
    }
  },
  {
    // 評価（C11〜C12）で効果を確認するまで無効。誤った類推の危険が比較的大きい。
    id: "primitive_types",
    label: "文字列と数値の扱い（暗黙の型変換）",
    targets: ["typescript"],
    enabled: false,
    diagnosticCodes: ["2322", "2345"],
    messagePattern: PRIMITIVE_MISMATCH,
    nearbyPattern: /\.value\b|\+\s*["'`]|["'`]\s*\+|parseInt|Number\(/,
    counterparts: {
      php: { support: "partial", note: "PHP は文字列と数値を暗黙に変換する（type juggling）が、TypeScript の型検査は変換を許さない" },
      python: { support: "partial", note: "暗黙に変換しない点は近いが、Python は実行時に TypeError になる" }
    }
  }
];

/**
 * 比較の候補にしない「些末な」診断（スペルミス・構文の欠落・未使用など）。
 * これらだけが出ているときは、比較ではなく通常の助言に任せる。
 */
export const TRIVIAL_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  "2304", "2552", "2551", "2724", "1005", "1003", "1109", "1128", "1434", "6133", "6138", "6192", "6196", "6198", "7027", "7028"
]);

export function findConcept(id: string): LanguageConcept | undefined {
  return LANGUAGE_CONCEPTS.find((concept) => concept.id === id);
}
