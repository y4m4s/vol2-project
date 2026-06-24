/**
 * 評価ハーネスのアサーション部品。
 *
 * Check は「テキスト（組み立て済みプロンプト or モデル応答）を受け取り合否を返す」純粋関数。
 * プロンプト検査（静的）にもモデル応答検査（ライブ）にも同じ部品を使える。
 */

export interface CheckResult {
  passed: boolean;
  detail?: string;
}

export interface Check {
  name: string;
  run: (text: string) => CheckResult;
}

// 日本語とコードの混在を想定した粗いトークン概算（AdviceService の実測フォールバックと同じ係数）。
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export function includes(substring: string, name?: string): Check {
  return {
    name: name ?? `includes(${truncateLabel(substring)})`,
    run: (text) =>
      text.includes(substring)
        ? { passed: true }
        : { passed: false, detail: `expected to contain: ${truncateLabel(substring)}` }
  };
}

export function excludes(substring: string, name?: string): Check {
  return {
    name: name ?? `excludes(${truncateLabel(substring)})`,
    run: (text) =>
      text.includes(substring)
        ? { passed: false, detail: `expected NOT to contain: ${truncateLabel(substring)}` }
        : { passed: true }
  };
}

export function matches(re: RegExp, name?: string): Check {
  return {
    name: name ?? `matches(${re})`,
    run: (text) => (re.test(text) ? { passed: true } : { passed: false, detail: `expected to match: ${re}` })
  };
}

export function maxApproxTokens(max: number, name?: string): Check {
  return {
    name: name ?? `maxApproxTokens(${max})`,
    run: (text) => {
      const tokens = estimateTokens(text);
      return tokens <= max
        ? { passed: true, detail: `~${tokens} tokens` }
        : { passed: false, detail: `~${tokens} tokens > ${max}` };
    }
  };
}

// 応答にコードフェンスを含まない（例: /hint は実装コードを出さない）。
export function hasNoFencedCode(name?: string): Check {
  return {
    name: name ?? "hasNoFencedCode",
    run: (text) => (text.includes("```") ? { passed: false, detail: "fenced code block found" } : { passed: true })
  };
}

// 応答に Mermaid コードブロックを含む（/flow）。
export function hasMermaidBlock(name?: string): Check {
  return {
    name: name ?? "hasMermaidBlock",
    run: (text) =>
      /```mermaid/i.test(text) ? { passed: true } : { passed: false, detail: "no ```mermaid block" }
  };
}

// 箇条書き行が max 個以下（ロウ深さの簡潔さを担保する）。
export function maxBulletLines(max: number, name?: string): Check {
  return {
    name: name ?? `maxBulletLines(${max})`,
    run: (text) => {
      const count = text.split(/\r?\n/).filter((line) => /^\s*([-*]|\d+\.)\s+/.test(line)).length;
      return count <= max
        ? { passed: true, detail: `${count} bullets` }
        : { passed: false, detail: `${count} bullets > ${max}` };
    }
  };
}

function truncateLabel(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 48 ? normalized : `${normalized.slice(0, 48)}…`;
}
