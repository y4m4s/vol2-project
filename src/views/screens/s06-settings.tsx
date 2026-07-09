import { useEffect, useState } from "react";
import { PageHeader } from "../webview/components/BackHeader";
import { useApp } from "../webview/state/AppContext";
import { useAutoResizeTextarea } from "../webview/hooks/useAutoResizeTextarea";
import { formatTokenCount } from "../webview/utils/formatUsage";
import type { AdviceMode, AiProviderId, AssistanceDepth, CopilotModelOption } from "../../shared/types";

const IDLE_DELAY_OPTIONS = [5, 10, 15];
const REQUEST_INTERVAL_OPTIONS = [20, 60, 180];
const DAILY_BUDGET_USD_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0.5, label: "節約 $0.50" },
  { value: 1.0, label: "標準 $1.00" },
  { value: 2.0, label: "多め $2.00" },
  { value: 0, label: "無制限" }
];
const MODE_OPTIONS: Array<{ value: AdviceMode; label: string }> = [
  { value: "manual", label: "必要時" },
  { value: "always", label: "常時" }
];
const DEPTH_OPTIONS: Array<{ value: AssistanceDepth; label: string }> = [
  { value: "low", label: "ロウ" },
  { value: "high", label: "ハイ" }
];

export function S06Settings() {
  const { viewModel, send } = useApp();
  const settings = viewModel?.settings;

  const savedProviderId = settings?.providerId ?? "copilot";
  const savedDefaultMode = settings?.defaultMode ?? "manual";
  const savedDefaultAssistanceDepth = settings?.defaultAssistanceDepth ?? "low";
  const savedCopilotModelId = settings?.copilotModelId ?? "auto";
  const savedLmStudioBaseUrl = settings?.lmStudioBaseUrl ?? "http://127.0.0.1:1234";
  const savedIdleDelaySec = settings ? normalizeIdleDelaySec(settings.idleDelayMs / 1000) : 10;
  const savedRequestIntervalSec = settings ? normalizeRequestIntervalSec(settings.requestIntervalMs / 1000) : 60;
  const savedDailyBudgetUsd = settings ? normalizeDailyBudgetUsd(settings.dailyBudgetUsd) : 1.0;
  const savedExcludeGlobs = settings?.excludedGlobs.join("\n") ?? "";

  const [providerId, setProviderId] = useState<AiProviderId>(savedProviderId);
  const [defaultMode, setDefaultMode] = useState<AdviceMode>(savedDefaultMode);
  const [defaultAssistanceDepth, setDefaultAssistanceDepth] = useState<AssistanceDepth>(savedDefaultAssistanceDepth);
  const [copilotModelId, setCopilotModelId] = useState(savedCopilotModelId);
  const [lmStudioBaseUrl, setLmStudioBaseUrl] = useState(savedLmStudioBaseUrl);
  const [lmStudioToken, setLmStudioToken] = useState("");
  const [idleDelaySec, setIdleDelaySec] = useState(savedIdleDelaySec);
  const [requestIntervalSec, setRequestIntervalSec] = useState(savedRequestIntervalSec);
  const [dailyBudgetUsd, setDailyBudgetUsd] = useState(savedDailyBudgetUsd);
  const [excludeGlobs, setExcludeGlobs] = useState(savedExcludeGlobs);
  const excludeTextareaRef = useAutoResizeTextarea(excludeGlobs);

  useEffect(() => {
    setProviderId(savedProviderId);
    setDefaultMode(savedDefaultMode);
    setDefaultAssistanceDepth(savedDefaultAssistanceDepth);
    setCopilotModelId(savedCopilotModelId);
    setLmStudioBaseUrl(savedLmStudioBaseUrl);
    setIdleDelaySec(savedIdleDelaySec);
    setRequestIntervalSec(savedRequestIntervalSec);
    setDailyBudgetUsd(savedDailyBudgetUsd);
    setExcludeGlobs(savedExcludeGlobs);
  }, [savedProviderId, savedDefaultMode, savedDefaultAssistanceDepth, savedCopilotModelId, savedLmStudioBaseUrl, savedIdleDelaySec, savedRequestIntervalSec, savedDailyBudgetUsd, savedExcludeGlobs]);

  const hasPendingChanges =
    providerId !== savedProviderId ||
    defaultMode !== savedDefaultMode ||
    defaultAssistanceDepth !== savedDefaultAssistanceDepth ||
    copilotModelId !== savedCopilotModelId ||
    lmStudioBaseUrl.trim() !== savedLmStudioBaseUrl ||
    idleDelaySec !== savedIdleDelaySec ||
    requestIntervalSec !== savedRequestIntervalSec ||
    dailyBudgetUsd !== savedDailyBudgetUsd ||
    normalizeExcludeGlobs(excludeGlobs) !== normalizeExcludeGlobs(savedExcludeGlobs) ||
    Boolean(lmStudioToken.trim());

  function handleSave() {
    send({
      type: "saveSettings",
      payload: {
        providerId,
        defaultMode,
        defaultAssistanceDepth,
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

  function handleRevertDraft() {
    setProviderId(savedProviderId);
    setDefaultMode(savedDefaultMode);
    setDefaultAssistanceDepth(savedDefaultAssistanceDepth);
    setCopilotModelId(savedCopilotModelId);
    setLmStudioBaseUrl(savedLmStudioBaseUrl);
    setLmStudioToken("");
    setIdleDelaySec(savedIdleDelaySec);
    setRequestIntervalSec(savedRequestIntervalSec);
    setDailyBudgetUsd(savedDailyBudgetUsd);
    setExcludeGlobs(savedExcludeGlobs);
  }

  return (
    <div className={`s06-root ${hasPendingChanges ? "with-savebar" : ""}`}>
      <div className="s06-sticky-top">
        <PageHeader
          title="設定"
          subtitle="NaviCom の動作と除外パターンを設定できます"
          navIcons={[
            { icon: "history", title: "会話履歴", onClick: () => send({ type: "navigate", screen: "history" }) },
            { icon: "book", title: "ナレッジ", onClick: () => send({ type: "navigate", screen: "knowledge" }) },
            { icon: "add_comment", title: "新しい相談", onClick: () => send({ type: "navigate", screen: "main" }) },
          ]}
        />
      </div>

      <div className="settings-section">
        <span className="material-symbols-outlined">hub</span> AI 接続
      </div>

      <div className="setting-item">
        <div className="setting-label">接続先</div>
        <div className="setting-desc">助言を生成する AI を選択します。</div>
        <ProviderButtonGroup value={providerId} onChange={setProviderId} />
      </div>

      {providerId === "lmStudio" && (
        <div className="setting-item">
          <label className="setting-label" htmlFor="lmStudioBaseUrl">LM Studio の Base URL</label>
          <div className="setting-desc">localhost、127.0.0.1、::1 だけを指定できます。</div>
          <input
            id="lmStudioBaseUrl"
            className="lmstudio-input"
            value={lmStudioBaseUrl}
            placeholder="http://127.0.0.1:1234"
            onChange={(event) => setLmStudioBaseUrl(event.target.value)}
          />

          <label className="setting-label lmstudio-token-label" htmlFor="lmStudioToken">API トークン（任意）</label>
          <div className="setting-desc">空欄で保存しても、保存済みトークンは保持されます。</div>
          <input
            id="lmStudioToken"
            className="lmstudio-input"
            type="password"
            autoComplete="new-password"
            value={lmStudioToken}
            onChange={(event) => setLmStudioToken(event.target.value)}
          />
          <button
            type="button"
            className="btn-gray lmstudio-delete-token"
            onClick={() => {
              setLmStudioToken("");
              send({ type: "deleteLmStudioToken" });
            }}
          >
            トークンを削除
          </button>

          <div className="setting-desc lmstudio-model-note">
            使用モデルは LM Studio のロード済みモデルから自動検出します。
          </div>
        </div>
      )}

      <div className="settings-section">
        <span className="material-symbols-outlined">tune</span> モード設定
      </div>

      <div className="setting-item">
        <div className="setting-label">初期モード</div>
        <div className="setting-desc">相談開始時に使用するモードです</div>
        <ModeButtonGroup value={defaultMode} onChange={setDefaultMode} />
      </div>

      <div className="setting-item">
        <div className="setting-label">既定の深さ</div>
        <div className="setting-desc">手動相談で最初に使う助言の深さです。ハイでは関連ファイルとディレクトリ構造も参照します</div>
        <DepthButtonGroup value={defaultAssistanceDepth} onChange={setDefaultAssistanceDepth} />
      </div>

      <div className="settings-section">
        <span className="material-symbols-outlined">speed</span> 助言の頻度
      </div>

      <ScheduleButtonGroup
        id="idleDelay"
        label="待ち時間"
        description="操作停止後、自動助言を出すまでの待ち時間です"
        options={IDLE_DELAY_OPTIONS}
        value={idleDelaySec}
        onChange={setIdleDelaySec}
      />

      <ScheduleButtonGroup
        id="requestInterval"
        label="インターバル"
        description="自動助言を出してから次の自動助言までの最短間隔です。長くするほどトークン消費を抑えられます"
        options={REQUEST_INTERVAL_OPTIONS}
        value={requestIntervalSec}
        onChange={setRequestIntervalSec}
      />

      <div className="settings-section">
        <span className="material-symbols-outlined">data_usage</span> 利用量
      </div>

      <div className="setting-item">
        <div className="setting-label">1日の使用上限</div>
        <div className="setting-desc">
          上限に達すると自動助言を一時停止します（手動相談は警告のみ）
          {viewModel?.usageToday && (
            <>
              <br />
              今日の利用: {viewModel.usageToday.requestCount}回 / 約{formatTokenCount(viewModel.usageToday.totalTokens)}トークン（目安 {viewModel.usageToday.estimatedCostText}）
            </>
          )}
        </div>
        <BudgetButtonGroup
          value={dailyBudgetUsd}
          onChange={setDailyBudgetUsd}
          pricePerMTokenUsd={viewModel?.usageToday?.blendedPricePerMTokenUsd}
        />
      </div>

      {providerId === "copilot" && (
      <div className="setting-item">
        <div className="setting-label">使用モデル</div>
        <div className="setting-desc">
          自動では GitHub Copilot の自動モデルルーティングを使用します
          <br />
          文脈上限は、一度に参照できる入力文脈量の目安です
        </div>
        <ModelButtonGroup
          value={copilotModelId}
          onChange={setCopilotModelId}
          options={viewModel?.copilotModelOptions ?? []}
        />
      </div>
      )}

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

function normalizeRequestIntervalSec(value: number): number {
  return REQUEST_INTERVAL_OPTIONS.reduce((nearest, option) =>
    Math.abs(option - value) < Math.abs(nearest - value) ? option : nearest
  );
}

function normalizeDailyBudgetUsd(value: number): number {
  return DAILY_BUDGET_USD_OPTIONS.reduce((nearest, option) =>
    Math.abs(option.value - value) < Math.abs(nearest.value - value) ? option : nearest
  , DAILY_BUDGET_USD_OPTIONS[0]).value;
}

function ProviderButtonGroup({
  value,
  onChange
}: {
  value: AiProviderId;
  onChange: (value: AiProviderId) => void;
}) {
  return (
    <div className="choice-options mode-options" role="group" aria-label="接続先">
      <button
        type="button"
        className={`choice-option ${value === "copilot" ? "selected" : ""}`}
        aria-pressed={value === "copilot"}
        onClick={() => onChange("copilot")}
      >
        GitHub Copilot
      </button>
      <button
        type="button"
        className={`choice-option ${value === "lmStudio" ? "selected" : ""}`}
        aria-pressed={value === "lmStudio"}
        onClick={() => onChange("lmStudio")}
      >
        LM Studio
      </button>
    </div>
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

function DepthButtonGroup({
  value,
  onChange
}: {
  value: AssistanceDepth;
  onChange: (value: AssistanceDepth) => void;
}) {
  return (
    <div className="choice-options mode-options" role="group" aria-label="既定の深さ">
      {DEPTH_OPTIONS.map((option) => {
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
  options,
  value,
  onChange
}: {
  id: string;
  label: string;
  description: string;
  options: number[];
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
        {options.map((option) => {
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

function ModelButtonGroup({
  value,
  onChange,
  options
}: {
  value: string;
  onChange: (value: string) => void;
  options: CopilotModelOption[];
}) {
  const selectedModelIsMissing = value !== "auto" && !options.some((option) => option.id === value);
  const modelOptions = selectedModelIsMissing
    ? [...options, { id: value, label: "指定モデル", tokenLimitText: "現在のモデル一覧にありません" }]
    : options;

  return (
    <div className="choice-options model-options" role="group" aria-label="使用モデル">
      <button
        type="button"
        className={`choice-option ${value === "auto" ? "selected" : ""}`}
        aria-pressed={value === "auto"}
        onClick={() => onChange("auto")}
      >
        <span className="model-option-name">自動</span>
        <span className="model-option-meta">Copilot 自動</span>
      </button>

      {modelOptions.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            className={`choice-option ${selected ? "selected" : ""}`}
            aria-pressed={selected}
            onClick={() => onChange(option.id)}
          >
            <span className="model-option-name">{option.label}</span>
            <span className="model-option-meta">{option.tokenLimitText}</span>
          </button>
        );
      })}
    </div>
  );
}

function BudgetButtonGroup({
  value,
  onChange,
  pricePerMTokenUsd
}: {
  value: number;
  onChange: (value: number) => void;
  pricePerMTokenUsd?: number;
}) {
  return (
    <div className="choice-options mode-options" role="group" aria-label="1日の使用上限">
      {DAILY_BUDGET_USD_OPTIONS.map((option) => {
        const selected = option.value === value;
        const tokenText = formatBudgetTokenEquivalent(option.value, pricePerMTokenUsd);
        return (
          <button
            key={option.value}
            type="button"
            className={`choice-option ${selected ? "selected" : ""}`}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
          >
            <span>{option.label}</span>
            {tokenText && <span className="choice-option-sub">{tokenText}</span>}
          </button>
        );
      })}
    </div>
  );
}

function formatBudgetTokenEquivalent(budgetUsd: number, pricePerMTokenUsd?: number): string | undefined {
  if (budgetUsd <= 0 || pricePerMTokenUsd === undefined || pricePerMTokenUsd <= 0) {
    return undefined;
  }

  const tokens = (budgetUsd / pricePerMTokenUsd) * 1_000_000;
  return `約${formatTokenCount(Math.round(tokens))}トークン相当`;
}
