import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCases,prepare,readJson,validateConfig,createClient,hardChecks,headTail,hash,AXES,generate } from './lib.mjs';
import { validateJudgments,bootstrapCases,metrics } from './statistics.mjs';
const lm=readJson('eval/configs/baseline-lmstudio.json'),oll=readJson('eval/configs/baseline-ollama.json');
test('small-medium suite is frozen separately and collector control changes only editor evidence',()=>{
  const cases=loadCases('tuning',undefined,'small-medium');
  assert.equal(cases.length,10);
  for(const item of cases) {
    const a=prepare(item,{...lm,collectorContext:'viewport'}),b=prepare(item,{...lm,collectorContext:'bounded-file'});
    assert.equal(a.request.systemPrompt,b.request.systemPrompt);
    assert.equal(a.request.maxOutputTokens,b.request.maxOutputTokens);
    assert.equal(a.request.reasoningEffort,b.request.reasoningEffort);
    if(item.viewport!==undefined){assert.equal(a.evidencePresent,false);assert.equal(b.evidencePresent,true);}
    else assert.deepEqual(a.request,b.request);
  }
  assert.throws(()=>loadCases('holdout','eval/cases/small-medium-tuning.json','small-medium'));
  assert.throws(()=>loadCases('tuning',undefined,'unknown'));
});
test('production planner retains collected evidence for both local providers',()=>{
  const item=loadCases('tuning').find(c=>c.id==='long-active-tail');
  const a=prepare(item,lm),b=prepare(item,oll);
  assert.equal(a.evidencePresent,true);assert.equal(b.evidencePresent,true);
  assert.equal(a.request.maxOutputTokens,2048);assert.equal(b.request.maxOutputTokens,8192);
  assert.equal(a.request.reasoningEffort,'none');assert.equal(b.request.reasoningEffort,'none');
  const c=prepare(item,{...lm,contextStrategy:'head-tail-v1'});
  assert.equal(c.evidencePresent,true);assert.equal(c.request.systemPrompt,a.request.systemPrompt);
  assert.equal(c.input.context.activeFileExcerpt.length,2000);
});
test('head-tail preserves budget and short inputs',()=>{
  assert.equal(headTail('abc',2000),'abc');assert.equal(headTail('x'.repeat(3000)+'END',2000).length,2000);
  assert.ok(headTail('x'.repeat(3000)+'END',2000).endsWith('END'));
});
test('unsupported native sampling/context controls fail rather than silently disappear',()=>{
  assert.throws(()=>validateConfig({...oll,sampling:{top_k:20}}));
  assert.throws(()=>validateConfig({...oll,contextLength:8192}));
  assert.throws(()=>validateConfig({...lm,sampling:{top_p:2}}));
  assert.throws(()=>validateConfig({...lm,baseUrl:'http://example.com'}));
  assert.throws(()=>validateConfig({...lm,languageReference:'unknown'}));
  assert.throws(()=>loadCases('holdout','eval/cases/reference-transfer.json'));
  assert.doesNotThrow(()=>validateConfig({...oll,transport:'ollama-native',contextLength:8192,sampling:{top_k:20,min_p:0}}));
});
test('baseline wire roles and limits come from production client; native conversion is isolated',async()=>{
  const original=globalThis.fetch,seen=[];
  globalThis.fetch=async(url,init)=>{seen.push({url,body:JSON.parse(init.body)});return new Response(JSON.stringify(url.endsWith('/api/chat')
    ? {model:oll.model,message:{content:'{"kind":"advice","text":"確認"}',thinking:''},done_reason:'stop',prompt_eval_count:200,eval_count:20}
    : {model:oll.model,choices:[{message:{content:'{"kind":"advice","text":"確認"}'},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:20}}),{headers:{'Content-Type':'application/json'}});};
  try {
    const request={systemPrompt:'system',userPrompt:'data',purpose:'guidance',reasoningEffort:'none',maxOutputTokens:2048};
    await createClient(oll).createCompletion(oll.baseUrl,oll.model,request,['main.ts']);
    assert.deepEqual(seen[0].body,{reasoning_effort:'none',model:oll.model,messages:[{role:'system',content:'system'},{role:'user',content:'data'}],stream:false,max_tokens:2048,navicom_referenced_files:['main.ts']});
    const native=createClient({...oll,transport:'ollama-native',contextLength:8192,sampling:{top_k:20}});
    const response=await native.createCompletion(oll.baseUrl,oll.model,request);
    assert.equal(seen[1].url,oll.baseUrl+'/api/chat');assert.equal(seen[1].body.think,false);
    assert.deepEqual(seen[1].body.options,{num_predict:2048,top_k:20,num_ctx:8192});assert.equal(response.inputTokens,200);
  } finally {globalThis.fetch=original;}
});
test('runtime accepted silence can still fail semantic hard check',()=>{
  const item=loadCases('tuning').find(c=>c.id==='auto-layout');
  const result=hardChecks(item,{text:'{"kind":"no_advice","focus":"none"}',finishReason:'stop'},item.input);
  assert.equal(result.validation.ok,true);assert.equal(result.checks.find(x=>x.name==='expected_focus').passed,false);
});
test('format repair is bounded and uses manual kind rather than automatic kind',async()=>{
  const item=loadCases('tuning')[0],requests=[];
  const client={calls:[],async createCompletion(_url,_model,req){requests.push(req);return {text:requests.length===1?'not json':'{"kind":"advice","text":"最後の添字を確認してみましょう。"}',finishReason:'stop'};}};
  const result=await generate(item,lm,client);assert.equal(requests.length,2);assert.equal(result.delivered.outcome,'advice');
  assert.ok(requests[1].systemPrompt.includes('advice'));assert.equal(requests[1].maxOutputTokens,requests[0].maxOutputTokens);
});
test('judge accepts complete anchored scores and rejects omission, duplication, candidate self-judge',()=>{
  const pair={pairId:'p',A:{text:'a'},B:{text:'b'}},packet={pairs:[pair]};
  const score={scores:Object.fromEntries(AXES.map(x=>[x,3])),reasons:Object.fromEntries(AXES.map(x=>[x,'evidence'])),failures:[]};
  const result={judge:{id:'external-reviewer',candidateModel:false},packetHash:hash(packet),judgments:[{pairId:'p',pairHash:hash(pair),verdict:'tie',reason:'equal',A:score,B:score}]};
  assert.doesNotThrow(()=>validateJudgments(result,packet));
  assert.throws(()=>validateJudgments({...result,judgments:[]},packet));
  assert.throws(()=>validateJudgments({...result,judgments:[...result.judgments,...result.judgments]},packet));
  assert.throws(()=>validateJudgments({...result,judge:{id:'qwen3:8b',candidateModel:false}},packet));
});
test('bootstrap treats repeated samples as one case cluster',()=>{
  const rows=[{caseId:'one',win:1},{caseId:'two',win:0}];
  assert.deepEqual(bootstrapCases(rows),bootstrapCases([...rows,...rows,...rows]));
  assert.equal(bootstrapCases(rows).cases,2);
});
test('HTTP failures without stats remain measurable and never invent token throughput',()=>{
  const result=metrics([{latencyMs:104,hardPassed:false,attempts:[],calls:[{error:'HTTP 500',latencyMs:104}],failureCategories:['infrastructure']}]);
  assert.equal(result.tokensPerSecondMedian,null);assert.equal(result.inputTokensMean,null);
  assert.equal(result.hardPassRate,0);assert.equal(result.pipelineFailures.infrastructure,1);
});
