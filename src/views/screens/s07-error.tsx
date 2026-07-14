import { useRef } from "react";
import { BackButton } from "../webview/components/BackHeader";
import { useApp } from "../webview/state/AppContext";

export function S07Error() {
  const { viewModel, send } = useApp();

  const isBusy = viewModel?.isBusy ?? false;
  const providerId = viewModel?.providerId ?? "copilot";
  const isLmStudio = providerId === "lmStudio";

  // connecting 中は直前の安定した state を保持して表示が変わらないようにする
  const stableStateRef = useRef(viewModel?.connectionState);
  if (viewModel?.connectionState !== "connecting") {
    stableStateRef.current = viewModel?.connectionState;
  }

  const isUnavailable = stableStateRef.current === "unavailable";
  const title = isLmStudio
    ? "ローカル LLM に接続できません"
    : isUnavailable
      ? "Copilotに接続できません"
      : "現在は利用が制限されています";
  const description = isLmStudio
    ? "LM Studio 側で次の項目を確認してください。"
    : isUnavailable
      ? "次の項目が完了していない可能性があります。"
      : "Copilot へのリクエストが一時的に制限されている可能性があります。";
  const possibleCauses = isLmStudio
    ? [
        {
          icon: "dns",
          text: "LM Studio の Local Server が起動していない"
        },
        {
          icon: "memory",
          text: "LM Studio で使用するモデルがロードされていない"
        },
        {
          icon: "key_off",
          text: "LM Studio 側で API 認証が有効になっている"
        },
        {
          icon: "verified_user",
          text: "ワークスペースが信頼済みになっていない"
        }
      ]
    : isUnavailable
      ? [
        {
          icon: "extension",
          text: "GitHub Copilotがインストールされていない"
        },
        {
          icon: "account_circle",
          text: "GitHubにサインインしていない\nまたはCopilotの利用権限がない"
        },
        {
          icon: "speed",
          text: "Copilot の自動モデルルーティング、または設定で指定したモデルが利用できない"
        },
        {
          icon: "verified_user",
          text: "ワークスペースが信頼済みになっていない"
        }
      ]
    : [
        {
          icon: "schedule",
          text: "短時間に Copilot リクエストが集中している"
        },
        {
          icon: "wifi_off",
          text: "ネットワークまたは認証状態が一時的に不安定になっている"
        }
      ];

  return (
    <div className="s07-root">
      <div className="s07-back-slot">
        <BackButton
          title="接続選択へ戻る"
          ariaLabel="接続選択へ戻る"
          onClick={() => send({ type: "navigate", screen: "onboarding" })}
        />
      </div>
      <div className={`s07-panel ${isUnavailable ? "unavailable" : "restricted"}`}>
        <div className="s07-icon-wrap">
          <span className="material-symbols-outlined s07-icon">
            {isUnavailable ? "cloud_off" : "block"}
          </span>
        </div>

        <div className="s07-copy">
          <div className="s07-title">{title}</div>
          <div className="s07-desc">{description}</div>
        </div>

        <ul className="s07-cause-list" aria-label="確認する項目">
          {possibleCauses.map((cause) => (
            <li key={cause.icon} className="s07-cause-item">
              <span className="material-symbols-outlined">{cause.icon}</span>
              <span style={{ whiteSpace: "pre-wrap" }}>{cause.text}</span>
            </li>
          ))}
        </ul>

        <button className="s07-retry-btn" onClick={() => send({ type: "connect" })} disabled={isBusy}>
          <span className={`material-symbols-outlined${isBusy ? " s07-spin" : ""}`}>refresh</span>
          {isBusy ? "接続中..." : "再試行"}
        </button>
      </div>
    </div>
  );
}
