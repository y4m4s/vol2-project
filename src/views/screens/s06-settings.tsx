import React, { useState, useEffect } from "react";
import { BackHeader } from "../webview/components/BackHeader";
import { ToggleSwitch } from "../webview/components/ToggleSwitch";
import { RangeSlider } from "../webview/components/RangeSlider";
import { useApp } from "../webview/state/AppContext";
import type { AdviceMode } from "../../shared/types";

export function S06Settings() {
  const { viewModel, send } = useApp();
  const settings = viewModel?.settings;

  const [defaultMode, setDefaultMode] = useState<AdviceMode>("manual");
  const [alwaysModeEnabled, setAlwaysModeEnabled] = useState(false);
  const [requestIntervalSec, setRequestIntervalSec] = useState(30);
  const [idleDelaySec, setIdleDelaySec] = useState(2);
  const [suppressDuplicate, setSuppressDuplicate] = useState(true);
  const [ctxActiveFile, setCtxActiveFile] = useState(true);
  const [ctxSelection, setCtxSelection] = useState(true);
  const [ctxDiagnostics, setCtxDiagnostics] = useState(true);
  const [ctxRecentEdits, setCtxRecentEdits] = useState(true);
  const [ctxSymbols, setCtxSymbols] = useState(true);
  const [excludeGlobs, setExcludeGlobs] = useState("");

  useEffect(() => {
    if (!settings) return;
    setDefaultMode(settings.defaultMode);
    setAlwaysModeEnabled(settings.alwaysModeEnabled);
    setRequestIntervalSec(Math.round(settings.requestIntervalMs / 1000));
    setIdleDelaySec(Math.round(settings.idleDelayMs / 1000));
    setSuppressDuplicate(settings.suppressDuplicate);
    setCtxActiveFile(settings.sendTargets.activeFile);
    setCtxSelection(settings.sendTargets.selection);
    setCtxDiagnostics(settings.sendTargets.diagnostics);
    setCtxRecentEdits(settings.sendTargets.recentEdits);
    setCtxSymbols(settings.sendTargets.relatedSymbols);
    setExcludeGlobs(settings.excludedGlobs.join("\n"));
  }, [settings]);

  function handleSave() {
    send({
      type: "saveSettings",
      payload: {
        defaultMode,
        alwaysModeEnabled,
        requestIntervalSec,
        idleDelaySec,
        suppressDuplicate,
        ctxActiveFile,
        ctxSelection,
        ctxDiagnostics,
        ctxRecentEdits,
        ctxSymbols,
        excludeGlobs,
      },
    });
  }

  return (
    <>
      <BackHeader />
      <div className="page-title">設定</div>
      <div className="page-subtitle">拡張機能の動作を設定できます</div>

      {/* モード設定 */}
      <div className="settings-section">
        <span className="material-symbols-outlined">tune</span> モード設定
      </div>

      <div className="setting-item">
        <div className="setting-row">
          <div>
            <div className="setting-label">初期モード</div>
            <div className="setting-desc">起動時に使用するモード</div>
          </div>
          <div className="dropdown-wrap">
            <select
              id="defaultMode"
              value={defaultMode}
              onChange={(e) => setDefaultMode(e.target.value as AdviceMode)}
            >
              <option value="manual">必要時</option>
              <option value="always">常時</option>
            </select>
          </div>
        </div>
      </div>

      <div className="toggle-row">
        <div className="toggle-label">
          <div className="toggle-title">常時モードを有効化</div>
          <div className="toggle-desc">自動的にアドバイスを受け取ります</div>
        </div>
        <ToggleSwitch
          id="alwaysModeEnabled"
          checked={alwaysModeEnabled}
          onChange={setAlwaysModeEnabled}
        />
      </div>

      {/* 頻度制御 */}
      <div className="settings-section">
        <span className="material-symbols-outlined">speed</span> 頻度制御
      </div>

      <RangeSlider
        id="requestInterval"
        label="リクエスト間隔"
        value={requestIntervalSec}
        min={10}
        max={120}
        unit="秒"
        onChange={setRequestIntervalSec}
      />

      <RangeSlider
        id="idleDelay"
        label="アイドル時間"
        value={idleDelaySec}
        min={1}
        max={60}
        unit="秒"
        onChange={setIdleDelaySec}
      />

      <div className="toggle-row">
        <div className="toggle-label">
          <div className="toggle-title">重複抑制</div>
          <div className="toggle-desc">類似助言の繰り返しを防ぎます</div>
        </div>
        <ToggleSwitch
          id="suppressDuplicate"
          checked={suppressDuplicate}
          onChange={setSuppressDuplicate}
        />
      </div>

      {/* 送信対象設定 */}
      <div className="settings-section">
        <span className="material-symbols-outlined">send</span> 送信対象設定
      </div>

      {[
        { label: "アクティブファイル", id: "ctxActiveFile", value: ctxActiveFile, set: setCtxActiveFile },
        { label: "選択範囲", id: "ctxSelection", value: ctxSelection, set: setCtxSelection },
        { label: "診断情報", id: "ctxDiagnostics", value: ctxDiagnostics, set: setCtxDiagnostics },
        { label: "最近の編集", id: "ctxRecentEdits", value: ctxRecentEdits, set: setCtxRecentEdits },
        { label: "関連シンボル", id: "ctxSymbols", value: ctxSymbols, set: setCtxSymbols },
      ].map(({ label, id, value, set }) => (
        <div key={id} className="context-toggle-item">
          <span>{label}</span>
          <ToggleSwitch id={id} checked={value} onChange={set} />
        </div>
      ))}

      {/* 除外設定 */}
      <div className="settings-section">
        <span className="material-symbols-outlined">block</span> 除外設定
      </div>

      <div style={{ fontSize: "0.9em", marginBottom: 4 }}>除外パターン (glob)</div>
      <div className="exclude-textarea">
        <textarea
          id="excludeGlobs"
          placeholder="例: **/.env"
          value={excludeGlobs}
          onChange={(e) => setExcludeGlobs(e.target.value)}
        />
      </div>

      {/* アクションボタン */}
      <div className="s06-actions">
        <button onClick={handleSave}>
          <span className="material-symbols-outlined">save</span> 保存
        </button>
        <button className="btn-gray" onClick={() => send({ type: "resetSettings" })}>
          <span className="material-symbols-outlined">restart_alt</span> 初期値に戻す
        </button>
      </div>
    </>
  );
}
