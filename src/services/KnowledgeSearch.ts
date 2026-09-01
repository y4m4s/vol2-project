/** SQLite の組み込み NOCASE に依存せず、Unicode の大小文字と互換文字を揃える。 */
export function normalizeKnowledgeSearchText(...values: readonly string[]): string {
  return values.join("\n").normalize("NFKC").toLowerCase();
}

/** LIKE のワイルドカードをリテラルとして検索できるようにする。 */
export function escapeKnowledgeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
