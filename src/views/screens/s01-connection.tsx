import { useEffect, useRef, useState } from "react";
import type { AiProviderId } from "../../shared/types";
import { useApp } from "../webview/state/AppContext";
import { ProviderLogo } from "../webview/components/ProviderLogo";

declare global {
  interface Window { __ICON_URI__: string; }
}

export function S01Connection() {
  const { viewModel, send } = useApp();

  const canConnect = viewModel?.canConnect ?? false;
  const isBusy = viewModel?.isBusy ?? false;
  const [connectingProviderId, setConnectingProviderId] = useState<AiProviderId>();
  const [hoveredProviderId, setHoveredProviderId] = useState<AiProviderId>();
  const [focusedProviderId, setFocusedProviderId] = useState<AiProviderId>();
  const previewProvider = CONNECT_PROVIDERS.find((provider) =>
    provider.id === (hoveredProviderId ?? focusedProviderId));
  const wasBusyRef = useRef(false);

  useEffect(() => {
    if (isBusy) {
      wasBusyRef.current = true;
    } else if (wasBusyRef.current) {
      wasBusyRef.current = false;
      setConnectingProviderId(undefined);
    }
  }, [isBusy]);

  const connect = (providerId: AiProviderId) => {
    setConnectingProviderId(providerId);
    send({ type: "connect", providerId });
  };

  const isConnecting = (providerId: AiProviderId) =>
    isBusy && connectingProviderId === providerId;

  return (
    <div className="s01-root">
      <div className="s01-panel">
        <div className="s01-hero">
          <div className="s01-brand">
            <img src={window.__ICON_URI__} alt="NaviCom" className="s01-icon" />
            <div className="s01-title">NaviCom</div>
          </div>
          <div className="s01-subtitle">
            Copilot・ローカルLLM・OrcaRouterに対応した学習支援コーディングアシスタントです。
          </div>
        </div>

        <div className="s01-feature-list">
          <div className="s01-feature">
            <span className="material-symbols-outlined">code</span>
            <div className="s01-feature-copy">
              <div className="s01-feature-title">開いているコードを踏まえて相談</div>
              <div className="s01-feature-desc">
                編集中のファイル・選択範囲・診断情報を文脈に含めて質問できます。
              </div>
            </div>
          </div>

          <div className="s01-feature">
            <span className="material-symbols-outlined">description</span>
            <div className="s01-feature-copy">
              <div className="s01-feature-title">追加コンテキストを付与して相談</div>
              <div className="s01-feature-desc">
                入力欄の添付ボタンから自由な補足情報を加えて質問できます。
              </div>
            </div>
          </div>

          <div className="s01-feature">
            <span className="material-symbols-outlined">chat</span>
            <div className="s01-feature-copy">
              <div className="s01-feature-title">質問と回答を相談ごとに整理</div>
              <div className="s01-feature-desc">
                専用画面に質問と回答を残せます。各質問のAI入力は、その時点の作業文脈だけで組み立てます。
              </div>
            </div>
          </div>

          <div className="s01-feature">
            <span className="material-symbols-outlined">history</span>
            <div className="s01-feature-copy">
              <div className="s01-feature-title">相談履歴を保存・再閲覧</div>
              <div className="s01-feature-desc">
                過去の質問と回答を履歴ページで一覧し、同じ画面へ戻って見返せます。
              </div>
            </div>
          </div>

          <div className="s01-feature">
            <span className="material-symbols-outlined">book</span>
            <div className="s01-feature-copy">
              <div className="s01-feature-title">役立つ回答をナレッジとして保存</div>
              <div className="s01-feature-desc">
                会話画面の保存ボタンから有用な回答を蓄積し、あとから見返せます。
              </div>
            </div>
          </div>
        </div>

        <div className="s01-actions">
          <div className="s01-provider-options" role="group" aria-label="接続先">
            {CONNECT_PROVIDERS.map((provider) => {
              const busy = isConnecting(provider.id);
              const label = busy ? `${provider.label} に接続中...` : `${provider.label} に接続`;
              return (
                <button
                  key={provider.id}
                  type="button"
                  className={`s01-provider-btn ${provider.id}${busy ? " busy" : ""}`}
                  title={label}
                  aria-label={label}
                  aria-busy={busy}
                  disabled={!canConnect || isBusy}
                  onClick={() => connect(provider.id)}
                  onMouseEnter={() => setHoveredProviderId(provider.id)}
                  onMouseLeave={() => setHoveredProviderId(undefined)}
                  onFocus={() => setFocusedProviderId(provider.id)}
                  onBlur={() => setFocusedProviderId(undefined)}
                >
                  {busy ? (
                    <span className="material-symbols-outlined s01-spin" aria-hidden="true">sync</span>
                  ) : (
                    <ProviderLogo providerId={provider.id} className="s01-connect-logo" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="s01-connect-status" role="status">
            {connectingProviderId && isBusy
              ? `${CONNECT_PROVIDERS.find((provider) => provider.id === connectingProviderId)?.label} に接続中...`
              : previewProvider ? `${previewProvider.label} に接続` : "アイコンを選んで接続"}
          </div>
        </div>
      </div>
    </div>
  );
}

const CONNECT_PROVIDERS: Array<{ id: AiProviderId; label: string }> = [
  { id: "copilot", label: "GitHub Copilot" },
  { id: "lmStudio", label: "LM Studio" },
  { id: "ollama", label: "Ollama" },
  { id: "orcaRouter", label: "OrcaRouter" }
];
