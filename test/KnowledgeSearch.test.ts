import assert from "node:assert/strict";
import test from "node:test";
import { escapeKnowledgeLikePattern, normalizeKnowledgeSearchText } from "../src/services/KnowledgeSearch";

test("Unicode の大文字小文字と互換文字を同じ検索文字列へ正規化する", () => {
  assert.equal(normalizeKnowledgeSearchText("Ärger"), normalizeKnowledgeSearchText("ärger"));
  assert.equal(normalizeKnowledgeSearchText("ＡＢＣ"), "abc");
});

test("LIKE のワイルドカードをリテラルへエスケープする", () => {
  assert.equal(escapeKnowledgeLikePattern("100%_done\\ok"), "100\\%\\_done\\\\ok");
});
