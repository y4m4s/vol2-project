import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";
import type * as vscode from "vscode";
import { RequestPlanner } from "../src/services/RequestPlanner";
import { buildGuidancePromptMessages } from "../src/services/PromptBuilder";
import { deriveModelProfile } from "../src/services/ModelProfile";
import type { NavigatorSettings } from "../src/shared/types";

const state: {activeTextEditor?: vscode.TextEditor} = {};
let inWorkspace = true;
class Range {
  public start: {line: number; character: number};
  public end: {line: number; character: number};
  public constructor(sl: number, sc: number, el: number, ec: number) {
    this.start = {line:sl,character:sc}; this.end = {line:el,character:ec};
  }
}
const loader = Module as unknown as {_load(id: string, parent: unknown, isMain: boolean): unknown};
const original = loader._load;
loader._load = (id, parent, main) => id === "vscode" ? {
  window: state, Range,
  workspace: {getWorkspaceFolder: () => inWorkspace ? {name:"workspace"} : undefined},
  languages: {getDiagnostics: () => []}
} : original(id,parent,main);
const {ContextCollector, collectComparisonEvidenceFrom} = require("../src/services/ContextCollector") as typeof import("../src/services/ContextCollector");
loader._load = original;

function editor(text: string, visibleLine: number, selected = false): vscode.TextEditor {
  const lines = text.split("\n");
  const offset = (p: {line: number; character: number}) => lines.slice(0,p.line).reduce((n,s)=>n+s.length+1,0)+p.character;
  const range = new Range(visibleLine,0,visibleLine,lines[visibleLine].length);
  return {
    document: {uri:{scheme:"file",fsPath:"/workspace/example.ts",toString:()=>"example.ts"}, languageId:"typescript",lineCount:lines.length,
      lineAt:(line: number)=>({text:lines[line]}),getWordRangeAtPosition:()=>undefined,
      getText:(r?: Range)=>r?text.slice(offset(r.start),offset(r.end)):text},
    visibleRanges:[range], selection:{...range,active:range.start,isEmpty:!selected}
  } as unknown as vscode.TextEditor;
}

test("collector through planner to prompt retains off-screen helpers and honors exclusions", () => {
  const text = "function convertMeters(n: number) { return n * 100; }\nconst distance = convertMeters(3);";
  state.activeTextEditor=editor(text,1);
  for(const provider of ["lmStudio","ollama"] as const) {
    const context=new ContextCollector().collectGuidanceContext(provider);
    assert.equal(context.activeFileExcerpt,text);
    const settings: NavigatorSettings={providerId:provider,protectedExcludedGlobs:[],excludedGlobs:[],
      defaultMode:"manual",defaultAssistanceDepth:"low",lmStudioBaseUrl:"http://127.0.0.1:1234",
      requestIntervalMs:60000,idleDelayMs:10000,dailyTokenLimit:100000};
    const plan=new RequestPlanner().prepareGuidanceRequest(context,{diagnosticsSummary:[]},settings,"manual","low");
    const prompt=buildGuidancePromptMessages({context:plan.context,kind:"manual",userPrompt:"distanceの値は？",modelProfile:deriveModelProfile({vendor:provider})});
    assert.ok(prompt.userPrompt.includes("return n * 100"));
    const excluded=new RequestPlanner().prepareGuidanceRequest(context,{diagnosticsSummary:[]}, {...settings,excludedGlobs:["**/example.ts"]},"manual","low");
    const removed=buildGuidancePromptMessages({context:excluded.context,kind:"manual",userPrompt:"値は？"});
    assert.ok(!removed.userPrompt.includes("convertMeters"));
    assert.ok(!removed.userPrompt.includes("return n * 100"));
  }
});

test("explicit selection, large files and non-workspace editors retain their boundaries", () => {
  const small="function internal() { return 71; }\nconst value = internal();";
  state.activeTextEditor=editor(small,1,true);
  const selected=new ContextCollector().collectGuidanceContext("lmStudio");
  assert.equal(selected.activeFileExcerpt,"const value = internal();");
  assert.equal(selected.selectedText,selected.activeFileExcerpt);
  const large="x".repeat(8100)+"\nconst visible = 4;";
  state.activeTextEditor=editor(large,1);
  assert.equal(new ContextCollector().collectGuidanceContext("ollama").activeFileExcerpt,"const visible = 4;");
  inWorkspace=false;
  try {assert.equal(new ContextCollector().collectGuidanceContext("ollama").activeFileExcerpt,undefined);}
  finally {inWorkspace=true;state.activeTextEditor=undefined;}
});

test("cloud and unspecified providers retain viewport/selection without reading the full file", () => {
  const text="function helper() { return 31; }\nconst value = helper();";
  for(const provider of ["copilot","orcaRouter",undefined] as const) {
    for(const selected of [false,true]) {
      state.activeTextEditor=editor(text,1,selected);
      const doc=state.activeTextEditor.document;
      const getText=doc.getText.bind(doc);
      Object.assign(doc,{getText:(range?: vscode.Range)=>{assert.ok(range,"must not read the whole document");return getText(range);}});
      const context=new ContextCollector().collectGuidanceContext(provider);
      assert.equal(context.activeFileExcerpt,"const value = helper();");
      assert.equal(context.selectedText,selected?context.activeFileExcerpt:undefined);
    }
  }
  state.activeTextEditor=undefined;
});

test("比較の証拠: 送信対象から除外したファイルでは集めない", () => {
  state.activeTextEditor = editor("const name = user?.name;\nconsole.log(name);", 0);
  const collector = new ContextCollector();
  const evidence = collector.collectComparisonEvidence((filePath) => filePath.endsWith("example.ts"));
  assert.deepEqual(evidence, { diagnostics: [] });
  const included = collector.collectComparisonEvidence(() => false);
  assert.equal(included.cursorLine, "const name = user?.name;");
  state.activeTextEditor = undefined;
});

test("比較の証拠: 文書全体を覆う診断でも、読む行数に上限がある", () => {
  let reads = 0;
  const lineCount = 100_000;
  const document = {
    uri: { toString: () => "big.ts" },
    lineCount,
    lineAt: (line: number) => { reads++; return { text: "x".repeat(1000) + line }; }
  } as unknown as vscode.TextDocument;
  const whole = { start: { line: 0, character: 0 }, end: { line: lineCount - 1, character: 0 } };
  const diagnostics = Array.from({ length: 30 }, () => ({ source: "ts", code: { value: 2322, target: {} }, message: "m", range: whole })) as unknown as vscode.Diagnostic[];
  const evidence = collectComparisonEvidenceFrom(document, 50_000, undefined, diagnostics);
  assert.ok(reads <= 121, `lineAt was called ${reads} times`);
  assert.equal(evidence.diagnostics.length, 20);
  assert.equal(evidence.diagnostics[0].code, "2322");
  assert.ok((evidence.diagnostics[0].nearbyCode ?? "").split("\n").length <= 7);
  assert.ok((evidence.cursorLine ?? "").length <= 400);
});
