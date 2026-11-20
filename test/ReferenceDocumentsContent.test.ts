import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReferenceDocumentsContent } from "../src/views/webview/components/ReferenceDocumentsContent";
import type { ReferenceProvenance } from "../src/shared/referenceContext";

const reference: ReferenceProvenance = { id: "doc:1", sourceId: "source", path: "docs/guide.md", title: "Guide", kind: "document", hash: "v1",
  startLine: 2, endLine: 8, reason: "AIが参照を要求", localOnly: false, mode: "reference", included: true };

test("reference card content shows saved documents, Skills and original line ranges", () => {
  const html = renderToStaticMarkup(createElement(ReferenceDocumentsContent, { documents: [reference,
    { ...reference, id: "skill:1", kind: "skill", path: "review/SKILL.md", mode: "procedure" }] }));
  assert.doesNotMatch(html, /<details|<summary/);
  assert.match(html, /docs\/guide.md/);
  assert.match(html, /L2–8/);
});

test("reference cards explain confirmed empty attachment lists", () => {
  const html = renderToStaticMarkup(createElement(ReferenceDocumentsContent, { documents: [] }));
  assert.match(html, /添付資料・Skillsは送信されていません/);
});

test("legacy answers without provenance are distinguished from confirmed empty reference lists", () => {
  const html = renderToStaticMarkup(createElement(ReferenceDocumentsContent, {}));
  assert.match(html, /参照記録がありません/);
  assert.doesNotMatch(html, /参照なし|送信されていません/);
});

test("withheld references display the reason instead of disappearing, with paths escaped", () => {
  const html = renderToStaticMarkup(createElement(ReferenceDocumentsContent, { documents: [{ ...reference, path: "<private>.md", included: false,
    note: "ローカル限定のため送信しません" }] }));
  assert.match(html, /未使用/);
  assert.match(html, /ローカル限定/);
  assert.match(html, /&lt;private&gt;\.md/);
  assert.doesNotMatch(html, /<private>/);
});
