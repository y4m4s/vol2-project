import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";

export function RequestPlanDisclosure({ userPrompt, additionalContext }: { userPrompt: string; additionalContext: string }) {
  const { viewModel, send } = useApp();
  const [open, setOpen] = useState(false);

  const activeFilePath = viewModel?.contextPreview.activeFilePath;
  const selectedTextPreview = viewModel?.contextPreview.selectedTextPreview;
  const diagnosticsKey = viewModel?.contextPreview.diagnosticsSummary
    .map((item) => `${item.severity}:${item.line}:${item.message}`)
    .join("|");

  useEffect(() => {
    if (open && viewModel?.requestState === "idle") {
      const timer = window.setTimeout(() => send({ type: "refreshRequestPlan", userPrompt, additionalContext }), 150);
      return () => window.clearTimeout(timer);
    }
  }, [
    activeFilePath,
    diagnosticsKey,
    open,
    selectedTextPreview,
    send,
    viewModel?.assistanceDepth,
    viewModel?.mode,
    viewModel?.providerId,
    viewModel?.modelLabel,
    viewModel?.settingsRevision,
    viewModel?.currentRequestPlan.previewInput,
    userPrompt,
    additionalContext,
    viewModel?.requestState
  ]);

  if (!viewModel) {
    return null;
  }

  const plan = viewModel.currentRequestPlan;
  const visibleCategories = plan.categories;
  const pending = plan.previewInput !== userPrompt || plan.previewAdditionalContext !== additionalContext;
  const includedCategories = visibleCategories.filter((category) => category.included);
  const includedFiles = plan.targetFiles.filter((file) => file.included);
  const destinationLabel = viewModel.providerId === "lmStudio" ? "ローカル送信予定" : viewModel.providerId === "ollama" ? `Ollamaへ送信予定（${viewModel.providerEndpoint ?? "接続先未確定"}）` : "外部送信予定";
  const summaryParts = [
    includedFiles.length > 0 ? `ファイル${includedFiles.length}件` : undefined,
    includedCategories.some((category) => category.key === "selection") ? "選択範囲" : undefined,
    includedCategories.some((category) => category.key === "diagnostics") ? "診断" : undefined,
    plan.estimatedSizeText.split(" / ")[0]
  ].filter((part): part is string => Boolean(part));

  return (
    <div className={`request-plan-disclosure ${open ? "open" : ""}`}>
      <button
        type="button"
        className="request-plan-trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          {viewModel.providerId === "lmStudio" ? "computer" : "cloud_upload"}
        </span>
        <span className="request-plan-trigger-label">
          {destinationLabel}: {pending ? "入力内容を確認中" : summaryParts.join("・") || "質問のみ"}
        </span>
        <span className="material-symbols-outlined request-plan-chevron" aria-hidden="true">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && pending && <div className="request-plan-details">送信予定を更新中です。</div>}
      {open && !pending && (
        <div className="request-plan-details">
          <div className="request-plan-note">
            入力中のコマンド・推論強度・モデルの入力予算を反映した予定です。チェックは情報の一部でも送る場合に付きます。編集やモデル変更時は再計算されます。ファイル名は本文を送らない場合も含まれます。
          </div>
          <div className="request-plan-section-title">送信する情報</div>
          <ul className="request-plan-list">
            {visibleCategories.map((category) => (
              <li key={category.key} className={category.included ? "included" : "excluded"}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  {category.included ? "check_circle" : "remove_circle_outline"}
                </span>
                <span>
                  <strong>{category.label}</strong>
                  {category.note && <small>{category.note}</small>}
                </span>
              </li>
            ))}
          </ul>

          {plan.targetFiles.length > 0 && (
            <>
              <div className="request-plan-section-title">対象ファイル</div>
              <ul className="request-plan-files">
                {plan.targetFiles.map((file) => (
                  <li key={file.path} className={file.included ? "included" : "excluded"}>
                    <span className="request-plan-file-path">{file.path}</span>
                    <span>{file.included ? file.sizeText : file.excludedReason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
