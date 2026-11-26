import type { ReferenceProvenance } from "../../../shared/referenceContext";

/** Uses the answer's saved transmission plan, rather than the next question's live preview. */
export function ReferenceDocumentsContent({ documents }: { documents?: readonly ReferenceProvenance[] }) {
  return <div className="reference-documents-content">
    {!documents?.length
      ? <p className="response-reference-empty">{documents
          ? "この回答では追加の添付資料・Skillsは送信されていません。"
          : "この回答には資料・Skillsの参照記録がありません。"}</p>
      : <><p className="response-reference-note">回答時に送信した資料・Skillsの記録です。</p><ul>
      {documents.map(doc => {
        return <li key={`${doc.sourceId}:${doc.id}`} data-included={doc.included}>
          <div className="response-reference-row">
            <span className="response-reference-state">{doc.included ? doc.kind === "skill" ? "Skill" : "資料" : "未使用"}</span>
            <span className="response-reference-path">{doc.path}</span>
            <span className="response-reference-lines">L{doc.startLine}–{doc.endLine}</span>
          </div>
          <small>{doc.note ?? doc.reason}</small>
        </li>;
      })}
    </ul></>}
  </div>;
}
