import { useEffect, useState } from "react";
import mermaid from "mermaid";

let initialized = false;

function ensureInitialized(): void {
  if (initialized) {
    return;
  }

  const isDark =
    document.body.classList.contains("vscode-dark") ||
    document.body.classList.contains("vscode-high-contrast");

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: isDark ? "dark" : "neutral",
    fontFamily: "var(--vscode-font-family, sans-serif)"
  });
  initialized = true;
}

let renderSequence = 0;

export function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(undefined);
    setFailed(false);

    ensureInitialized();
    const renderId = `navicom-mermaid-${++renderSequence}`;
    mermaid
      .render(renderId, code)
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
        // 描画失敗時に mermaid が残す一時要素を掃除する
        document.getElementById(`d${renderId}`)?.remove();
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed || !svg) {
    return (
      <pre className="s04-md-code">
        <code>{code}</code>
      </pre>
    );
  }

  return <div className="s04-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
