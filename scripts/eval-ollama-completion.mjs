// Opt-in live eval using synthetic examples and the production Ollama client.
// npm run eval:ollama-completion -- --repeat 3 --output .test-out/completion.json
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { TASK_COMPLETION_SCENARIOS } from "../out/eval/taskCompletionScenarios.js";
import { SCENARIOS } from "../out/eval/fixtures.js";
import { buildGuidancePromptMessages } from "../out/services/PromptBuilder.js";
import { OllamaClient } from "../out/services/OllamaClient.js";
import { buildGuidanceFormatRepairPrompt, guidanceResponseValidationOptions, validateGuidanceResponse } from "../out/services/GuidanceResponsePolicy.js";
import { runLive, formatReport } from "../out/eval/runner.js";

const { values } = parseArgs({ options: {
  "base-url": { type: "string", default: "http://localhost:11434" },
  model: { type: "string", default: "qwen3:8b" },
  "reasoning-effort": { type: "string", default: "none" },
  repeat: { type: "string", default: "1" },
  filter: { type: "string", default: "" },
  suite: { type: "string", default: "completion" },
  output: { type: "string" },
  "capture-prompts": { type: "string" },
  "replay-prompts": { type: "string" }
} });
const repeats = Number(values.repeat);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error("repeat must be 1..10");
if (!["completion", "automatic"].includes(values.suite)) throw new Error("suite must be completion or automatic");
const selected = (values.suite === "automatic" ? SCENARIOS.filter(s => s.id.startsWith("automatic-")) : TASK_COMPLETION_SCENARIOS)
  .filter(s => s.id.includes(values.filter));
if (!selected.length) throw new Error("No matching scenarios");
const prompts = values["replay-prompts"]
  ? JSON.parse(readFileSync(values["replay-prompts"], "utf8"))
  : Object.fromEntries(selected.map(s => [s.id, buildGuidancePromptMessages(s.input)]));
if (values["capture-prompts"]) {
  writeFileSync(values["capture-prompts"], JSON.stringify(prompts, null, 2));
  process.exit(0);
}
if (!["none", "low", "medium", "high"].includes(values["reasoning-effort"])) throw new Error("Invalid reasoning effort");
// Evaluation-only override for comparing thinking; production defaults are unchanged.
const client = new class extends OllamaClient {
  getCompletionExtraBody() { return { reasoning_effort: values["reasoning-effort"] }; }
}();
const responses = [];
const scenarios = Array.from({ length: repeats }, () => selected).flat();
const report = await runLive(scenarios, async (_messages, scenario) => {
  const messages = prompts[scenario.id];
  if (!messages?.systemPrompt || !messages?.userPrompt) throw new Error("Missing captured prompt");
  const started = performance.now();
  const attempts = [];
  let request = { ...messages, purpose: "guidance", maxOutputTokens: scenario.input.assistanceDepth === "high" ? 8192 : 2048 };
  // Match AdviceService's single format repair, without adding a semantic retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.createCompletion(values["base-url"], values.model, request,
      scenario.input.context.activeFilePath ? [scenario.input.context.activeFilePath] : []);
    attempts.push(response);
    const validation = validateGuidanceResponse(undefined, response.text, guidanceResponseValidationOptions(scenario.input));
    if (validation.ok || response.finishReason === "length" || attempt === 1) break;
    request = { ...request, systemPrompt: buildGuidanceFormatRepairPrompt(messages.systemPrompt, validation.reason, "always") };
  }
  const last = attempts.at(-1);
  const visible = validateGuidanceResponse(undefined, last.text, guidanceResponseValidationOptions(scenario.input));
  responses.push({ id: scenario.id, durationMs: Math.round(performance.now() - started), attempts, visible });
  console.log(`${scenario.id} [${visible.ok ? visible.outcome : "invalid"}]: ${last.text}`);
  if (last.finishReason === "length") throw new Error("Output limit reached");
  return last.text;
});
console.log(formatReport(report));
if (values.output) writeFileSync(values.output, JSON.stringify({ model: values.model, reasoningEffort: values["reasoning-effort"], report, responses }, null, 2));
process.exitCode = report.failed ? 1 : 0;
