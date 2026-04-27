export function getSelectionLabel(preview: string): string {
  const firstLine = preview.split("\n")[0].trim();
  return firstLine.length > 96 ? `${firstLine.slice(0, 96)}...` : firstLine;
}
