import React from "react";
import { BackHeader } from "../webview/components/BackHeader";
import { Badge } from "../webview/components/Badge";
import { useApp } from "../webview/state/AppContext";
import type { ContextCategoryKey, RequestPlanCategory, RequestPlanFile } from "../../shared/types";

export function S04ContextCheck() {
  const { viewModel, send } = useApp();
  if (!viewModel) return null;

  const { currentRequestPlan, settings } = viewModel;

  return (
    <>
      <BackHeader />
      <div className="page-title">送信範囲確認</div>
      <div className="page-subtitle">AIに送信される情報の範囲と除外設定を確認できます</div>

      <div className="section-title">送信対象カテゴリ</div>
      {currentRequestPlan.categories.map((cat) => (
        <CategoryCard key={cat.key} category={cat} />
      ))}

      <div className="section-title" style={{ marginTop: 14 }}>対象ファイル一覧</div>
      {currentRequestPlan.targetFiles.length === 0 ? (
        <div className="file-list-item excluded">
          <div>
            <div className="file-path">対象ファイルはありません</div>
            <div className="file-excluded">アクティブファイルが開かれていない可能性があります</div>
          </div>
        </div>
      ) : (
        currentRequestPlan.targetFiles.map((file) => (
          <FileRow key={file.path} file={file} />
        ))
      )}

      <div className="section-title" style={{ marginTop: 14 }}>除外設定</div>
      <div className="exclude-config">
        <div className="pattern-label">除外パターン:</div>
        <div className="pattern-list">
          {settings.excludedGlobs.join("\n") || "なし"}
        </div>
        <div className="max-size">最大本文抜粋: 8000文字 / 選択範囲: 4000文字</div>
      </div>

      <div className="estimated-card">
        <span className="est-icon material-symbols-outlined">inventory_2</span>
        <div className="est-body">
          <div className="est-title">推定送信量</div>
          <div className="est-detail">{currentRequestPlan.estimatedSizeText}</div>
        </div>
      </div>

      <div className="s04-actions">
        <button
          className="btn-action"
          onClick={() => send({ type: "navigate", screen: "settings" })}
        >
          <span className="material-symbols-outlined">settings</span> 除外設定を編集
        </button>
        <button
          className="btn-action btn-back"
          onClick={() => send({ type: "navigateBack" })}
        >
          閉じる
        </button>
      </div>
    </>
  );
}

function CategoryCard({ category }: { category: RequestPlanCategory }) {
  const isActive = category.enabled && category.included;
  const badgeVariant: "green" | "gray" = isActive ? "green" : "gray";
  const badgeText = category.enabled ? (category.included ? "有効" : "未収集") : "無効";

  return (
    <div className="category-card">
      <span className="cat-icon material-symbols-outlined">
        {iconForCategory(category.key)}
      </span>
      <div className="cat-body">
        <div className="cat-name">{category.label}</div>
        <div className="cat-desc">{category.description}</div>
        {category.note && <div className="cat-desc">{category.note}</div>}
      </div>
      <Badge variant={badgeVariant}>{badgeText}</Badge>
    </div>
  );
}

function FileRow({ file }: { file: RequestPlanFile }) {
  return (
    <div className={`file-list-item${file.included ? "" : " excluded"}`}>
      <div>
        <div className="file-path">{file.path}</div>
        {file.excludedReason && (
          <div className="file-excluded">{file.excludedReason}</div>
        )}
      </div>
      <div className="file-size">{file.sizeText}</div>
    </div>
  );
}

function iconForCategory(key: ContextCategoryKey): string {
  switch (key) {
    case "activeFile": return "description";
    case "selection": return "highlight_alt";
    case "diagnostics": return "warning";
    case "recentEdits": return "edit_note";
    default: return "code";
  }
}
