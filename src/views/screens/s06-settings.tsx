import { useEffect, useState } from "react";
import { PageHeader } from "../webview/components/BackHeader";
import { useAutoResizeTextarea } from "../webview/hooks/useAutoResizeTextarea";
import { useApp } from "../webview/state/AppContext";
import type { AdviceMode, AiProviderId, AssistanceDepth, CopilotModelOption } from "../../shared/types";

const IDLE_DELAY_OPTIONS = [5, 10, 15];
const REQUEST_INTERVAL_OPTIONS = [20, 60, 180];
const DAILY_BUDGET_OPTIONS = [0.5, 1, 2, 0];

export function S06Settings() {
  const { viewModel, send } = useApp();
  const settings = viewModel?.settings;

  const savedProviderId = settings?.providerId ?? "copilot";
  const savedDefaultMode = settings?.defaultMode ?? "manual";
  const savedDepth = settings?.defaultAssistanceDepth ?? "low";
  const savedCopilotModelId = settings?.copilotModelId ?? "auto";
  const savedLmStudioBaseUrl = settings?.lmStudioBaseUrl ?? "http://127.0.0.1:1234";
  const savedIdleDelay = settings ? normalizeOption(settings.idleDelayMs / 1000, IDLE_DELAY_OPTIONS) : 10;
  const savedInterval = settings ? normalizeOption(settings.requestIntervalMs / 1000, REQUEST_INTERVAL_OPTIONS) : 60;
  const savedBudget = settings ? normalizeOption(settings.dailyBudgetUsd, DAILY_BUDGET_OPTIONS) : 1;
  const savedExcludes = settings?.excludedGlobs.join("\n") ?? "";

  const [providerId, setProviderId] = useState<AiProviderId>(savedProviderId);
  const [defaultMode, setDefaultMode] = useState<AdviceMode>(savedDefaultMode);
  const [depth, setDepth] = useState<AssistanceDepth>(savedDepth);
  const [copilotModelId, setCopilotModelId] = useState(savedCopilotModelId);
  const [lmStudioBaseUrl, setLmStudioBaseUrl] = useState(savedLmStudioBaseUrl);
  const [lmStudioToken, setLmStudioToken] = useState("");
  const [idleDelaySec, setIdleDelaySec] = useState(savedIdleDelay);
  const [requestIntervalSec, setRequestIntervalSec] = useState(savedInterval);
  const [dailyBudgetUsd, setDailyBudgetUsd] = useState(savedBudget);
  const [excludeGlobs, setExcludeGlobs] = useState(savedExcludes);
  const excludeTextareaRef = useAutoResizeTextarea(excludeGlobs);

  useEffect(() => {
    setProviderId(savedProviderId);
    setDefaultMode(savedDefaultMode);
    setDepth(savedDepth);
    setCopilotModelId(savedCopilotModelId);
    setLmStudioBaseUrl(savedLmStudioBaseUrl);
    setIdleDelaySec(savedIdleDelay);
    setRequestIntervalSec(savedInterval);
    setDailyBudgetUsd(savedBudget);
    setExcludeGlobs(savedExcludes);
  }, [savedProviderId, savedDefaultMode, savedDepth, savedCopilotModelId, savedLmStudioBaseUrl, savedIdleDelay, savedInterval, savedBudget, savedExcludes]);

  const hasPendingChanges =
    providerId !== savedProviderId ||
    defaultMode !== savedDefaultMode ||
    depth !== savedDepth ||
    copilotModelId !== savedCopilotModelId ||
    lmStudioBaseUrl.trim() !== savedLmStudioBaseUrl ||
    idleDelaySec !== savedIdleDelay ||
    requestIntervalSec !== savedInterval ||
    dailyBudgetUsd !== savedBudget ||
    normalizeLines(excludeGlobs) !== normalizeLines(savedExcludes) ||
    Boolean(lmStudioToken.trim());

  function handleSave() {
    send({
      type: "saveSettings",
      payload: {
        providerId,
        defaultMode,
        defaultAssistanceDepth: depth,
        copilotModelId: copilotModelId === "auto" ? undefined : copilotModelId,
        lmStudioBaseUrl,
        lmStudioToken: lmStudioToken.trim() || undefined,
        idleDelaySec,
        requestIntervalSec,
        dailyBudgetUsd,
        excludeGlobs
      }
    });
    setLmStudioToken("");
  }

  function handleRevert() {
    setProviderId(savedProviderId);
    setDefaultMode(savedDefaultMode);
    setDepth(savedDepth);
    setCopilotModelId(savedCopilotModelId);
    setLmStudioBaseUrl(savedLmStudioBaseUrl);
    setLmStudioToken("");
    setIdleDelaySec(savedIdleDelay);
    setRequestIntervalSec(savedInterval);
    setDailyBudgetUsd(savedBudget);
    setExcludeGlobs(savedExcludes);
  }

  return (
    <div className={`s06-root ${hasPendingChanges ? "with-savebar" : ""}`}>
      <div className="s06-sticky-top">
        <PageHeader
          title="設定"
          subtitle="NaviCom の接続先と利用方法を設定します"
          navIcons={[
            { icon: "history", title: "履歴", onClick: () => send({ type: "navigate", screen: "history" }) },
            { icon: "book", title: "ナレッジ", onClick: () => send({ type: "navigate", screen: "knowledge" }) },
            { icon: "add_comment", title: "新しい会話", onClick: () => send({ type: "navigate", screen: "main" }) }
          ]}
        />
      </div>

      <Section icon="hub" title="AI プロバイダー" />
      <div className="setting-item">
        <div className="setting-label">接続先</div>
        <div className="setting-desc">助言を生成する AI を選択します。</div>
        <ChoiceGroup value={providerId} onChange={setProviderId} options={[
          { value: "copilot", label: "GitHub Copilot", description: "VS Code の Copilot を利用" },
          { value: "lmStudio", label: "LM Studio", description: "ローカルでロードしたモデルを利用" }
        ]} />
      </div>

      {providerId === "copilot" ? (
        <div className="setting-item">
          <div className="setting-label">Copilot の使用モデル</div>
          <div className="setting-desc">自動、または VS Code で利用可能な Copilot モデルを選びます。</div>
          <CopilotModelChoices value={copilotModelId} onChange={setCopilotModelId} options={viewModel?.copilotModelOptions ?? []} />
        </div>
      ) : (
        <>
          <div className="setting-item">
            <label className="setting-label" htmlFor="lmStudioBaseUrl">LM Studio の Base URL</label>
            <div className="setting-desc">localhost、127.0.0.1、::1 だけを指定できます。</div>
            <input
              id="lmStudioBaseUrl"
              className="setting-text-input"
              value={lmStudioBaseUrl}
              placeholder="http://127.0.0.1:1234"
              onChange={(event) => setLmStudioBaseUrl(event.target.value)}
            />
          </div>
          <div className="setting-item">
            <label className="setting-label" htmlFor="lmStudioToken">API トークン（任意）</label>
            <div className="setting-desc">空欄で保存しても、保存済みトークンは保持されます。</div>
            <input
              id="lmStudioToken"
              className="setting-text-input"
              type="password"
              value={lmStudioToken}
              autoComplete="new-password"
              onChange={(event) => setLmStudioToken(event.target.value)}
            />
            <button className="btn-gray" onClick={() => { setLmStudioToken(""); send({ type: "deleteLmStudioToken" }); }}>
              トークンを削除
            </button>
          </div>
          <div className="setting-item">
            <div className="setting-label">使用モデル</div>
            <div className="setting-desc">LM Studio からロード済みモデルを自動検知します。モデル ID の入力や常設の選択欄はありません。</div>
          </div>
        </>
      )}

      <Section icon="tune" title="助言" />
      <div className="setting-item">
        <div className="setting-label">初期モード</div>
        <ChoiceGroup value={defaultMode} onChange={setDefaultMode} options={[
          { value: "manual", label: "手動", description: "必要なときに助言を求める" },
          { value: "always", label: "常時", description: "編集後に助言を表示する" }
        ]} />
      </div>
      <div className="setting-item">
        <div className="setting-label">初期の助言の深さ</div>
        <ChoiceGroup value={depth} onChange={setDepth} options={[
          { value: "low", label: "ロー", description: "短いヒント中心" },
          { value: "high", label: "ハイ", description: "構造化して詳しく確認" }
        ]} />
      </div>

      <Section icon="speed" title="自動助言" />
      <OptionButtons label="待機時間" value={idleDelaySec} options={IDLE_DELAY_OPTIONS} suffix="秒" onChange={setIdleDelaySec} />
      <OptionButtons label="リクエスト間隔" value={requestIntervalSec} options={REQUEST_INTERVAL_OPTIONS} suffix="秒" onChange={setRequestIntervalSec} />

      <Section icon="data_usage" title="利用量" />
      <OptionButtons label="Copilot の日次予算" value={dailyBudgetUsd} options={DAILY_BUDGET_OPTIONS} suffix="$" onChange={setDailyBudgetUsd} />
      {providerId === "lmStudio" && <div className="setting-desc">LM Studio の推定料金は $0 で、日次予算の対象外です。</div>}

      <Section icon="block" title="コンテキスト除外" />
      <div className="setting-item">
        <div className="setting-label">保護済みパターン</div>
        <div className="protected-exclude-list">{settings?.protectedExcludedGlobs.join("\n") ?? ""}</div>
      </div>
      <div className="setting-item">
        <label className="setting-label" htmlFor="excludeGlobs">追加の除外パターン（glob）</label>
        <textarea
          ref={excludeTextareaRef}
          id="excludeGlobs"
          className="setting-textarea"
          rows={3}
          value={excludeGlobs}
          onChange={(event) => setExcludeGlobs(event.target.value)}
        />
      </div>

      <div className="s06-actions">
        <button className="btn-gray" onClick={() => send({ type: "resetSettings" })}>設定を初期値に戻す</button>
      </div>

      {hasPendingChanges && (
        <div className="s06-savebar">
          <div className="s06-savebar-copy"><span className="material-symbols-outlined">edit</span><div>変更があります</div></div>
          <div className="s06-savebar-actions">
            <button className="btn-gray" onClick={handleRevert}>元に戻す</button>
            <button className="s06-save-btn" onClick={handleSave}><span className="material-symbols-outlined">save</span>保存</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ icon, title }: { icon: string; title: string }) {
  return <div className="settings-section"><span className="material-symbols-outlined">{icon}</span>{title}</div>;
}

function ChoiceGroup<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string; description: string }> }) {
  return <div className="choice-options mode-options" role="group">{options.map((option) => (
    <button key={option.value} type="button" className={`choice-option ${value === option.value ? "selected" : ""}`} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
      <span className="model-option-name">{option.label}</span><span className="model-option-meta">{option.description}</span>
    </button>
  ))}</div>;
}

function CopilotModelChoices({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: CopilotModelOption[] }) {
  const allOptions = value !== "auto" && !options.some((option) => option.id === value)
    ? [...options, { id: value, label: "保存済みモデル", tokenLimitText: "現在は利用できません" }]
    : options;
  return <div className="choice-options model-options" role="group">
    <button type="button" className={`choice-option ${value === "auto" ? "selected" : ""}`} onClick={() => onChange("auto")}><span className="model-option-name">自動</span><span className="model-option-meta">低コストモデルを優先</span></button>
    {allOptions.map((option) => <button key={option.id} type="button" className={`choice-option ${value === option.id ? "selected" : ""}`} onClick={() => onChange(option.id)}><span className="model-option-name">{option.label}</span><span className="model-option-meta">{option.tokenLimitText}</span></button>)}
  </div>;
}

function OptionButtons({ label, value, options, suffix, onChange }: { label: string; value: number; options: number[]; suffix: string; onChange: (value: number) => void }) {
  const layoutClassName = options.length === 3 ? "schedule-options" : "mode-options";
  return <div className="setting-item"><div className="setting-label">{label}</div><div className={`choice-options ${layoutClassName}`}>{options.map((option) => <button key={option} type="button" className={`choice-option ${option === value ? "selected" : ""}`} onClick={() => onChange(option)}>{suffix === "$" ? `$${option.toFixed(2)}` : `${option}${suffix}`}</button>)}</div></div>;
}

function normalizeLines(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join("\n");
}

function normalizeOption(value: number, options: number[]): number {
  return options.reduce((nearest, option) => Math.abs(option - value) < Math.abs(nearest - value) ? option : nearest, options[0]);
}
