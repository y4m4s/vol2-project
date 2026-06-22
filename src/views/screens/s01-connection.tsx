import { useApp } from "../webview/state/AppContext";

declare global {
  interface Window { __ICON_URI__: string; }
}

export function S01Connection() {
  const { viewModel, send } = useApp();
  const canConnect = viewModel?.canConnect ?? false;
  const isBusy = viewModel?.isBusy ?? false;
  const providerLabel = viewModel?.settings.providerId === "lmStudio" ? "LM Studio" : "GitHub Copilot";

  return (
    <div className="s01-root">
      <div className="s01-panel">
        <div className="s01-hero">
          <div className="s01-brand"><img src={window.__ICON_URI__} alt="NaviCom" className="s01-icon" /><div className="s01-title">NaviCom</div></div>
          <div className="s01-subtitle">選択した AI プロバイダーと接続して、コーディング支援を開始します。</div>
        </div>
        <div className="s01-feature-list">
          <div className="s01-feature"><span className="material-symbols-outlined">hub</span><div className="s01-feature-copy"><div className="s01-feature-title">接続先</div><div className="s01-feature-desc">現在の設定: {providerLabel}</div></div></div>
          <div className="s01-feature"><span className="material-symbols-outlined">code</span><div className="s01-feature-copy"><div className="s01-feature-title">コードを読みながら助言</div><div className="s01-feature-desc">開いているファイル、選択範囲、診断情報をもとに助言します。</div></div></div>
          <div className="s01-feature"><span className="material-symbols-outlined">history</span><div className="s01-feature-copy"><div className="s01-feature-title">会話とナレッジを保存</div><div className="s01-feature-desc">助言の履歴と保存したナレッジを後から確認できます。</div></div></div>
        </div>
        <div className="s01-actions">
          <button className={`s01-connect-btn${isBusy ? " busy" : ""}`} disabled={!canConnect} onClick={() => send({ type: "connect" })}>
            <span className={`material-symbols-outlined${isBusy ? " s01-spin" : ""}`}>{isBusy ? "sync" : "power"}</span>
            {isBusy ? "接続しています..." : `${providerLabel} に接続`}
          </button>
          <button className="btn-gray" onClick={() => send({ type: "navigate", screen: "settings" })}>接続先を設定</button>
        </div>
      </div>
    </div>
  );
}
