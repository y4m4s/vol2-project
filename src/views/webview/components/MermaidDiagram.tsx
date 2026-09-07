import { useEffect, useState } from "react";

const MAX_DIAGRAM_CHARACTERS = 20_000;
const MAX_DIAGRAM_STATEMENTS = 300;
let mermaidPromise: Promise<(typeof import("mermaid"))["default"]> | undefined;

function loadMermaid(): Promise<(typeof import("mermaid"))["default"]> {
  mermaidPromise ??= import("mermaid").then((module) => module.default);
  return mermaidPromise;
}

let renderSequence = 0;

export function MermaidDiagram({ code, onRetry }: { code: string; onRetry?: () => void }) {
  const [svg, setSvg] = useState<string>();
  const [failureMessage, setFailureMessage] = useState<string>();
  const [theme, setTheme] = useState(resolveTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(resolveTheme()));
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSvg(undefined);
    setFailureMessage(undefined);

    if (!isWithinRenderLimits(code)) {
      setFailureMessage("図が大きすぎるため、Mermaidコードとして表示しています。");
      return;
    }
    const renderId = `navicom-mermaid-${++renderSequence}`;
    void loadMermaid()
      .then((mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme,
          maxTextSize: MAX_DIAGRAM_CHARACTERS,
          fontFamily: "var(--vscode-font-family, sans-serif)"
        });
        return mermaid.render(renderId, code);
      })
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailureMessage("Mermaidの構文を解釈できなかったため、コードとして表示しています。もう一度 /flow を実行すると再生成できます。");
        }
        // 描画失敗時に mermaid が残す一時要素を掃除する
        document.getElementById(`d${renderId}`)?.remove();
      });

    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (failureMessage) {
    return (
      <div className="s04-mermaid-fallback" role="status">
        <div className="s04-mermaid-fallback-message">{failureMessage}</div>
        {onRetry && (
          <button type="button" className="s04-mermaid-retry" onClick={onRetry}>
            <span className="material-symbols-outlined">refresh</span>
            現在の文脈で図を再生成
          </button>
        )}
        <pre className="s04-md-code">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (!svg) return null;

  return <div className="s04-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function resolveTheme(): "dark" | "neutral" {
  return document.body.classList.contains("vscode-dark") ||
    document.body.classList.contains("vscode-high-contrast")
    ? "dark"
    : "neutral";
}

function isWithinRenderLimits(code: string): boolean {
  if (code.length > MAX_DIAGRAM_CHARACTERS) {
    return false;
  }
  const statements = code
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("%%"));
  return statements.length <= MAX_DIAGRAM_STATEMENTS;
}
