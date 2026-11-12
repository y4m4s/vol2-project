/** UTF-8 text only; secret/generated paths are excluded separately before reading. */
export const REFERENCE_TEXT_EXTENSIONS = ["md", "markdown", "mdx", "txt", "json", "jsonc", "yaml", "yml", "toml", "xml", "csv",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "php", "go", "rs", "java", "cs", "c", "cpp", "h", "hpp",
  "html", "css", "scss", "vue", "svelte", "sql", "sh", "rb", "kt", "swift"];

export function isReferenceTextPath(file: string): boolean {
  return REFERENCE_TEXT_EXTENSIONS.includes(file.slice(file.lastIndexOf(".") + 1).toLowerCase());
}
