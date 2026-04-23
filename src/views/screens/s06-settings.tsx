import React, { useState, useEffect } from "react";
import { BackHeader } from "../webview/components/BackHeader";
import { RangeSlider } from "../webview/components/RangeSlider";
import { useApp } from "../webview/state/AppContext";
import type { AdviceMode } from "../../shared/types";

export function S06Settings() {
  const { viewModel, send } = useApp();
  const settings = viewModel?.settings;

  const [defaultMode, setDefaultMode] = useState<AdviceMode>("manual");
  const [requestIntervalSec, setRequestIntervalSec] = useState(30);
  const [idleDelaySec, setIdleDelaySec] = useState(2);
  const [excludeGlobs, setExcludeGlobs] = useState("");

  useEffect(() => {
    if (!settings) return;
    setDefaultMode(settings.defaultMode);
    setRequestIntervalSec(Math.round(settings.requestIntervalMs / 1000));
    setIdleDelaySec(Math.round(settings.idleDelayMs / 1000));
    setExcludeGlobs(settings.excludedGlobs.join("\n"));
  }, [settings]);

  function handleSave() {
    send({
      type: "saveSettings",
      payload: {
        defaultMode,
        requestIntervalSec,
        idleDelaySec,
        excludeGlobs
      },
    });
  }

  return (
    <>
      <BackHeader />
      <div className="page-title">設定</div>
      <div className="page-subtitle">NaviCom の動作と除外パターンを設定できます</div>

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

      {/* 除外設定 */}
      <div className="settings-section">
        <span className="material-symbols-outlined">block</span> 除外設定
      </div>

      <div className="setting-item">
        <div className="setting-label">固定除外パターン</div>
        <div className="setting-desc">安全性やサイズ保護のため常に除外されます</div>
        <div className="protected-exclude-list">
          {settings?.protectedExcludedGlobs.join("\n") ?? ""}
        </div>
      </div>

      <div className="setting-item">
        <label className="setting-label" htmlFor="excludeGlobs">追加除外パターン (glob)</label>
        <div className="setting-desc">このワークスペースで追加したい除外だけを入力します</div>
        <div className="exclude-textarea">
          <textarea
            id="excludeGlobs"
            placeholder="例: **/tmp/**"
            value={excludeGlobs}
            onChange={(e) => setExcludeGlobs(e.target.value)}
          />
        </div>
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
