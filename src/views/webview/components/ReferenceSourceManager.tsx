import { useState } from "react";
import type { ReferenceKind, ReferenceScope } from "../../../shared/referenceContext";
import { useApp } from "../state/AppContext";

const kinds: Record<ReferenceKind, string> = { rules: "コーディング規約", adr: "ADR", document: "技術・設計資料", skill: "Skills" };
const statuses = { ready: "更新済み", scanning: "確認中", error: "一部読込エラー", disabled: "無効", restricted: "信頼待ち" };
export function ReferenceSourceManager({ disabled }: { disabled: boolean }) {
  const { viewModel, send } = useApp();
  const [kind, setKind] = useState<ReferenceKind>("document");
  const [scope, setScope] = useState<ReferenceScope>("workspace");
  const references = viewModel?.referenceContext;
  if (!references) return null;
  const unavailable = disabled || !references.trusted;
  return <section className="reference-source-manager" aria-label="登録資料とSkills">
    <div className="reference-source-heading"><strong>参照先・Skills</strong>
      <button type="button" disabled={unavailable} onClick={() => send({ type: "refreshContextSources" })}>再確認</button>
    </div>
    {!references.trusted && <p role="status">ワークスペースを信頼すると参照資料を利用できます。</p>}
    <div className="reference-source-controls">
      <select aria-label="資料の用途" value={kind} disabled={unavailable} onChange={event => setKind(event.target.value as ReferenceKind)}>
        {Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <select aria-label="登録の保存範囲" value={scope} disabled={unavailable} onChange={event => setScope(event.target.value as ReferenceScope)}>
        <option value="workspace">このワークスペース</option><option value="global">共通</option>
      </select>
      <button type="button" disabled={unavailable} onClick={() => send({ type: "addContextSource", kind, scope, directory: false })}>ファイル追加</button>
      <button type="button" disabled={unavailable} onClick={() => send({ type: "addContextSource", kind, scope, directory: true })}>フォルダー追加</button>
    </div>
    <p className="additional-context-note">登録時はローカル限定です。外部AIで使う資料は「利用方法」から送信を許可してください。Skillsのスクリプトは実行されません。</p>
    {!references.sources.length && <p className="additional-context-note">規約は適用範囲、ADR・資料は関連語で選びます。Skillsは登録後に選択してください。</p>}
    {references.sources.map(item => <div className="reference-source-item" key={item.source.id}>
      <label><input type="checkbox" checked={item.source.enabled} disabled={disabled || (!references.trusted && !item.source.enabled)}
        onChange={event => send({ type: "setContextSourceEnabled", id: item.source.id, enabled: event.target.checked })} />
        <strong>{item.source.label}</strong></label>
      <small>{kinds[item.source.kind]} · {item.source.scope === "workspace" ? "このワークスペース" : "共通"} · {item.source.localOnly ? "ローカル限定" : "外部送信可"}</small>
      {item.location && <small title={item.location}>{item.location}</small>}
      <small>{statuses[item.status]} · {item.documentCount}文書{item.source.kind === "skill" ? ` · ${item.source.skillMode === "procedure" ? "手順として適用" : "参考資料"}` : ""}</small>
      {(item.source.languages.length > 0 || item.source.appliesTo.length > 0) && <small>対象: {[...item.source.languages, ...item.source.appliesTo].join(", ")}</small>}
      <div className="reference-source-actions">
        <button type="button" disabled={unavailable || !item.source.enabled} onClick={() => send({ type: "selectContextDocuments", id: item.source.id })}>
          {item.source.kind === "skill" ? "Skillsを選択" : "優先資料を選択"}
        </button>
        <button type="button" disabled={unavailable} onClick={() => send({ type: "configureContextSource", id: item.source.id })}>利用方法</button>
        <button type="button" disabled={disabled} onClick={() => send({ type: "removeContextSource", id: item.source.id })}>登録解除</button>
      </div>
      {!!item.documents.length && <details><summary>読込対象・選択状況を確認</summary><ul>
        {item.documents.slice(0, 100).map(doc => <li key={doc.id} title={doc.description}><button type="button" disabled={unavailable} onClick={() => send({ type: "openContextDocument", id: doc.id })}>{doc.selected ? "✓ " : ""}{doc.path}</button></li>)}
        {item.documents.length > 100 && <li>ほか{item.documents.length - 100}件。「選択」から全件を確認できます。</li>}
      </ul></details>}
      {item.errors.map(error => <p key={error} className="reference-source-error" role="status">{error}</p>)}
    </div>)}
  </section>;
}
