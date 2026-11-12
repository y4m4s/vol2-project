import { useId, useState } from "react";
import { useApp } from "../state/AppContext";

const statuses = { ready: "更新済み", scanning: "更新中", error: "確認が必要", disabled: "無効", restricted: "信頼待ち" };

export function ReferenceSourceManager({ disabled }: { disabled: boolean }) {
  const { viewModel, send } = useApp();
  const [adding, setAdding] = useState(false);
  const addPanelId = useId();
  const references = viewModel?.referenceContext;
  if (!references) return null;
  const unavailable = disabled || !references.trusted;

  function add(directory: boolean) {
    send({ type: "addContextSource", kind: "document", scope: "workspace", directory });
    setAdding(false);
  }

  return <section className="reference-source-manager" aria-label="添付">
    {!references.trusted && <small role="status">ワークスペースの信頼が必要です</small>}
    {references.sources.map(item => {
      const selected = item.documents.filter(doc => doc.selected);
      return <div className="reference-source-item" key={item.source.id}>
        <div className="reference-source-row">
          {item.source.directory
            ? <svg className="reference-attachment-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M3 7V5h6l2 2h10v13H3V7Z" /></svg>
            : <span className="material-symbols-outlined reference-attachment-icon" aria-hidden="true">description</span>}
          <label className="reference-source-name" title={item.location}>
            <input className="reference-source-toggle" type="checkbox" role="switch" aria-label={`${item.source.label}を有効にする`} aria-checked={item.source.enabled}
              checked={item.source.enabled} disabled={disabled || (!references.trusted && !item.source.enabled)}
              onChange={event => send({ type: "setContextSourceEnabled", id: item.source.id, enabled: event.target.checked })} />
            <span>{item.source.label}</span>
          </label>
          <span className="reference-source-badge" title={item.source.localOnly ? "ローカル限定" : "外部AIへの送信を許可済み"}>
            {item.source.localOnly ? "ローカル" : "外部可"}
          </span>
          <button type="button" className="reference-attachment-remove" title="添付を外す" aria-label={`${item.source.label}の添付を外す`}
            disabled={disabled} onClick={() => send({ type: "removeContextSource", id: item.source.id })}>×</button>
        </div>
        {item.status !== "ready" && item.status !== "error" && <small role="status">{statuses[item.status]}</small>}
        {item.errors.length > 0 && <details className="reference-source-notices">
          <summary title="クリックで詳細を表示">確認事項 <span>{item.errors.length}件</span></summary>
          <ul className="reference-source-notice-list">
            {item.errors.map(error => <li key={error}>{error}</li>)}
          </ul>
        </details>}
        {selected.length > 0 && <div className="reference-selected-items">
          {selected.slice(0, 3).map(doc => <span key={doc.id} title={doc.path}>{doc.title}</span>)}
          {selected.length > 3 && <span>＋{selected.length - 3}</span>}
        </div>}
        <details className="reference-source-management">
          <summary>{item.source.kind === "skill" ? item.source.skillMode === "procedure" ? "手順を適用" : "参考として適用" : item.source.alwaysInclude ? "常に全文を含める" : "必要な箇所を参照"} · {item.documentCount}ファイル</summary>
          {item.location && <small className="reference-source-location">{item.location}</small>}
          {(item.source.languages.length > 0 || item.source.appliesTo.length > 0) && <small>{[...item.source.languages, ...item.source.appliesTo].join(", ")}</small>}
          <div className="reference-source-actions">
            {item.source.directory && <button type="button" disabled={unavailable || !item.source.enabled}
              onClick={() => send({ type: "selectContextDocuments", id: item.source.id })}>常に含めるものを選択</button>}
            <button type="button" disabled={unavailable} onClick={() => send({ type: "configureContextSource", id: item.source.id })}>利用設定</button>
            <button type="button" disabled={unavailable} onClick={() => send({ type: "refreshContextSources" })}>再読み込み</button>
          </div>
          {!!item.documents.length && <details><summary>ファイル一覧</summary><ul>
            {item.documents.slice(0, 100).map(doc => <li key={doc.id} title={doc.description}><button type="button" disabled={unavailable}
              data-selected={doc.selected} aria-label={doc.selected ? `${doc.path}（選択済み）` : doc.path}
              onClick={() => send({ type: "openContextDocument", id: doc.id })}>{doc.path}</button></li>)}
            {item.documents.length > 100 && <li>ほか{item.documents.length - 100}件</li>}
          </ul></details>}
        </details>
      </div>;
    })}
    <div className="reference-source-heading">
      <button type="button" disabled={unavailable} aria-expanded={adding} aria-controls={addPanelId} onClick={() => setAdding(!adding)}>
        {adding ? "閉じる" : "＋追加"}
      </button>
    </div>
    {adding && <div id={addPanelId} className="reference-add-panel">
      <div className="reference-add-options">
        <button type="button" disabled={unavailable} onClick={() => add(false)}>ファイル</button>
        <button type="button" disabled={unavailable} onClick={() => add(true)}>フォルダー</button>
        {references.legacyAvailable && <button type="button" disabled={unavailable} onClick={() => {
          send({ type: "importContextSources" }); setAdding(false);
        }}>以前の登録から</button>}
      </div>
    </div>}
  </section>;
}
