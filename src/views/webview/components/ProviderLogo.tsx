declare global {
  interface Window {
    __PROVIDER_LOGO_URIS__: {
      copilotBlack: string;
      copilotWhite: string;
      lmStudio: string;
    };
  }
}

export type ProviderLogoId = "copilot" | "lmStudio" | "orcaRouter";

/**
 * プロバイダーのロゴ表示。Copilot と LM Studio は公式配布アセットを加工せず表示し、
 * OrcaRouter はロゴ画像がないため Material Symbols を使う。
 */
export function ProviderLogo({
  providerId,
  className,
  symbolClassName
}: {
  providerId: ProviderLogoId;
  className: string;
  symbolClassName?: string;
}) {
  if (providerId === "orcaRouter") {
    const symbolClasses = ["material-symbols-outlined", className, symbolClassName]
      .filter(Boolean)
      .join(" ");
    return <span className={symbolClasses} aria-hidden="true">hub</span>;
  }

  if (providerId === "lmStudio") {
    return (
      <img
        src={window.__PROVIDER_LOGO_URIS__.lmStudio}
        className={className}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    );
  }

  return (
    <span className={`${className} provider-logo-copilot`} aria-hidden="true">
      <img
        src={window.__PROVIDER_LOGO_URIS__.copilotBlack}
        className="provider-logo-copilot-black"
        alt=""
        draggable={false}
      />
      <img
        src={window.__PROVIDER_LOGO_URIS__.copilotWhite}
        className="provider-logo-copilot-white"
        alt=""
        draggable={false}
      />
    </span>
  );
}
