/**
 * A narrow, deterministic check for a next-step proposal that repeats a call
 * already present in current code. This does not decide whether a task is solved.
 * Historical edits must never be supplied as currentCode.
 */
export function repeatsExistingCallProposal(text: string, currentCode: readonly string[]): boolean {
  // Retain conditional/risk explanations; a repeated call can be useful evidence there.
  if (/(?:ただし|一方|場合|例外|エラー|失敗|注意|ではなく|だけでは|その後|してから|続いて|追加|もう一|再度|さらに|(?:\d+|[一二三四五六七八九十]+)回)/.test(text)) return false;
  const proposed = callsIn(text);
  if (!proposed.length) return false;
  const existing = new Set(currentCode.flatMap(code => callsIn(code, true))
    .map(call => call.canonical));
  // A response containing a new call is not merely a repeat of existing code.
  if (!proposed.every(call => existing.has(call.canonical))) return false;
  return proposed.some(call => {
    const following = text.slice(call.end).replace(/^[\s`"'」】]+/, "");
    return /^(?:のように|と(?:書|記述|する|してください)|を(?:使|用い|書|記述))/.test(following);
  });
}

interface Call { canonical: string; end: number }

function callsIn(text: string, code = false): Call[] {
  const calls: Call[] = [];
  const searchable = code ? maskCommentsAndStrings(text) : text;
  const start = /\b[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*\s*\(/g;
  let match: RegExpExecArray | null;
  let scanned = 0;
  // Bounded scanning; this is not a parser or an evaluator for any language.
  while (scanned++ < 128 && calls.length < 64 && (match = start.exec(searchable))) {
    if (code && /\b(?:def|function|class)\s+$/.test(searchable.slice(Math.max(0, match.index - 32), match.index))) continue;
    let depth = 1;
    let quote = "";
    let canonical = match[0].replace(/\s/g, "");
    let literal = "";
    for (let i = start.lastIndex; i < Math.min(text.length, start.lastIndex + 1024); i++) {
      let char = text[i];
      // Markdown can escape operators in prose; never unescape source code or literals.
      if (!code && !quote && char === "\\" && /[*_]/.test(text[i + 1] ?? "")) char = text[++i];
      if (quote) {
        if (char === "\\") {
          literal += char + (text[++i] ?? "");
        } else if (char === quote) {
          canonical += JSON.stringify(literal);
          literal = "";
          quote = "";
        } else {
          literal += char;
        }
      } else if (char === '"' || char === "'") {
        quote = char;
      } else {
        if (!/\s/.test(char)) canonical += char;
        if (char === "(") depth++;
        if (char === ")" && --depth === 0) {
          calls.push({ canonical, end: i + 1 });
          start.lastIndex = i + 1;
          break;
        }
      }
    }
  }
  return calls;
}

// Mask only for locating call starts. Arguments are read from the original text,
// so whitespace and characters inside string literals retain their meaning.
function maskCommentsAndStrings(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|#[^\r\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g,
    value => value.replace(/[^\r\n]/g, " "));
}
