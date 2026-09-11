import type { AutomaticRoutingSettings, AiProviderId } from "../../../shared/types";
import { applyRoutingModeSelection, PROVIDER_IDS, PROVIDER_LABELS } from "../../../services/ProviderRouting";
import { ProviderLogo } from "./ProviderLogo";

export function RoutingSettings({ value, onChange, tested, connectProvider, currentProviderId, disabled }: {
  value: AutomaticRoutingSettings;
  onChange(value: AutomaticRoutingSettings): void;
  tested: AiProviderId[];
  connectProvider(provider: AiProviderId): void;
  currentProviderId: AiProviderId;
  disabled: boolean;
}) {
  const update = (partial: Partial<AutomaticRoutingSettings>) => onChange({ ...value, ...partial });
  const selectMode = (mode: AutomaticRoutingSettings["mode"]) =>
    onChange(applyRoutingModeSelection(value, mode, currentProviderId, tested));
  const enabledProviders = value.allowedProviderIds.filter(id => tested.includes(id));
  const selectProvider = (id: AiProviderId) => {
    if (!tested.includes(id)) return;
    const allowed = value.allowedProviderIds.includes(id)
      ? value.allowedProviderIds.filter(providerId => providerId !== id)
      : [...value.allowedProviderIds, id];
    update({
      allowedProviderIds: allowed,
      preferredProviderId: value.preferredProviderId === id && !allowed.includes(id)
        ? undefined
        : value.preferredProviderId
    });
  };

  return <fieldset className="routing-settings" disabled={disabled}>
    <div className="routing-mode-options" role="group" aria-label="プロバイダー切り替え方式">
      <button type="button" className={`routing-mode-card ${value.mode === "manual" ? "selected" : ""}`} aria-pressed={value.mode === "manual"} onClick={() => selectMode("manual")}>
        <span className="material-symbols-outlined" aria-hidden="true">cable</span>
        <span><strong>手動</strong><small>自分で接続先を選ぶ</small></span>
      </button>
      <button type="button" className={`routing-mode-card ${value.mode === "automaticSuggest" ? "selected" : ""}`} aria-pressed={value.mode === "automaticSuggest"} onClick={() => selectMode("automaticSuggest")}>
        <span className="material-symbols-outlined" aria-hidden="true">smart_toy</span>
        <span><strong>提案型</strong><small>確認してから切り替える</small></span>
      </button>
      <button type="button" className={`routing-mode-card ${value.mode === "automatic" ? "selected" : ""}`} aria-pressed={value.mode === "automatic"} onClick={() => selectMode("automatic")}>
        <span className="material-symbols-outlined" aria-hidden="true">sync</span>
        <span><strong>完全自動型</strong><small>許可範囲で自動切り替え</small></span>
      </button>
    </div>

    {value.mode !== "manual" && <div className="routing-auto-settings">
      <section className="routing-subsection" aria-labelledby="routing-candidates-title">
        <div className="routing-provider-heading">
          <div>
            <strong id="routing-candidates-title">使用するプロバイダー</strong>
            <span>接続済みの中から、自動切り替えを許可するものを選択します。</span>
          </div>
          <span className="routing-provider-count">{enabledProviders.length}件選択中</span>
        </div>
        <div className="routing-provider-grid" role="group" aria-label="使用するプロバイダー">
          {PROVIDER_IDS.map(id => {
            const connected = tested.includes(id);
            const selected = connected && value.allowedProviderIds.includes(id);
            return <div key={id} className={`routing-provider-card ${id} ${selected ? "selected" : ""} ${connected ? "connected" : "unavailable"}`}>
              <button type="button" className="routing-provider-select" aria-pressed={selected} disabled={!connected} onClick={() => selectProvider(id)} title={connected ? `${PROVIDER_LABELS[id]}を${selected ? "候補から外す" : "候補に追加"}` : `${PROVIDER_LABELS[id]}へ接続してください`}>
                <span className="routing-provider-icon-wrap">
                  <ProviderLogo providerId={id} className="routing-provider-logo" />
                  {selected && <span className="routing-provider-selected" aria-hidden="true" />}
                </span>
                <strong>{PROVIDER_LABELS[id]}</strong>
                <small>{connected ? "接続済み" : "未接続"}</small>
              </button>
              {!connected && <button type="button" className="routing-provider-connect" onClick={() => connectProvider(id)}>接続</button>}
            </div>;
          })}
        </div>
        {tested.length === 0 && <p className="routing-provider-empty" role="status">接続済みのプロバイダーがありません。使用するプロバイダーの「接続」を押してください。</p>}
      </section>

      <section className="routing-subsection" aria-labelledby="routing-preferred-title">
        <div className="routing-subsection-heading">
          <strong id="routing-preferred-title">基本プロバイダー</strong>
          <span>新しい相談を始めるときに最初に使用します。</span>
        </div>
        <div className="choice-options routing-preferred-options" role="radiogroup" aria-label="基本プロバイダー">
          <button type="button" role="radio" aria-checked={!value.preferredProviderId} className={`choice-option routing-preferred-option ${currentProviderId} ${!value.preferredProviderId ? "selected" : ""}`} onClick={() => update({ preferredProviderId: undefined })}>
            <span className="routing-preferred-icon-wrap">
              <span className="material-symbols-outlined routing-preferred-current-icon" aria-hidden="true">sync</span>
              {!value.preferredProviderId && <span className="routing-preferred-selected" aria-hidden="true" />}
            </span>
            <span className="routing-preferred-copy"><strong>現在の接続先</strong><small>変更せずに開始</small></span>
          </button>
          {enabledProviders.map(id => <button key={id} type="button" role="radio" aria-checked={value.preferredProviderId === id} className={`choice-option routing-preferred-option ${id} ${value.preferredProviderId === id ? "selected" : ""}`} onClick={() => update({ preferredProviderId: id })}>
            <span className="routing-preferred-icon-wrap">
              <ProviderLogo providerId={id} className="routing-preferred-logo" />
              {value.preferredProviderId === id && <span className="routing-preferred-selected" aria-hidden="true" />}
            </span>
            <span className="routing-preferred-copy"><strong>{PROVIDER_LABELS[id]}</strong><small>新しい相談で使用</small></span>
          </button>)}
        </div>
      </section>

    </div>}
  </fieldset>;
}
