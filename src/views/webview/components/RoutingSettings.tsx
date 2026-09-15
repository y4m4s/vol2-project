import type { AiProviderId, AutomaticRoutingSettings, RoutingProviderConnectionStatus } from "../../../shared/types";
import { PROVIDER_IDS, PROVIDER_LABELS, selectableBasicProviderIds, toggleRoutingProviderSelection } from "../../../shared/providerRouting";
import { ProviderLogo } from "./ProviderLogo";

export function RoutingSettings({
  value,
  onChange,
  tested,
  connection,
  localProvidersWithModels,
  disabled
}: {
  value: AutomaticRoutingSettings;
  onChange(value: AutomaticRoutingSettings): void;
  tested: AiProviderId[];
  connection?: RoutingProviderConnectionStatus;
  localProvidersWithModels: AiProviderId[];
  disabled: boolean;
}) {
  const automatic = value.mode === "automatic";
  const selectedProviders = value.allowedProviderIds;
  const basicProviderIds = selectableBasicProviderIds(value, localProvidersWithModels);

  const toggleProvider = (providerId: AiProviderId) => {
    onChange(toggleRoutingProviderSelection(value, providerId));
  };

  return <fieldset className="routing-settings" disabled={disabled}>
    {automatic && <div className="routing-auto-settings">
      <section className="routing-subsection" aria-labelledby="routing-candidates-title">
        <div className="routing-provider-heading">
          <div>
            <strong id="routing-candidates-title">使用するプロバイダー</strong>
            <span>複数選択できます。保存時に選択した接続先を確認します。</span>
          </div>
          <span className="routing-provider-count">{selectedProviders.length}件選択中</span>
        </div>

        <div className="settings-provider-picker routing-provider-picker">
          <div className="provider-options routing-provider-options" role="group" aria-label="自動切り替えに使用するプロバイダー">
            {PROVIDER_IDS.map(providerId => {
              const connected = tested.includes(providerId);
              const selected = value.allowedProviderIds.includes(providerId);
              const connecting = connection?.providerId === providerId && connection.state === "connecting";
              const label = PROVIDER_LABELS[providerId];
              const action = selected ? "自動切り替え候補から外す" : "自動切り替え候補に追加する";
              return <button
                key={providerId}
                type="button"
                className={`settings-provider-option routing-provider-option ${providerId} ${selected ? "selected" : ""} ${connected ? "connected" : ""} ${connecting ? "connecting" : ""}`}
                title={`${label}：${connected ? "接続確認済み" : "保存時に接続確認"}。${action}`}
                aria-label={`${label}。${connected ? "接続確認済み" : "保存時に接続確認"}。${action}`}
                aria-pressed={selected}
                onClick={() => toggleProvider(providerId)}
              >
                <span className="routing-provider-option-icon">
                  <ProviderLogo providerId={providerId} className="settings-provider-logo" />
                  {connected && <span className="routing-provider-connected-dot" aria-hidden="true" />}
                  {connecting && <span className="routing-provider-connecting-dot" aria-hidden="true">
                    <span className="material-symbols-outlined">progress_activity</span>
                  </span>}
                </span>
              </button>;
            })}
          </div>
          <div className="settings-provider-selection routing-provider-selection" aria-live="polite">
            {selectedProviders.length > 0
              ? `選択中：${selectedProviders.map(id => PROVIDER_LABELS[id]).join("、")}`
              : "使用するプロバイダーを選択してください"}
          </div>
        </div>
      </section>

      <section className="routing-subsection" aria-labelledby="routing-preferred-title">
        <div className="routing-subsection-heading">
          <strong id="routing-preferred-title">基本プロバイダー</strong>
          <span>新しい相談を始めるときに最初に使用します。</span>
        </div>
        <div className="choice-options routing-preferred-options" role="radiogroup" aria-label="基本プロバイダー">
          {basicProviderIds.map(providerId => <button key={providerId} type="button" role="radio" aria-checked={value.preferredProviderId === providerId} className={`choice-option routing-preferred-option ${providerId} ${value.preferredProviderId === providerId ? "selected" : ""}`} onClick={() => onChange({ ...value, preferredProviderId: providerId })}>
            <span className="routing-preferred-icon-wrap">
              <ProviderLogo providerId={providerId} className="routing-preferred-logo" />
            </span>
            <span className="routing-preferred-copy"><strong>{PROVIDER_LABELS[providerId]}</strong><small>新しい相談で使用</small></span>
          </button>)}
        </div>
      </section>
    </div>}
  </fieldset>;
}
