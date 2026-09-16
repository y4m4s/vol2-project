/** Retain complete small files without expanding an explicit selection or large file. */
export const MAX_COMPLETE_ACTIVE_FILE_CHARS = 8000;

export interface ActiveDocumentText {
  readonly lineCount: number;
  lineAt(line: number): { text: string };
  getText(): string;
}

/** Bound reads before getText: huge/minified documents must not be copied in full. */
export function completeActiveFile(document: ActiveDocumentText, selectedText?: string): string | undefined {
  if (selectedText || document.lineCount > MAX_COMPLETE_ACTIVE_FILE_CHARS) return undefined;
  let size = Math.max(0, document.lineCount - 1);
  for (let line = 0; line < document.lineCount; line++) {
    size += document.lineAt(line).text.length;
    if (size > MAX_COMPLETE_ACTIVE_FILE_CHARS) return undefined;
  }
  const text = document.getText();
  // Actual length includes CRLF, unlike the cheap preliminary bound.
  return text.trim() && text.length <= MAX_COMPLETE_ACTIVE_FILE_CHARS ? text : undefined;
}
