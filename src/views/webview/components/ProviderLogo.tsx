declare global {
  interface Window {
    __PROVIDER_LOGO_URIS__: {
      copilot: string;
      lmStudio: string;
    };
  }
}

export type ProviderLogoId = "copilot" | "lmStudio" | "orcaRouter";

/**
 * プロバイダーのロゴ表示。Copilot と LM Studio は media 配下のロゴ画像を
 * currentColor で塗り分け、OrcaRouter はロゴ画像がないため Material Symbols を使う。
 * instance はマスク用 id を一意にするための識別子。
 */
export function ProviderLogo({
  providerId,
  instance,
  className,
  symbolClassName
}: {
  providerId: ProviderLogoId;
  instance: string;
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
    const logoUri = window.__PROVIDER_LOGO_URIS__.lmStudio;
    return (
      <span
        className={className}
        style={{
          WebkitMaskImage: `url("${logoUri}")`,
          maskImage: `url("${logoUri}")`
        }}
        aria-hidden="true"
      />
    );
  }

  const invertFilterId = `copilot-logo-invert-${instance}`;
  const logoMaskId = `copilot-logo-mask-${instance}`;
  return (
    <svg
      className={className}
      viewBox="0 0 600 600"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter id={invertFilterId} colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"
          />
        </filter>
        <mask
          id={logoMaskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="600"
          height="600"
          style={{ maskType: "luminance" }}
        >
          <image
            href={window.__PROVIDER_LOGO_URIS__.copilot}
            width="600"
            height="600"
            filter={`url(#${invertFilterId})`}
          />
        </mask>
      </defs>
      <rect width="600" height="600" fill="currentColor" mask={`url(#${logoMaskId})`} />
    </svg>
  );
}
