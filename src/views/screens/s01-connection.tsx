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
              <div className="s01-feature-title">会話を続けながら深掘り</div>
              <div className="s01-feature-desc">
                最初の質問を送ると専用の会話画面へ移動し、そのまま続けて相談できます。
              </div>
            </div>
          </div>

          <div className="s01-feature">
            <span className="material-symbols-outlined">history</span>
            <div className="s01-feature-copy">
              <div className="s01-feature-title">履歴から途中の会話を再開</div>
              <div className="s01-feature-desc">
                過去の相談は履歴ページで一覧でき、続きからやり取りを再開できます。
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
          <button
            className={`s01-connect-btn s01-provider-btn s01-provider-btn--copilot${isConnecting("copilot") ? " busy" : ""}`}
            disabled={!canConnect}
            onClick={() => connect("copilot")}
          >
            <span className="s01-connect-icon" aria-hidden="true">
              {isConnecting("copilot") ? (
                <span className="material-symbols-outlined s01-connect-logo-symbol s01-spin">sync</span>
              ) : (
                <ProviderLogo
                  providerId="copilot"
                  className="s01-connect-logo"
                  symbolClassName="s01-connect-logo-symbol"
                />
              )}
            </span>
            <ConnectLabel text={isConnecting("copilot") ? "Copilot に接続中..." : "Copilot に接続"} />
          </button>
          <button
            className={`s01-local-connect-btn s01-provider-btn s01-provider-btn--lm-studio${isConnecting("lmStudio") ? " busy" : ""}`}
            disabled={!canConnect}
            onClick={() => connect("lmStudio")}
          >
            <span className="s01-connect-icon" aria-hidden="true">
              {isConnecting("lmStudio") ? (
                <span className="material-symbols-outlined s01-connect-logo-symbol s01-spin">sync</span>
              ) : (
                <ProviderLogo
                  providerId="lmStudio"
                  className="s01-connect-logo"
                  symbolClassName="s01-connect-logo-symbol"
                  variant="white"
                />
              )}
            </span>
            <ConnectLabel text={isConnecting("lmStudio") ? "ローカル LLM に接続中..." : "ローカル LLM に接続"} />
          </button>
          <button
            className={`s01-local-connect-btn s01-provider-btn s01-provider-btn--orca-router${isConnecting("orcaRouter") ? " busy" : ""}`}
            disabled={!canConnect}
            onClick={() => connect("orcaRouter")}
          >
            <span className="s01-connect-icon" aria-hidden="true">
              {isConnecting("orcaRouter") ? (
                <span className="material-symbols-outlined s01-connect-logo-symbol s01-spin">sync</span>
              ) : (
                <ProviderLogo
                  providerId="orcaRouter"
                  className="s01-connect-logo"
                  symbolClassName="s01-connect-logo-symbol"
                />
              )}
            </span>
            <ConnectLabel text={isConnecting("orcaRouter") ? "OrcaRouter に接続中..." : "OrcaRouter に接続"} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 3つのボタンで共通の文言。ラベル幅をこの中の最長に揃えるために使う。 */
const CONNECT_LABELS = [
  "Copilot に接続",
  "Copilot に接続中...",
  "ローカル LLM に接続",
  "ローカル LLM に接続中...",
  "OrcaRouter に接続",
  "OrcaRouter に接続中..."
];

/**
 * 接続ボタンのラベル。表示されないサイザーで全文言の最長幅を確保することで、
 * ボタン内容を中央寄せしてもアイコンとラベルの開始位置が3つとも縦にそろう。
 */
function ConnectLabel({ text }: { text: string }) {
  return (
    <span className="s01-connect-label">
      <span className="s01-connect-label-text">{text}</span>
      <span className="s01-connect-label-sizer" aria-hidden="true">
        {CONNECT_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </span>
    </span>
  );
}
