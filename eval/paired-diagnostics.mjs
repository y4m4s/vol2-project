import assert from 'node:assert/strict';
import {readJson,save,hash,mean,percentile} from './lib.mjs';
import {metrics} from './statistics.mjs';
const prefix=process.argv[2];if(!prefix)throw Error('Pass paired run prefix');
const roots=['baseline','candidate'].map(s=>`${prefix}-${s}`),ms=roots.map(p=>readJson(`${p}/manifest.json`)),rs=roots.map(p=>readJson(`${p}/responses.json`));
assert.ok(ms.every(m=>m.finishedAt),'Incomplete paired run');
assert.equal(ms[0].caseSetHash,ms[1].caseSetHash);assert.equal(ms[0].orderSeed,ms[1].orderSeed);
const cases=readJson(`${roots[0]}/cases.json`);
assert.equal(rs[0].length,cases.length*ms[0].repeats);assert.equal(rs[1].length,rs[0].length);
const control=ms[0].config.thinking!==ms[1].config.thinking?'thinking':'automatic-policy';
const allowed=control==='thinking'?'reasoningEffort':'systemPrompt';
const pairs=rs[0].map(a=>{
  const b=rs[1].find(r=>r.caseId===a.caseId&&r.repeat===a.repeat);assert.ok(b);
  assert.deepEqual(a.prepared.input,b.prepared.input);
  assert.deepEqual({...b.prepared.request,[allowed]:a.prepared.request[allowed]},a.prepared.request,'Unexpected request change');
  const clean=c=>{const x={...c};delete x.id;delete x[control==='thinking'?'thinking':'promptVersion'];return x;};
  assert.deepEqual(clean(ms[0].config),clean(ms[1].config),'Multiple config variables changed');
  assert.equal(a.pairedSequence.pair,b.pairedSequence.pair);assert.notEqual(a.pairedSequence.position,b.pairedSequence.position);
  return {caseId:a.caseId,repeat:a.repeat,baselineFirst:a.pairedSequence.position===0,inputHash:hash(a.prepared.input),baselineRequestHash:hash(a.prepared.request),candidateRequestHash:hash(b.prepared.request)};
});
const runs=rs.map((rows,i)=>{
  const auto=rows.filter(r=>r.prepared.input.kind==='always'),correct=auto.filter(r=>cases.find(c=>c.id===r.caseId).variant==='correct'),defective=auto.filter(r=>['buggy','incomplete'].includes(cases.find(c=>c.id===r.caseId).variant));
  return {run:roots[i],...metrics(rows),thinkingObserved:rows.filter(r=>r.calls.some(c=>c.reasoningChars>0||c.stats?.reasoning_output_tokens>0)).length,
    reasoningTokensMedian:percentile(rows.flatMap(r=>r.attempts.map(a=>a.response.reasoningTokens).filter(Number.isFinite)),.5),
    reasoningCharsMedian:percentile(rows.map(r=>r.calls.reduce((n,c)=>n+(c.reasoningChars??0),0)),.5),
    outputTokensMean:mean(rows.flatMap(r=>r.attempts.map(a=>a.response.outputTokens).filter(Number.isFinite))),
    outputLimited:rows.filter(r=>r.failureCategories.includes('output_limit')).length,timeouts:rows.filter(r=>r.failure?.includes('timed out')).length,
    automaticCorrect:{n:correct.length,unnecessaryAdvice:correct.filter(r=>r.delivered?.outcome==='advice').length},
    automaticDefective:{n:defective.length,missedBySilence:defective.filter(r=>r.delivered?.outcome==='no_advice').length},
    requestSettings:[...new Set(rows.map(r=>JSON.stringify({thinking:r.prepared.request.reasoningEffort,maxOutputTokens:r.prepared.request.maxOutputTokens})))].map(JSON.parse)};
});
const ratio=runs[1].latencyMedianMs/runs[0].latencyMedianMs;
const summary={control,runs,pairs,latencyRatio:ratio,balancedFirstArm:Math.abs(pairs.filter(x=>x.baselineFirst).length-pairs.filter(x=>!x.baselineFirst).length)<=1,
  ...(control==='thinking'?{pilotExpansionAllowed:runs[1].n*(1-runs[1].hardPassRate)<2&&ratio<=3&&runs[1].thinkingObserved>0}:{}),
  note:'Mechanical diagnostics only. Semantic judgments required. Timeout without received reasoning counters is unknown, not proof Thinking was off.'};
save(`${prefix}-diagnostics.json`,summary);console.log(JSON.stringify(summary,null,2));
