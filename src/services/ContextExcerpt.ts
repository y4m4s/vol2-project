/** Keep bounded evidence in source order. Never execute or reinterpret source text. */
export function contextExcerpt(text: string, limit: number, question = ""): string {
  limit = Math.max(0, Math.floor(limit));
  if (text.length <= limit) return text;
  const marker = "\n... [truncated to fit model context budget; omitted region] ...\n";
  if (limit < marker.length * 2 + 32) return limit >= marker.length ? marker.trim().slice(0, limit) : "";
  const content = limit - marker.length * 2;
  const edge = Math.floor(content / 4);
  // Named identifiers locate relevant middle sections; the two edges retain declarations
  // and appended requirements. This is bounded retrieval, not a claim of full-file coverage.
  const words = [...new Set(question.match(/[A-Za-z_$][\w$]{2,}/g) ?? [])];
  const candidates = words.map(word => text.indexOf(word, edge)).filter(at => at >= edge && at < text.length - edge);
  if (!candidates.length) {
    const head = Math.ceil((limit - marker.length) / 2);
    return text.slice(0, head) + marker + text.slice(-(limit - marker.length - head));
  }
  const width = content - edge * 2;
  const start = Math.max(edge, Math.min(candidates[0] - Math.floor(width / 2), text.length - edge - width));
  return text.slice(0, edge) + marker + text.slice(start, start + width) + marker + text.slice(-edge);
}
