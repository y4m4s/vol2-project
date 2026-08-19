import { type ReactNode, useEffect, useState } from "react";
import { PageHeader, PageTitleWithIcon } from "../webview/components/BackHeader";
import { useApp } from "../webview/state/AppContext";
import { useAutoResizeTextarea } from "../webview/hooks/useAutoResizeTextarea";
import { formatTokenCount } from "../webview/utils/formatUsage";
import type {
  AdviceMode,
  AiProviderId,
  AssistanceDepth,
  CopilotModelOption,
  LmStudioModelOption,
  LmStudioServerViewData
} from "../../shared/types";

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
  const savedLmStudioModelKey = settings?.lmStudioModelKey ?? "";
  const savedIdleDelaySec = settings ? normalizeIdleDelaySec(settings.idleDelayMs / 1000) : 10;
  const savedRequestIntervalSec = settings ? normalizeRequestIntervalSec(settings.requestIntervalMs / 1000) : 60;
  const savedDailyBudgetUsd = settings ? normalizeDailyBudgetUsd(settings.dailyBudgetUsd) : 1.0;
  const savedExcludeGlobs = settings?.excludedGlobs.join("\n") ?? "";

  const [providerId, setProviderId] = useState<AiProviderId>(savedProviderId);
  const [defaultMode, setDefaultMode] = useState<AdviceMode>(savedDefaultMode);
  const [defaultAssistanceDepth, setDefaultAssistanceDepth] = useState<AssistanceDepth>(savedDefaultAssistanceDepth);
  const [copilotModelId, setCopilotModelId] = useState(savedCopilotModelId);
  const [lmStudioModelKey, setLmStudioModelKey] = useState(savedLmStudioModelKey);
  const [idleDelaySec, setIdleDelaySec] = useState(savedIdleDelaySec);
  const [requestIntervalSec, setRequestIntervalSec] = useState(savedRequestIntervalSec);
  const [dailyBudgetUsd, setDailyBudgetUsd] = useState(savedDailyBudgetUsd);
  const [excludeGlobs, setExcludeGlobs] = useState(savedExcludeGlobs);
  const excludeTextareaRef = useAutoResizeTextarea(excludeGlobs);
  const lmStudioModelOptions = viewModel?.lmStudioModelOptions ?? [];
  const lmStudioServer = viewModel?.lmStudioServer ?? {
    state: "checking" as const,
    canStart: false,
    canStop: false,
    message: "LM Studio サーバーの状態を確認しています…"
  };

  useEffect(() => {
    setProviderId(savedProviderId);
    setDefaultMode(savedDefaultMode);
    setDefaultAssistanceDepth(savedDefaultAssistanceDepth);
    setCopilotModelId(savedCopilotModelId);
    setLmStudioModelKey(savedLmStudioModelKey);
    setIdleDelaySec(savedIdleDelaySec);
    setRequestIntervalSec(savedRequestIntervalSec);
    setDailyBudgetUsd(savedDailyBudgetUsd);
    setExcludeGlobs(savedExcludeGlobs);
  }, [savedProviderId, savedDefaultMode, savedDefaultAssistanceDepth, savedCopilotModelId, savedLmStudioModelKey, savedIdleDelaySec, savedRequestIntervalSec, savedDailyBudgetUsd, savedExcludeGlobs, viewModel?.settingsRevision]);

  useEffect(() => {
    if (
      providerId === "lmStudio" &&
      lmStudioModelOptions.length > 0 &&
      !lmStudioModelOptions.some((option) => option.key === lmStudioModelKey)
    ) {
      setLmStudioModelKey(lmStudioModelOptions[0].key);
    }
  }, [providerId, lmStudioModelKey, lmStudioModelOptions]);

  const hasPendingChanges =
    providerId !== savedProviderId ||
    defaultMode !== savedDefaultMode ||
    defaultAssistanceDepth !== savedDefaultAssistanceDepth ||
    copilotModelId !== savedCopilotModelId ||
    lmStudioModelKey !== savedLmStudioModelKey ||
    idleDelaySec !== savedIdleDelaySec ||
    requestIntervalSec !== savedRequestIntervalSec ||
    dailyBudgetUsd !== savedDailyBudgetUsd ||
    normalizeExcludeGlobs(excludeGlobs) !== normalizeExcludeGlobs(savedExcludeGlobs);
  const stopBlockedByPendingChanges =
    hasPendingChanges && savedProviderId === "lmStudio" && lmStudioServer.canStop;
  const lmStudioServerRunning = lmStudioServer.state === "running";

  function handleSave() {
    send({
      type: "saveSettings",
      payload: {
        providerId,
        defaultMode,
        defaultAssistanceDepth,
        copilotModelId: copilotModelId === "auto" ? undefined : copilotModelId,
        lmStudioModelKey: lmStudioModelKey || undefined,
        idleDelaySec,
        requestIntervalSec,
        dailyBudgetUsd,
        excludeGlobs
      }
    });
  }

  function handleRevertDraft() {
    setProviderId(savedProviderId);
    setDefaultMode(savedDefaultMode);
    setDefaultAssistanceDepth(savedDefaultAssistanceDepth);
    setCopilotModelId(savedCopilotModelId);
    setLmStudioModelKey(savedLmStudioModelKey);
    setIdleDelaySec(savedIdleDelaySec);
    setRequestIntervalSec(savedRequestIntervalSec);
    setDailyBudgetUsd(savedDailyBudgetUsd);
    setExcludeGlobs(savedExcludeGlobs);
  }

  function handleProviderChange(nextProviderId: AiProviderId) {
    setProviderId(nextProviderId);
    if (
      nextProviderId === "lmStudio" &&
      lmStudioModelOptions.length > 0 &&
      !lmStudioModelOptions.some((option) => option.key === lmStudioModelKey)
    ) {
      setLmStudioModelKey(lmStudioModelOptions[0].key);
    }
  }

  return (
    <div className={`s06-root ${hasPendingChanges ? "with-savebar" : ""}`}>
      <div className="s06-sticky-top">
        <PageHeader
          title={<PageTitleWithIcon icon="settings">設定</PageTitleWithIcon>}
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
        <SettingTitle icon="cable">接続先</SettingTitle>
        <div className="setting-desc">助言を生成する AI を選択します。</div>
        <ProviderButtonGroup value={providerId} onChange={handleProviderChange} />
      </div>

      {providerId === "lmStudio" && (
        <>
          <LmStudioServerControl
            server={lmStudioServer}
            stopBlockedByPendingChanges={stopBlockedByPendingChanges}
            onRefresh={() => send({ type: "refreshLmStudioServerStatus" })}
            onStart={() => send({ type: "startLmStudioServer" })}
            onStop={() => send({ type: "stopLmStudioServer" })}
          />

          <div className="setting-item">
            <SettingTitle icon="memory">ロード中のモデル</SettingTitle>
            <div className="setting-desc lmstudio-model-note">
              {viewModel?.providerId === "lmStudio" && viewModel.connectionState === "connected"
                ? `接続中: ${viewModel.modelLabel ?? "ロード済みモデル"}`
                : "LM Studio で現在ロード中のモデルをすべて表示し、使用する1つを選択します。"}
            </div>
            <LmStudioModelButtonGroup
              value={lmStudioModelKey}
              options={lmStudioModelOptions}
              disabled={!lmStudioServerRunning}
              onChange={setLmStudioModelKey}
            />
            {lmStudioModelOptions.length === 0 && (
              <div className="setting-desc lmstudio-model-empty">
                {lmStudioServerRunning
                  ? "ロード中のLLMがありません。LM Studioでモデルをロードしてから一覧を更新してください。"
                  : "LM Studio サーバーを起動すると、ロード中のモデルを取得できます。"}
              </div>
            )}
            <button
              type="button"
              className="btn-gray lmstudio-refresh-models"
              disabled={!lmStudioServerRunning}
              onClick={() => send({ type: "refreshLmStudioModels" })}
            >
              <span className="material-symbols-outlined" aria-hidden="true">refresh</span>
              モデル一覧を更新
            </button>
          </div>
        </>
      )}

      <div className="settings-section">
        <span className="material-symbols-outlined">tune</span> モード設定
      </div>

      <div className="setting-item">
        <SettingTitle icon="toggle_on">初期モード</SettingTitle>
        <div className="setting-desc">相談開始時に使用するモードです</div>
        <ModeButtonGroup value={defaultMode} onChange={setDefaultMode} />
      </div>

      <div className="setting-item">
        <SettingTitle icon="travel_explore">既定の深さ</SettingTitle>
        <div className="setting-desc">手動相談で最初に使う助言の深さです。ハイでは関連ファイルとディレクトリ構造も参照します</div>
        <DepthButtonGroup value={defaultAssistanceDepth} onChange={setDefaultAssistanceDepth} />
      </div>

      <div className="settings-section">
        <span className="material-symbols-outlined">speed</span> 助言の頻度
      </div>

      <ScheduleButtonGroup
        id="idleDelay"
        icon="timer"
        label="待ち時間"
        description="操作停止後、自動助言を出すまでの待ち時間です"
        options={IDLE_DELAY_OPTIONS}
        value={idleDelaySec}
        onChange={setIdleDelaySec}
      />

      <ScheduleButtonGroup
        id="requestInterval"
        icon="schedule"
        label="インターバル"
        description="自動助言を出してから次の自動助言までの最短間隔です。長くするほどトークン消費を抑えられます"
        options={REQUEST_INTERVAL_OPTIONS}
        value={requestIntervalSec}
        onChange={setRequestIntervalSec}
      />

      {providerId === "copilot" && (
        <>
          <div className="settings-section">
            <span className="material-symbols-outlined">data_usage</span> 利用量
          </div>

          <div className="setting-item">
            <SettingTitle icon="data_usage">1日の使用上限</SettingTitle>
            <div className="setting-desc">
              上限に達すると自動助言を一時停止します（手動相談は警告のみ）
              {viewModel?.providerId === "copilot" && viewModel.usageToday && (
                <>
                  <br />
                  今日の利用: {viewModel.usageToday.requestCount}回 / 約{formatTokenCount(viewModel.usageToday.totalTokens)}トークン（目安 {viewModel.usageToday.estimatedCostText}）
                </>
              )}
            </div>
            <BudgetButtonGroup
              value={dailyBudgetUsd}
              onChange={setDailyBudgetUsd}
              pricePerMTokenUsd={viewModel?.providerId === "copilot" ? viewModel.usageToday.blendedPricePerMTokenUsd : undefined}
            />
          </div>
        </>
      )}

      {providerId === "copilot" && (
        <div className="setting-item">
          <SettingTitle icon="smart_toy">使用モデル</SettingTitle>
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
        <SettingTitle icon="shield_lock">保護済みパターン</SettingTitle>
        <div className="setting-desc">機密性やサイズの観点から常に除外されるパターンです</div>
        <div className="protected-exclude-list">
          {settings?.protectedExcludedGlobs.join("\n") ?? ""}
        </div>
      </div>

      <div className="setting-item">
        <SettingTitle icon="playlist_remove" htmlFor="excludeGlobs">追加除外パターン (glob)</SettingTitle>
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
        <SettingTitle icon="restart_alt">初期化</SettingTitle>
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
  icon,
  label,
  description,
  options,
  value,
  onChange
}: {
  id: string;
  icon: string;
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
          <SettingTitle id={`${id}-label`} icon={icon}>{label}</SettingTitle>
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

function LmStudioModelButtonGroup({
  value,
  options,
  disabled,
  onChange
}: {
  value: string;
  options: LmStudioModelOption[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  if (options.length === 0) {
    return null;
  }

  return (
    <div className="choice-options model-options lmstudio-model-options" role="radiogroup" aria-label="LM Studio の使用モデルを1つ選択">
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            className={`choice-option ${selected ? "selected" : ""}`}
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.key)}
          >
            <span className="model-option-name">{option.label}</span>
            <span className="model-option-meta">{option.key}</span>
          </button>
        );
      })}
    </div>
  );
}

function SettingTitle({
  icon,
  children,
  id,
  htmlFor
}: {
  icon: string;
  children: ReactNode;
  id?: string;
  htmlFor?: string;
}) {
  const content = (
    <>
      <span className="material-symbols-outlined setting-title-icon" aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </>
  );

  return htmlFor ? (
    <label id={id} className="setting-label setting-title" htmlFor={htmlFor}>{content}</label>
  ) : (
    <div id={id} className="setting-label setting-title">{content}</div>
  );
}

function LmStudioServerControl({
  server,
  stopBlockedByPendingChanges,
  onRefresh,
  onStart,
  onStop
}: {
  server: LmStudioServerViewData;
  stopBlockedByPendingChanges: boolean;
  onRefresh: () => void;
  onStart: () => void;
  onStop: () => void;
}) {
  const isTransitioning = server.state === "checking" || server.state === "starting" || server.state === "stopping";
  const showStop = server.state === "running" || (server.state === "error" && server.canStop);
  const actionDisabled = showStop
    ? !server.canStop || stopBlockedByPendingChanges
    : !server.canStart;
  const statusIcon = getLmStudioServerStatusIcon(server.state);
  const statusText = server.message ?? getLmStudioServerStatusText(server);
  const actionIcon = isTransitioning
    ? "progress_activity"
    : showStop
      ? "stop_circle"
      : "power_settings_new";
  const actionText = server.state === "starting"
    ? "起動しています…"
    : server.state === "stopping"
      ? "停止しています…"
      : server.state === "checking"
        ? "確認しています…"
        : showStop
          ? "サーバーを停止"
          : "サーバーを起動";
  const showRefresh = server.state === "cliUnavailable" || server.state === "portConflict" || server.state === "error";

  return (
    <div className="setting-item lmstudio-server-card" aria-busy={isTransitioning}>
      <SettingTitle icon="dns">LM Studio サーバー</SettingTitle>
      <div className={`lmstudio-server-status state-${server.state}`} aria-live="polite">
        <span
          className={`material-symbols-outlined lmstudio-server-status-icon${isTransitioning ? " is-spinning" : ""}`}
          aria-hidden="true"
        >
          {statusIcon}
        </span>
        <div className="lmstudio-server-status-copy">{statusText}</div>
      </div>
      <button
        type="button"
        className="btn-gray lmstudio-server-action"
        disabled={actionDisabled || isTransitioning}
        aria-disabled={actionDisabled || isTransitioning}
        onClick={showStop ? onStop : onStart}
      >
        <span
          className={`material-symbols-outlined${isTransitioning ? " is-spinning" : ""}`}
          aria-hidden="true"
        >
          {actionIcon}
        </span>
        {actionText}
      </button>
      {showStop && (
        <div className="setting-desc lmstudio-server-help">
          停止すると、ほかのアプリからの LM Studio 接続も切断されます。
        </div>
      )}
      {showRefresh && (
        <button type="button" className="lmstudio-server-refresh" onClick={onRefresh}>
          <span className="material-symbols-outlined" aria-hidden="true">refresh</span>
          状態を再確認
        </button>
      )}
    </div>
  );
}

function getLmStudioServerStatusIcon(state: LmStudioServerViewData["state"]): string {
  switch (state) {
    case "running":
      return "check_circle";
    case "stopped":
      return "power_off";
    case "checking":
    case "starting":
    case "stopping":
      return "progress_activity";
    case "cliUnavailable":
      return "terminal_off";
    case "portConflict":
      return "device_unknown";
    case "error":
    default:
      return "error";
  }
}

function getLmStudioServerStatusText(server: LmStudioServerViewData): string {
  switch (server.state) {
    case "running":
      return `起動中${server.port ? ` · localhost:${server.port}` : ""}`;
    case "stopped":
      return "停止中";
    case "starting":
      return "LM Studio サーバーを起動しています…";
    case "stopping":
      return "LM Studio サーバーを停止しています…";
    case "checking":
      return "LM Studio サーバーの状態を確認しています…";
    case "cliUnavailable":
      return "LM Studio CLI が見つかりません。";
    case "portConflict":
      return "接続ポートが別のアプリで使用されています。";
    case "error":
    default:
      return "LM Studio サーバーを操作できませんでした。";
  }
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
