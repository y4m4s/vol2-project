import { buildGuidancePrompt } from "../services/PromptBuilder";
import type { ModelProfile } from "../services/ModelProfile";
import { estimateTokens } from "./assertions";
import type { EvalScenario } from "./fixtures";

/**
 * 評価ランナー。
 *
 * - runStatic: プロンプトを組み立て、promptChecks だけを走らせる。モデル不要・無料・CI 可能。
 *   プロンプト「組み立てロジック」の回帰検出が目的。
 * - runLive:   responder（モデル呼び出し）に組み立て済みプロンプトを渡し、応答へ responseChecks を
 *   走らせる。モデル別の振る舞い差を計測・比較する目的。クレジットを消費するためオプトイン。
 */

export interface CheckOutcome {
  name: string;
  kind: "prompt" | "response";
  passed: boolean;
  detail?: string;
}

export interface ScenarioResult {
  id: string;
  description: string;
  promptApproxTokens: number;
  responseApproxTokens?: number;
  checks: CheckOutcome[];
  passed: boolean;
}

export interface EvalReport {
  results: ScenarioResult[];
  total: number;
  passed: number;
  failed: number;
}

export type Responder = (prompt: string, scenario: EvalScenario) => Promise<string>;

export function runStatic(scenarios: EvalScenario[]): EvalReport {
  const results = scenarios.map((scenario) => {
    const prompt = buildScenarioPrompt(scenario);
    const checks = runChecks(scenario.promptChecks, prompt, "prompt");
    return {
      id: scenario.id,
      description: scenario.description,
      promptApproxTokens: estimateTokens(prompt),
      checks,
      passed: checks.every((check) => check.passed)
    };
  });

  return summarize(results);
}

export async function runLive(
  scenarios: EvalScenario[],
  responder: Responder,
  modelProfile?: ModelProfile
): Promise<EvalReport> {
  const results: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    const prompt = buildScenarioPrompt(scenario, modelProfile);
    const checks = runChecks(scenario.promptChecks, prompt, "prompt");

    let responseApproxTokens: number | undefined;
    if (scenario.responseChecks && scenario.responseChecks.length > 0) {
      const response = await responder(prompt, scenario);
      responseApproxTokens = estimateTokens(response);
      checks.push(...runChecks(scenario.responseChecks, response, "response"));
    }

    results.push({
      id: scenario.id,
      description: scenario.description,
      promptApproxTokens: estimateTokens(prompt),
      responseApproxTokens,
      checks,
      passed: checks.every((check) => check.passed)
    });
  }

  return summarize(results);
}

function buildScenarioPrompt(scenario: EvalScenario, modelProfile?: ModelProfile): string {
  return buildGuidancePrompt({
    ...scenario.input,
    modelProfile: modelProfile ?? scenario.input.modelProfile
  });
}

export function formatReport(report: EvalReport): string {
  const lines: string[] = [];

  for (const result of report.results) {
    const head = result.passed ? "PASS" : "FAIL";
    const response = result.responseApproxTokens !== undefined ? `, resp ~${result.responseApproxTokens}t` : "";
    lines.push(`[${head}] ${result.id}  (prompt ~${result.promptApproxTokens}t${response})`);
    lines.push(`       ${result.description}`);
    for (const check of result.checks) {
      const mark = check.passed ? "  ✓" : "  ✗";
      const detail = check.detail ? ` — ${check.detail}` : "";
      lines.push(`${mark} [${check.kind}] ${check.name}${detail}`);
    }
    lines.push("");
  }

  lines.push(`Total: ${report.total}  Passed: ${report.passed}  Failed: ${report.failed}`);
  return lines.join("\n");
}

function runChecks(
  checks: EvalScenario["promptChecks"],
  text: string,
  kind: "prompt" | "response"
): CheckOutcome[] {
  return checks.map((check) => {
    const outcome = check.run(text);
    return { name: check.name, kind, passed: outcome.passed, detail: outcome.detail };
  });
}

function summarize(results: ScenarioResult[]): EvalReport {
  const passed = results.filter((result) => result.passed).length;
  return {
    results,
    total: results.length,
    passed,
    failed: results.length - passed
  };
}
