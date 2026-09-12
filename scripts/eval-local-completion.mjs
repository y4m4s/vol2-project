// Opt-in synthetic evaluation using the production local provider clients.
// See docs/provider/lm-studio.md and docs/provider/ollama.md.
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { TASK_COMPLETION_SCENARIOS } from "../out/eval/taskCompletionScenarios.js";
import { SCENARIOS } from "../out/eval/fixtures.js";
import { buildGuidancePromptMessages } from "../out/services/PromptBuilder.js";
import { OllamaClient } from "../out/services/OllamaClient.js";
import { LmStudioClient } from "../out/services/LmStudioClient.js";
import { deriveModelProfile } from "../out/services/ModelProfile.js";
import { guidanceContentDepth } from "../out/services/GuidanceDepthPolicy.js";
import { buildGuidanceFormatRepairPrompt, guidanceResponseValidationOptions, validateGuidanceResponse } from "../out/services/GuidanceResponsePolicy.js";
import { runLive, formatReport } from "../out/eval/runner.js";

const { values } = parseArgs({ options: {
  provider: { type: "string", default: "ollama" },
  "base-url": { type: "string" },
  model: { type: "string" },
  "list-models": { type: "boolean", default: false },
  "reasoning-effort": { type: "string", default: "auto" },
  depth: { type: "string" },
  repeat: { type: "string", default: "1" },
  filter: { type: "string", default: "" },
  suite: { type: "string", default: "completion" },
  output: { type: "string" },
  "capture-prompts": { type: "string" },
  "replay-prompts": { type: "string" }
} });
if (!["ollama", "lmStudio"].includes(values.provider)) throw new Error("Only local providers are supported");
const Client = values.provider === "lmStudio" ? LmStudioClient : OllamaClient;
values["base-url"] ??= values.provider === "lmStudio" ? "http://127.0.0.1:1234" : "http://localhost:11434";
if (values["list-models"]) {
  console.log(JSON.stringify(await new Client().listModels(values["base-url"]), null, 2));
  process.exit(0);
}
values.model ??= values.provider === "ollama" ? "qwen3:8b" : undefined;
if (!values.model) throw new Error("LM Studio requires --model (use --list-models)");
if (values.provider === "lmStudio" && !["auto", "none", "high"].includes(values["reasoning-effort"])) {
  throw new Error("LM Studio reasoning override must be auto, none or high");
}
const repeats = Number(values.repeat);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error("repeat must be 1..10");
if (!["completion", "automatic"].includes(values.suite)) throw new Error("suite must be completion or automatic");
const selected = (values.suite === "automatic" ? SCENARIOS.filter(s => s.id.startsWith("automatic-")) : TASK_COMPLETION_SCENARIOS)
  .filter(s => s.id.includes(values.filter))
  .map(s => values.depth ? { ...s, input: { ...s.input, assistanceDepth: values.depth } } : s);
if (values.depth && !["low", "high"].includes(values.depth)) throw new Error("Invalid depth");
if (!selected.length) throw new Error("No matching scenarios");
const prompts = values["replay-prompts"]
  ? JSON.parse(readFileSync(values["replay-prompts"], "utf8"))
  : Object.fromEntries(selected.map(s => [s.id, buildGuidancePromptMessages({ ...s.input,
      assistanceDepth: guidanceContentDepth(values.provider, s.input.assistanceDepth),
      modelProfile: deriveModelProfile({ id: values.model, name: values.model, vendor: values.provider }) })]));
if (values["capture-prompts"]) {
  writeFileSync(values["capture-prompts"], JSON.stringify(prompts, null, 2));
  process.exit(0);
}
if (!["auto", "none", "low", "medium", "high"].includes(values["reasoning-effort"])) throw new Error("Invalid reasoning effort");
// Evaluation-only override for comparing thinking; production defaults are unchanged.
const client = new class extends Client {
  lastReasoningChars = 0;
  async requestJson(...args) {
    const payload = await super.requestJson(...args);
    const message = payload?.choices?.[0]?.message;
    const reasoning = message?.reasoning ?? message?.reasoning_content;
    this.lastReasoningChars = typeof reasoning === "string" ? reasoning.length : Array.isArray(payload?.output)
      ? payload.output.filter(item => item.type === "reasoning" && typeof item.content === "string")
        .reduce((sum, item) => sum + item.content.length, 0) : 0;
    return payload;
  }
  getCompletionExtraBody(request) { return values["reasoning-effort"] === "auto"
    ? super.getCompletionExtraBody(request) : { reasoning_effort: values["reasoning-effort"] }; }
}();
const responses = [];
const scenarios = Array.from({ length: repeats }, () => selected).flat();
const report = await runLive(scenarios, async (_messages, scenario) => {
  const messages = prompts[scenario.id];
  if (!messages?.systemPrompt || !messages?.userPrompt) throw new Error("Missing captured prompt");
  const started = performance.now();
  const attempts = [];
  const reasoningChars = [];
  let request = { ...messages, purpose: "guidance", reasoningEffort: values.provider === "lmStudio" && values["reasoning-effort"] !== "auto"
    ? values["reasoning-effort"] : scenario.input.assistanceDepth === "high" ? "high" : "none",
    maxOutputTokens: guidanceContentDepth(values.provider, scenario.input.assistanceDepth) === "high" ? 8192 : 2048 };
  // Match AdviceService's single format repair, without adding a semantic retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.createCompletion(values["base-url"], values.model, request,
      scenario.input.context.activeFilePath ? [scenario.input.context.activeFilePath] : []);
    attempts.push(response);
    reasoningChars.push(client.lastReasoningChars);
    const validation = validateGuidanceResponse(undefined, response.text, guidanceResponseValidationOptions(scenario.input));
    if (validation.ok || response.finishReason === "length" || attempt === 1) break;
    request = { ...request, systemPrompt: buildGuidanceFormatRepairPrompt(messages.systemPrompt, validation.reason, "always") };
  }
  const last = attempts.at(-1);
  const visible = validateGuidanceResponse(undefined, last.text, guidanceResponseValidationOptions(scenario.input));
  responses.push({ id: scenario.id, durationMs: Math.round(performance.now() - started), attempts, reasoningChars, visible });
  console.log(`${scenario.id} [${visible.ok ? visible.outcome : "invalid"}]: ${last.text}`);
  if (last.finishReason === "length") throw new Error("Output limit reached");
  return last.text;
});
console.log(formatReport(report));
if (values.output) writeFileSync(values.output, JSON.stringify({ provider: values.provider, model: values.model,
  depth: values.depth, reasoningEffort: values["reasoning-effort"], report, responses }, null, 2));
process.exitCode = report.failed ? 1 : 0;
