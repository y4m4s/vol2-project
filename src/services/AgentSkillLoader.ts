import { parseDocument } from "yaml";

/** YAML is data only: reject aliases, custom tags, excessive nesting and invalid fields. */
export function parseReferenceFrontmatter(text: string): { metadata: Record<string, unknown>; body: string } {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { metadata: {}, body: normalized };
  const end = normalized.indexOf("\n---", 4);
  if (end < 0 || !/^\n---(?:\n|$)/.test(normalized.slice(end))) throw new Error("frontmatterの終端が不正です。");
  if (end > 16_384) throw new Error("frontmatterが大きすぎます。");
  const doc = parseDocument(normalized.slice(4, end), { schema: "core", uniqueKeys: true, strict: true });
  if (doc.errors.length || doc.warnings.length) throw new Error("YAMLメタデータを解析できません。");
  const metadata: unknown = doc.toJS({ maxAliasCount: 0 });
  const validate = (value: unknown, depth: number): void => {
    if (depth > 8) throw new Error("メタデータの階層が深すぎます。");
    if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("無効なメタデータです。");
        validate(item, depth + 1);
      }
    }
  };
  validate(metadata, 0);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("メタデータはマップで指定してください。");
  return { metadata: metadata as Record<string, unknown>, body: normalized.slice(end + 4).replace(/^\n/, "") };
}

export function loadAgentSkill(text: string, directoryName: string) {
  const { metadata, body } = parseReferenceFrontmatter(text);
  const { name, description, compatibility } = metadata;
  if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64 || name !== directoryName) {
    throw new Error("Skillのnameは親ディレクトリ名と一致する64文字以内の小文字・数字・ハイフンにしてください。");
  }
  if (typeof description !== "string" || !description.trim() || description.length > 1024 || !body.trim()) {
    throw new Error("Skillにはdescription（1〜1024文字）と本文が必要です。");
  }
  if (compatibility !== undefined && (typeof compatibility !== "string" || compatibility.length > 500)) throw new Error("Skillのcompatibilityが不正です。");
  if (metadata.metadata !== undefined && (!metadata.metadata || typeof metadata.metadata !== "object" || Array.isArray(metadata.metadata) ||
    Object.values(metadata.metadata).some(value => typeof value !== "string"))) throw new Error("Skillのmetadataは文字列のマップにしてください。");
  for (const field of ["license", "allowed-tools"]) {
    if (metadata[field] !== undefined && typeof metadata[field] !== "string") throw new Error(`Skillの${field}が不正です。`);
  }
  // Only explicit Markdown links to bundled text references. Never fetch URLs or execute scripts.
  const resources = [...body.matchAll(/\]\((?:\.\/)?(references\/[^\s)#]+)(?:#[^\s)]*)?\)/g)].map(match => match[1]);
  return { body, name, description: description.trim(), compatibility: compatibility as string | undefined, resources: [...new Set(resources)].slice(0, 8) };
}
