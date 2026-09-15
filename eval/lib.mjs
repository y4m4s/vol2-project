import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { portableModelfile } from './model-metadata.mjs';
import { TASK_COMPLETION_SCENARIOS } from '../out/eval/taskCompletionScenarios.js';
import { RequestPlanner } from '../out/services/RequestPlanner.js';
import { buildGuidancePromptMessages, GUIDANCE_POLICY_REVISION } from '../out/services/PromptBuilder.js';
import { deriveModelProfile } from '../out/services/ModelProfile.js';
import { guidanceContentDepth } from '../out/services/GuidanceDepthPolicy.js';
import { assertRequestInputLimit } from '../out/services/AiRequestPolicy.js';
import { validateGuidanceResponse, guidanceResponseValidationOptions, buildGuidanceFormatRepairPrompt } from '../out/services/GuidanceResponsePolicy.js';
import { OllamaClient } from '../out/services/OllamaClient.js';
import { LmStudioClient } from '../out/services/LmStudioClient.js';

export const AXES = ['correctness','groundedness','context_utilization','hallucination','instruction_following','pedagogical_usefulness','actionability','conciseness','japanese_quality'];
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
export function save(path, value) { writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }
export function newDirectory(path) { mkdirSync(path, { recursive: false }); }
export function provenance() {
  return { git: execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim(),
    node: process.version, platform: process.platform, promptRevision: GUIDANCE_POLICY_REVISION,
    files: Object.fromEntries(['PromptBuilder','RequestPlanner','GuidanceDepthPolicy','ModelProfile','GuidanceResponsePolicy','OllamaClient','LmStudioClient','OpenAICompatibleClient'].map(name => [name, hash(readFileSync(`out/services/${name}.js`, 'utf8'))])),
    harnessHash: hash(readFileSync('eval/lib.mjs', 'utf8')) };
}
export function validateConfig(c) {
  if (!/^[a-z0-9-]+$/.test(c.id) || !['ollama','lmStudio'].includes(c.provider) || !c.model) throw Error('Invalid identity');
  const url = new URL(c.baseUrl);
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || !['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Local eval requires a loopback root URL');
  if (!['production','ollama-native'].includes(c.transport) || c.transport === 'ollama-native' && c.provider !== 'ollama') throw Error('Invalid transport');
  if (!['production','head-tail-v1'].includes(c.contextStrategy)) throw Error('Unknown context strategy');
  if (!['production','evidence-v1'].includes(c.promptVersion)) throw Error('Unknown prompt version');
  if (!['production','none','high'].includes(c.thinking)) throw Error('Invalid thinking');
  if (c.contextLength != null && (!Number.isInteger(c.contextLength) || c.contextLength < 2048 || c.contextLength > 32768)) throw Error('Context must be 2048..32768');
  if (c.maxOutputTokens != null && (!Number.isInteger(c.maxOutputTokens) || c.maxOutputTokens < 64 || c.maxOutputTokens > 32768)) throw Error('Invalid output budget');
  const allowed = c.provider === 'lmStudio' || c.transport === 'ollama-native'
    ? ['temperature','top_p','top_k','min_p','repeat_penalty'] : ['temperature','top_p','presence_penalty','frequency_penalty','seed'];
  for (const [key,value] of Object.entries(c.sampling)) {
    if (!allowed.includes(key) || !Number.isFinite(value) || value < 0) throw Error(`Unsupported sampling field: ${key}`);
    if (['top_p','min_p'].includes(key) && value > 1 || key === 'top_k' && !Number.isInteger(value)) throw Error(`Invalid sampling value: ${key}`);
  }
  if (c.provider === 'ollama' && c.transport === 'production' && c.contextLength != null) throw Error('num_ctx unsupported in OpenAI API; use native adapter');
  return c;
}
export function loadCases(split) {
  if (!['tuning','holdout'].includes(split)) throw Error('Invalid split');
  return readJson(`eval/cases/${split}.json`).map(item => {
    if (item.existing) {
      const scenario = TASK_COMPLETION_SCENARIOS.find(s => s.id === item.existing);
      if (!scenario) throw Error('Unknown existing scenario');
      return {...item, input: structuredClone(scenario.input), expectedFocus: scenario.expectedFocus};
    }
    let code = item.code ?? '', additional = item.additional;
    // Collector-bounded viewport, with meaningful evidence beyond planner's 2000 char cutoff.
    if (item.fixture === 'long-active') code = '// unrelated declarations\n'.repeat(210) + '\nexport function parsePort(value) { return Number(value); }';
    if (item.fixture === 'long-holdout') code = '// helper declarations\n'.repeat(220) + '\nexport function isReady(count) { return count > 0; }';
    if (item.fixture === 'long-additional') additional = '旧仕様: タイムアウトは30秒。\n' + '旧版メモ: 画面の背景色は白。ログの形式は変更しない。\n'.repeat(500) + '\n最新仕様: タイムアウトは17秒。旧仕様を置き換える。';
    return {...item, input:{kind:'manual', assistanceDepth:item.depth ?? 'low', userPrompt:item.question,
      context:{activeFilePath:'main.ts',activeFileLanguage:'typescript',activeFileExcerpt:code, additionalContext:additional,
        diagnosticsSummary:[], recentEditsSummary:[],relatedSymbols:[],referencedFiles:(item.references ?? []).map(ref => ({...ref,reason:'open',score:1,diagnosticsSummary:[],recentEditsSummary:[]}))}}};
  });
}
export function headTail(text, budget) {
  const marker = '\n... [middle omitted; start and end retained] ...\n';
  if (!text || text.length <= budget) return text;
  const head = Math.ceil((budget - marker.length) / 2), tail = budget - marker.length - head;
  return text.slice(0, head) + marker + text.slice(-tail);
}
export function prepare(item, config) {
  let input = structuredClone(item.input);
  const effectiveDepth = guidanceContentDepth(config.provider, input.assistanceDepth);
  // Evaluation-only minimal candidate: same 2000-char cap, preserve both ends instead of prefix.
  if (config.contextStrategy === 'head-tail-v1' && effectiveDepth === 'low') input.context.activeFileExcerpt = headTail(input.context.activeFileExcerpt, 2000);
  const planned = new RequestPlanner().prepareGuidanceRequest(input.context, {},
    {providerId:config.provider,protectedExcludedGlobs:[],excludedGlobs:[]}, input.kind, input.assistanceDepth,
    input.slashCommand, input.slashCommandScope, input.automaticObservation);
  input = {...input, context:planned.context, automaticObservation:planned.automaticObservation};
  const profile = deriveModelProfile({id:config.model,name:config.model,vendor:config.provider});
  const messages = buildGuidancePromptMessages({...input, assistanceDepth:effectiveDepth, modelProfile:profile});
  if (config.promptVersion === 'evidence-v1') messages.systemPrompt += '\n- Base factual claims on the supplied code and requirements. Trace relevant expressions using the language semantics before describing their behavior. If a required definition or requirement is absent or truncated, state what is missing rather than guessing.';
  const request = {...messages, purpose:'guidance', reasoningEffort:config.thinking === 'production' ? item.input.assistanceDepth === 'high' ? 'high' : 'none' : config.thinking,
    maxOutputTokens:config.maxOutputTokens ?? (effectiveDepth === 'high' ? 8192 : input.slashCommand === 'flow' ? 3072 : 2048)};
  assertRequestInputLimit(request, profile.contextBudget);
  return {input, request, plan:planned.requestPlan, profile,
    evidencePresent: item.evidence ? messages.userPrompt.includes(item.evidence) : null,
    approximateInputTokens:Math.ceil((messages.systemPrompt.length + messages.userPrompt.length + 2) / 3)};
}
export async function jsonRequest(url, body) {
  const response = await fetch(url, {method:body ? 'POST' : 'GET', headers:body ? {'Content-Type':'application/json'} : {},
    ...(body ? {body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(5000)});
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  return response.json();
}
export async function probe(config) {
  const result = {at:new Date().toISOString(), provider:config.provider};
  const routes = config.provider === 'ollama' ? {version:'/api/version',models:'/api/tags',loaded:'/api/ps',details:'/api/show'} : {models:'/api/v1/models'};
  for (const [key,route] of Object.entries(routes)) {
    try { result[key] = await jsonRequest(config.baseUrl + route, key === 'details' ? {model:config.model} : undefined); }
    catch(error) { result[key] = {error:error.message}; }
  }
  if (result.details?.template) result.templateHash = hash(result.details.template);
  if (typeof result.details?.modelfile === 'string') result.details.modelfile = portableModelfile(result.details.modelfile);
  return result;
}
export function hardChecks(item, response, input) {
  const validation = validateGuidanceResponse(input.slashCommand, response.text ?? '', guidanceResponseValidationOptions(input));
  const checks = [{name:'runtime_contract',passed:validation.ok, reason:validation.ok ? validation.outcome : validation.reason},
    {name:'output_complete',passed:response.finishReason !== 'length',reason:response.finishReason ?? 'unknown'}];
  let envelope;
  try { envelope = JSON.parse(response.text); } catch { /* recorded below */ }
  checks.push({name:'strict_json',passed:Boolean(envelope && typeof envelope === 'object' && !Array.isArray(envelope))});
  const text = validation.ok ? validation.text : response.text ?? '';
  if (item.expectedFocus) checks.push({name:'expected_focus',passed:validation.ok && item.expectedFocus.includes(validation.focus),reason:validation.focus ?? 'missing'});
  if (item.noCode) checks.push({name:'no_fenced_code',passed:!text.includes('```')});
  if (item.maxChars) checks.push({name:'explicit_length_bound',passed:text.length <= item.maxChars,reason:`${text.length}/${item.maxChars} chars`});
  for (const forbidden of item.forbidden ?? []) checks.push({name:`forbidden:${forbidden}`,passed:!text.includes(forbidden)});
  return {validation,checks};
}
export function createClient(config) {
  const Base = config.provider === 'ollama' ? OllamaClient : LmStudioClient;
  return new class extends Base {
    calls = [];
    async requestJson(url, init, ...rest) {
      if (init.method !== 'POST') return super.requestJson(url, init, ...rest);
      let body = JSON.parse(init.body);
      if (config.transport === 'ollama-native') {
        url = config.baseUrl + '/api/chat';
        body = {model:body.model,messages:body.messages,stream:false,think:body.reasoning_effort !== 'none',
          options:{num_predict:body.max_tokens,...config.sampling,...(config.contextLength ? {num_ctx:config.contextLength} : {})}};
      } else {
        Object.assign(body, config.sampling);
        if (config.contextLength) body.context_length = config.contextLength;
      }
      const call = {url,body,startedAt:new Date().toISOString()};
      this.calls.push(call);
      const start = performance.now();
      try {
        const payload = await super.requestJson(url,{...init,body:JSON.stringify(body)},...rest);
        call.latencyMs = performance.now() - start;
        const msg = payload.choices?.[0]?.message ?? payload.message;
        call.reasoningChars = (msg?.reasoning ?? msg?.reasoning_content ?? msg?.thinking ?? '').length ||
          (payload.output ?? []).filter(x => x.type === 'reasoning').reduce((n,x) => n + (x.content?.length ?? 0),0);
        call.stats = payload.stats ?? {usage:payload.usage ?? null, prompt_eval_count:payload.prompt_eval_count ?? null,
          eval_count:payload.eval_count ?? null, prompt_eval_duration:payload.prompt_eval_duration ?? null,
          eval_duration:payload.eval_duration ?? null, load_duration:payload.load_duration ?? null,total_duration:payload.total_duration ?? null};
        if (config.transport !== 'ollama-native') return payload;
        return {model:payload.model,choices:[{message:{content:payload.message?.content},finish_reason:payload.done_reason}],
          usage:{prompt_tokens:payload.prompt_eval_count,completion_tokens:payload.eval_count}};
      } catch(error) { call.latencyMs = performance.now() - start; call.error = error.message; throw error; }
    }
  }();
}
export async function generate(item, config, client) {
  const prepared = prepare(item, config), attempts = [];
  let request = prepared.request;
  const started = performance.now();
  const callStart = client.calls.length;
  let failure = null;
  try {
    for (let i = 0; i < 2; i++) {
      assertRequestInputLimit(request,prepared.profile.contextBudget);
      const response = await client.createCompletion(config.baseUrl,config.model,request,
        prepared.plan.targetFiles.filter(file => file.included).map(file => file.path));
      const check = hardChecks(item,response,prepared.input);
      attempts.push({response,...check});
      if (check.validation.ok || response.finishReason === 'length' || i === 1) break;
      request = {...request,systemPrompt:buildGuidanceFormatRepairPrompt(prepared.request.systemPrompt,check.validation.reason,prepared.input.kind),
        purpose:prepared.input.slashCommand === 'flow' ? 'flowRepair' : 'guidance'};
    }
  } catch(error) { failure = error.message; }
  const last = attempts.at(-1);
  const delivered = !failure && last?.validation.ok && last.response.finishReason !== 'length' ? last.validation : null;
  return {caseId:item.id, category:item.category,caseHash:hash(item),prepared,attempts,calls:client.calls.slice(callStart),
    latencyMs:performance.now()-started,failure,delivered,
    hardPassed:!failure && Boolean(last?.checks.every(x => x.passed)),
    failureCategories:[...(failure ? ['infrastructure'] : []),...(!last?.validation.ok && !failure ? ['invalid_format'] : []),
      ...(last?.response.finishReason === 'length' ? ['output_limit'] : []),...(prepared.evidencePresent === false ? ['missing_context'] : [])]};
}
export function shuffle(values, seed) {
  const items = [...values]; let counter = 0;
  for (let i = items.length - 1; i > 0; i--) {
    const j = parseInt(hash(`${seed}:${counter++}`).slice(0,8),16) % (i+1);
    [items[i],items[j]] = [items[j],items[i]];
  }
  return items;
}
export const randomSeed = () => randomBytes(16).toString('hex');
export const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
export function percentile(xs,p) {
  const sorted = [...xs].sort((a,b)=>a-b);
  if(!sorted.length)return null;
  if(p===.5 && sorted.length%2===0)return (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
  return sorted[Math.max(0,Math.ceil(p*sorted.length)-1)];
}
