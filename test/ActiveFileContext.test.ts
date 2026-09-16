import assert from "node:assert/strict";
import test from "node:test";
import { completeActiveFile } from "../src/services/ActiveFileContext";

function document(text: string) {
  const lines = text.split(/\r?\n/);
  return { lineCount: lines.length, lineAt: (line: number) => ({text: lines[line]}), getText: () => text };
}

test("small files retain definitions on both sides of the viewport without changing bytes", () => {
  const text = "function adjust(n: number) { return n + 3; }\r\nconst result = adjust(2);\r\n";
  assert.equal(completeActiveFile(document(text)), text);
  assert.equal(completeActiveFile(document(text), "adjust(2)"), undefined);
  assert.equal(completeActiveFile(document(" \n\t")), undefined);
});

test("large documents are rejected before copying their complete text", () => {
  let read = false;
  const huge = {lineCount: 100000, lineAt: () => {throw Error("must not scan huge file");}, getText: () => {read = true; return "";}};
  assert.equal(completeActiveFile(huge), undefined);
  const minified = {lineCount:1,lineAt:()=>({text:"x".repeat(8001)}),getText:()=>{read=true;return "";}};
  assert.equal(completeActiveFile(minified), undefined);
  assert.equal(read, false);
});

test("whole-file cap uses actual CRLF length and includes exact boundary", () => {
  assert.equal(completeActiveFile(document("x".repeat(8000)))?.length,8000);
  assert.equal(completeActiveFile(document("x".repeat(7998)+"\r\nx")),undefined);
});
