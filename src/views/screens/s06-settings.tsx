import React, { useEffect, useRef, useState } from "react";
import { PageHeader } from "../webview/components/BackHeader";
import { useApp } from "../webview/state/AppContext";
import type { AdviceMode } from "../../shared/types";

const IDLE_DELAY_OPTIONS = [5, 10, 15];
const MODE_OPTIONS: Array<{ value: AdviceMode; label: string }> = [
  { value: "manual", label: "必要時" },
  { value: "always", label: "常時" }
];

export function S06Settings() {
  const { viewModel, send } = useApp();
  const settings = viewModel?.settings;

  const savedDefaultMode = settings?.defaultMode ?? "manual";
  const savedIdleDelaySec = settings ? normalizeIdleDelaySec(settings.idleDelayMs / 1000) : 10;
  const savedExcludeGlobs = settings?.excludedGlobs.join("\n") ?? "";

  const [defaultMode, setDefaultMode] = useState<AdviceMode>(savedDefaultMode);
  const [idleDelaySec, setIdleDelaySec] = useState(savedIdleDelaySec);
  const [excludeGlobs, setExcludeGlobs] = useState(savedExcludeGlobs);
  const excludeTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDefaultMode(savedDefaultMode);
    setIdleDelaySec(savedIdleDelaySec);
    setExcludeGlobs(savedExcludeGlobs);
  }, [savedDefaultMode, savedIdleDelaySec, savedExcludeGlobs]);

  useEffect(() => {
    const el = excludeTextareaRef.current;
    if (!el) {
      return;
    }

    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [excludeGlobs]);

  const hasPendingChanges =
    defaultMode !== savedDefaultMode ||
    idleDelaySec !== savedIdleDelaySec ||
    normalizeExcludeGlobs(excludeGlobs) !== normalizeExcludeGlobs(savedExcludeGlobs);

  function handleSave() {
    send({
      type: "saveSettings",
      payload: {
        defaultMode,
        idleDelaySec,
        excludeGlobs
      }
    });
  }

  function handleRevertDraft() {
    setDefaultMode(savedDefaultMode);
    setIdleDelaySec(savedIdleDelaySec);
    setExcludeGlobs(savedExcludeGlobs);
  }

  return (
    <div className={`s06-root ${hasPendingChanges ? "with-savebar" : ""}`}>
      <PageHeader title="設定" subtitle="NaviCom の動作と除外パターンを設定できます" />

      <div className="settings-section">
        <span className="material-symbols-outlined">tune</span> モード設定
      </div>

      <div className="setting-item">
        <div className="setting-label">初期モード</div>
        <div className="setting-desc">相談開始時に使用するモードです</div>
        <ModeButtonGroup value={defaultMode} onChange={setDefaultMode} />
      </div>

      <div className="settings-section">
        <span className="material-symbols-outlined">speed</span> 助言の頻度
      </div>

      <ScheduleButtonGroup
        id="idleDelay"
        label="待ち時間"
        description="操作停止後、自動助言を出すまでの待ち時間です"
        value={idleDelaySec}
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
            ref={excludeTextareaRef}
            id="excludeGlobs"
            placeholder="例: **/tmp/**"
            rows={3}
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

function normalizeIdleDelaySec(value: number): number {
  return IDLE_DELAY_OPTIONS.reduce((nearest, option) =>
    Math.abs(option - value) < Math.abs(nearest - value) ? option : nearest
  );
}

function ModeButtonGroup({
  value,
  onChange
}: {
  value: AdviceMode;
  onChange: (value: AdviceMode) => void;
}) {
  return (
    <div className="choice-options mode-options" role="group" aria-label="初期モード">
      {MODE_OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={`choice-option ${selected ? "selected" : ""}`}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ScheduleButtonGroup({
  id,
  label,
  description,
  value,
  onChange
}: {
  id: string;
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="schedule-group" role="group" aria-labelledby={`${id}-label`}>
      <div className="schedule-header">
        <div>
          <div id={`${id}-label`} className="setting-label">{label}</div>
          <div className="setting-desc">{description}</div>
        </div>
      </div>

      <div className="choice-options schedule-options">
        {IDLE_DELAY_OPTIONS.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              className={`choice-option ${selected ? "selected" : ""}`}
              aria-pressed={selected}
              onClick={() => onChange(option)}
            >
              {option}秒
            </button>
          );
        })}
      </div>
    </div>
  );
}
