declare global {
  interface Window {
    __PROVIDER_LOGO_URIS__: {
      copilotBlack: string;
      copilotWhite: string;
      lmStudioColor: string;
      lmStudioWhite: string;
      icons8OrcaBlack: string;
      icons8OrcaWhite: string;
    };
  }
}

export type ProviderLogoId = "copilot" | "lmStudio" | "orcaRouter";

/**
 * 公式プロバイダー資産とライセンス済みの第三者アイコンを表示する。
 */
export function ProviderLogo({
  providerId,
  className,
  variant = "default"
}: {
  providerId: ProviderLogoId;
  className: string;
  symbolClassName?: string;
  variant?: "default" | "white";
}) {
  if (providerId === "orcaRouter") {
    return (
      <span className={`${className} provider-logo-theme-pair`} aria-hidden="true">
        <img
          src={window.__PROVIDER_LOGO_URIS__.icons8OrcaBlack}
          className="provider-logo-theme-black"
          alt=""
          draggable={false}
        />
        <img
          src={window.__PROVIDER_LOGO_URIS__.icons8OrcaWhite}
          className="provider-logo-theme-white"
          alt=""
          draggable={false}
        />
      </span>
    );
  }

  if (providerId === "lmStudio") {
    return (
      <img
        src={variant === "white"
          ? window.__PROVIDER_LOGO_URIS__.lmStudioWhite
          : window.__PROVIDER_LOGO_URIS__.lmStudioColor}
        className={className}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    );
  }

  return (
    <span className={`${className} provider-logo-theme-pair`} aria-hidden="true">
      <img
        src={window.__PROVIDER_LOGO_URIS__.copilotBlack}
        className="provider-logo-theme-black"
        alt=""
        draggable={false}
      />
      <img
        src={window.__PROVIDER_LOGO_URIS__.copilotWhite}
        className="provider-logo-theme-white"
        alt=""
        draggable={false}
      />
    </span>
  );
}
