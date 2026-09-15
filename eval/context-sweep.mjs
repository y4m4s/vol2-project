// Controlled characterization. The same serialized prompt is replayed at each allocation.
import { parseArgs } from 'node:util';
import { readJson,save,hash,provenance,loadCases,prepare,createClient,probe,hardChecks,shuffle,randomSeed,newDirectory } from './lib.mjs';
const {values:v}=parseArgs({options:{out:{type:'string'},repeat:{type:'string',default:'2'}}});
if(!v.out)throw Error('Provide --out NEW_DIRECTORY');
const repeat=Number(v.repeat);if(!Number.isInteger(repeat)||repeat<1||repeat>5)throw Error('repeat 1..5');
const base={...readJson('eval/configs/ollama-native.json'),thinking:'none'},cases=loadCases('tuning');
const original=cases.find(x=>x.id==='additional-requirement');
const short={...structuredClone(original),id:'context-short',category:'context_diagnostic',expected:'最新の待機上限は17秒。旧仕様30秒とは区別する。',input:{...structuredClone(original.input),userPrompt:'最新仕様の待機上限を秒単位で教えて。',context:{...structuredClone(original.input.context),activeFileExcerpt:'const pending = true;',additionalContext:'旧仕様: 待機上限30秒。\n最新仕様: 待機上限17秒。旧仕様を置き換える。'}}};
const noise=structuredClone(short);noise.id='context-noise';noise.input.context.additionalContext='旧仕様: 待機上限30秒。\n'+'参考メモ: 背景色は白、ログ形式は固定。\n'.repeat(210)+'\n最新仕様: 待機上限17秒。旧仕様を置き換える。';
// Both prompts keep their answer BEFORE any application-side truncation boundary.
const appTruncated=cases.find(x=>x.id==='long-additional-tail');
const selected=[short,noise,appTruncated];
const prepared=Object.fromEntries(selected.map(item=>[item.id,prepare(item,base)]));
if(!prepared['context-noise'].request.userPrompt.includes('最新仕様: 待機上限17秒'))throw Error('Noise control accidentally app-truncated');
newDirectory(v.out);save(`${v.out}/cases.json`,selected);save(`${v.out}/prompts.json`,prepared);
const orderSeed=randomSeed(),manifest={kind:'context-characterization',provenance:provenance(),base,repeat,orderSeed,startedAt:new Date().toISOString(),allocations:[4096,8192,16384]};save(`${v.out}/manifest.json`,manifest);
const rows=[];
// Random allocation order avoids always warming the same setting first.
for(const length of shuffle(manifest.allocations,orderSeed)) {
  const config={...base,id:`context-${length}`,contextLength:length},client=createClient(config);
  for(let repetition=0;repetition<repeat;repetition++)for(const item of shuffle(selected,`${orderSeed}:${length}:${repetition}`)) {
    const p=prepared[item.id],start=performance.now(),callStart=client.calls.length;let response,error;
    try {response=await client.createCompletion(config.baseUrl,config.model,p.request);}catch(e){error=e.message;}
    const latencyMs=performance.now()-start;
    const loaded=await probe(config);
    rows.push({contextLength:length,caseId:item.id,repeat:repetition,promptHash:hash(p.request),response:response??null,error:error??null,
      latencyMs,calls:client.calls.slice(callStart),hard:response?hardChecks(item,response,p.input):null,
      allocatedContext:loaded.loaded?.models?.find(x=>x.name===config.model)?.context_length??null});
    save(`${v.out}/responses.json`,rows);console.log(`${length} ${item.id} #${repetition} input=${response?.inputTokens??'?'} alloc=${rows.at(-1).allocatedContext} ms=${Math.round(rows.at(-1).latencyMs)}`);
  }
}
save(`${v.out}/manifest.json`,{...manifest,finishedAt:new Date().toISOString()});
