import assert from "node:assert/strict";
import test from "node:test";
import {
  createExternalGuidanceRequest,
  resolveWorkspaceDisplayPath,
  toWorkspaceDisplayPath
} from "../src/services/WorkspacePathPolicy";

const root = { name: "sample", fsPath: process.platform === "win32" ? "C:\\work\\sample" : "/work/sample" };
const nestedFile = process.platform === "win32"
  ? "C:\\work\\sample\\src\\app.ts"
  : "/work/sample/src/app.ts";

test("ワークスペース内の絶対パスを相対表示へ変換して安全に解決する", () => {
  assert.equal(toWorkspaceDisplayPath(nestedFile, [root]), "src/app.ts");
  assert.equal(resolveWorkspaceDisplayPath("src/app.ts", [root]), nestedFile);
  assert.equal(resolveWorkspaceDisplayPath("../secret.txt", [root]), undefined);
  assert.equal(resolveWorkspaceDisplayPath(nestedFile, [root]), nestedFile);
});

test("外部送信用の文脈とリクエスト計画から絶対パスを除く", () => {
  const external = createExternalGuidanceRequest(
    {
      activeFilePath: nestedFile,
      activeFileLanguage: "typescript",
      activeFileExcerpt: "const answer = 42;",
      referencedFiles: [{
        path: nestedFile,
        languageId: "typescript",
        reason: "open",
        diagnosticsSummary: [],
        recentEditsSummary: [],
        score: 60
      }],
      diagnosticsSummary: [],
      recentEditsSummary: [],
      relatedSymbols: []
    },
    {
      kind: "context",
      categories: [],
      targetFiles: [{ path: nestedFile, sizeText: "42 B", included: true }],
      excludedGlobs: [],
      estimatedSizeText: "42 B / 1カテゴリ"
    },
    [root]
  );

  assert.equal(external.context.activeFilePath, "src/app.ts");
  assert.equal(external.context.referencedFiles[0].path, "src/app.ts");
  assert.equal(external.requestPlan.targetFiles[0].path, "src/app.ts");
});
