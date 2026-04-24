import React, { useEffect, useState } from "react";
import { BackHeader } from "../webview/components/BackHeader";
import { RangeSlider } from "../webview/components/RangeSlider";
import { useApp } from "../webview/state/AppContext";
import type { AdviceMode } from "../../shared/types";

export function S06Settings() {
  const { viewModel, send } = useApp();
  const settings = viewModel?.settings;

  const savedDefaultMode = settings?.defaultMode ?? "manual";
  const savedRequestIntervalSec = settings ? Math.round(settings.requestIntervalMs / 1000) : 30;
  const savedIdleDelaySec = settings ? Math.round(settings.idleDelayMs / 1000) : 2;
  const savedExcludeGlobs = settings?.excludedGlobs.join("\n") ?? "";
  const settingsStatusMessage =
    viewModel?.statusMessage && viewModel.statusMessage.text.includes("設定")
      ? viewModel.statusMessage
      : undefined;

  const [defaultMode, setDefaultMode] = useState<AdviceMode>(savedDefaultMode);
  const [requestIntervalSec, setRequestIntervalSec] = useState(savedRequestIntervalSec);
  const [idleDelaySec, setIdleDelaySec] = useState(savedIdleDelaySec);
  const [excludeGlobs, setExcludeGlobs] = useState(savedExcludeGlobs);

  useEffect(() => {
    setDefaultMode(savedDefaultMode);
    setRequestIntervalSec(savedRequestIntervalSec);
    setIdleDelaySec(savedIdleDelaySec);
    setExcludeGlobs(savedExcludeGlobs);
  }, [savedDefaultMode, savedRequestIntervalSec, savedIdleDelaySec, savedExcludeGlobs]);

  const hasPendingChanges =
    defaultMode !== savedDefaultMode ||
    requestIntervalSec !== savedRequestIntervalSec ||
    idleDelaySec !== savedIdleDelaySec ||
    normalizeExcludeGlobs(excludeGlobs) !== normalizeExcludeGlobs(savedExcludeGlobs);

  function handleSave() {
    send({
      type: "saveSettings",
      payload: {
        defaultMode,
        requestIntervalSec,
        idleDelaySec,
        excludeGlobs
      }
    });
  }

  function handleRevertDraft() {
    setDefaultMode(savedDefaultMode);
    setRequestIntervalSec(savedRequestIntervalSec);
    setIdleDelaySec(savedIdleDelaySec);
    setExcludeGlobs(savedExcludeGlobs);
  }

  return (
    <div className={`s06-root ${hasPendingChanges ? "with-savebar" : ""}`}>
      <BackHeader />
      <div className="page-title">設定</div>
      <div className="page-subtitle">NaviCom の動作と除外パターンを設定できます</div>

      {settingsStatusMessage && (
        <div className={`s06-notice ${settingsStatusMessage.kind}`}>
          <span className="material-symbols-outlined">
            {settingsStatusMessage.kind === "error"
              ? "error"
              : settingsStatusMessage.kind === "warning"
                ? "warning"
                : "info"}
          </span>
          <span>{settingsStatusMessage.text}</span>
        </div>
      )}

      <div className="settings-section">
        <span className="material-symbols-outlined">tune</span> モード設定
      </div>

      <div className="setting-item">
        <div className="setting-row">
          <div>
            <div className="setting-label">初期モード</div>
            <div className="setting-desc">相談開始時に使用するモードです</div>
          </div>
          <div className="dropdown-wrap">
            <select
              id="defaultMode"
              value={defaultMode}
              onChange={(event) => setDefaultMode(event.target.value as AdviceMode)}
            >
              <option value="manual">必要時</option>
              <option value="always">常時</option>
            </select>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <span className="material-symbols-outlined">speed</span> 助言の頻度
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
        label="アイドル判定"
        value={idleDelaySec}
        min={1}
        max={60}
        unit="秒"
        onChange={setIdleDelaySec}
      />

      <div className="settings-section">
        <span className="material-symbols-outlined">block</span> 除外設定
      </div>

      <div className="setting-item">
        <div className="setting-label">保護済みパターン</div>
        <div className="setting-desc">機密性やサイズの観点から常に除外されるパターンです</div>
        <div className="protected-exclude-list">
          {settings?.protectedExcludedGlobs.join("\n") ?? ""}
        </div>
      </div>

      <div className="setting-item">
        <label className="setting-label" htmlFor="excludeGlobs">追加除外パターン (glob)</label>
        <div className="setting-desc">ワークスペースで追加除外したいパターンを1行ずつ入力します</div>
        <div className="exclude-textarea">
          <textarea
            id="excludeGlobs"
            placeholder="例: **/tmp/**"
            value={excludeGlobs}
            onChange={(event) => setExcludeGlobs(event.target.value)}
          />
        </div>
      </div>

      <div className="s06-actions">
        <div className="setting-label">初期化</div>
        <div className="setting-desc">保存済みの設定を初期値に戻します</div>
        <button className="btn-gray" onClick={() => send({ type: "resetSettings" })}>
          <span className="material-symbols-outlined">restart_alt</span>
          初期値に戻す
        </button>
      </div>

      {hasPendingChanges && (
        <div className="s06-savebar">
          <div className="s06-savebar-copy">
            <span className="material-symbols-outlined">edit</span>
            <div>
              <div className="s06-savebar-title">変更があります</div>
              <div className="s06-savebar-desc">保存するとこの画面の設定に反映されます</div>
            </div>
          </div>

          <div className="s06-savebar-actions">
            <button className="btn-gray s06-revert-btn" onClick={handleRevertDraft}>
              元に戻す
            </button>
            <button className="s06-save-btn" onClick={handleSave}>
              <span className="material-symbols-outlined">save</span>
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function normalizeExcludeGlobs(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}
