import { existsSync } from 'node:fs';
import { readJson,save,hash,mean,percentile } from './lib.mjs';
import { metrics } from './statistics.mjs';

// Derive metrics from saved observations; never runs inference or chooses a winner.
const root = 'eval/results';
const comparisons = ['sm-context-comparison','sm-temperature-comparison','sm-oll-transport-comparison','sm-oll-context-comparison'];
const summaries = comparisons.map(name => {
  const s=readJson(`${root}/${name}/summary.json`);
  return {name,baseline:s.baselineRun,candidate:s.candidateRun,winRate:s.pairwiseWinRate,ci95:s.ci95,
    wins:s.rows.filter(x=>x.win===1).length,ties:s.ties,losses:s.rows.filter(x=>x.win===0).length,
    axes:s.axes,gates:s.gates,latency:{baseline:s.baseline,candidate:s.candidate},
    failures:Object.fromEntries([...new Set(s.rows.flatMap(x=>x.candidate.failures))].map(f=>[f,s.rows.filter(x=>x.candidate.failures.includes(f)).length]))};
});
const names=['sm-oll-file-openai','sm-oll-file4','sm-oll-file8'];
const context=names.map(name=>{
  const responses=readJson(`${root}/${name}/responses.json`),env=readJson(`${root}/${name}/environment-after.json`);
  const summary=readJson(`${root}/${name==='sm-oll-file8'?'sm-oll-context-comparison':'sm-oll-transport-comparison'}/summary.json`);
  const side=name==='sm-oll-file-openai'?'baseline':'candidate';
  return {name,allocation:env.loaded?.models?.[0]?.context_length??null,...metrics(responses),
    meanCorrectness:summary.axes.correctness[side],
    promptObservations:responses.map(x=>({caseId:x.caseId,repeat:x.repeat,
      // Hash role contents, independent of transport wrapper and generation options.
      promptHash:hash([x.prepared.request.systemPrompt,x.prepared.request.userPrompt]),
      estimate:x.prepared.approximateInputTokens,processed:x.attempts[0]?.response.inputTokens??null,
      output:x.attempts.at(-1)?.response.outputTokens??null,evidencePresent:x.prepared.evidencePresent}))};
});
const first=context[0].promptObservations;
const identical=context.every(c=>c.promptObservations.every(x=>{
  const a=first.find(y=>y.caseId===x.caseId&&y.repeat===x.repeat);
  return a?.promptHash===x.promptHash && a.processed===x.processed;
}));
const frontier=context.filter(a=>!context.some(b=>b!==a && b.meanCorrectness>=a.meanCorrectness && b.latencyMedianMs<=a.latencyMedianMs && (b.meanCorrectness>a.meanCorrectness || b.latencyMedianMs<a.latencyMedianMs))).map(x=>x.name);
const groups={};
for(const name of ['sm-lm-viewport','sm-lm-file']) {
  const xs=readJson(`${root}/${name}/responses.json`);
  groups[name]=Object.fromEntries([true,false].map(changed=>{const rs=xs.filter(x=>Boolean(x.prepared.collection)===changed);return [changed?'changedInputs':'identicalInputs',{n:rs.length,medianMs:percentile(rs.map(x=>x.latencyMs),.5),p95Ms:percentile(rs.map(x=>x.latencyMs),.95),evidenceRate:changed?mean(rs.map(x=>+x.prepared.evidencePresent)):null}];}));
}
const holdout=['sm-lm-file-holdout','sm-oll-file-openai-holdout'].flatMap(name=>existsSync(`${root}/${name}/assessment.json`)?[{name,...readJson(`${root}/${name}/assessment.json`)}]:[]);
save(`${root}/sm-summary.json`,{summaries,context:{runs:context,identicalPromptAndProcessedTokens:identical,observedCorrectnessLatencyFrontier:frontier,
  limitations:'3 cases x3, serial blocks; cache/cold load/order not counterbalanced. Processed tokens are not a tokenizer proof of no truncation. Frontier uses mean correctness, not every rubric axis.'},groups,holdout});
console.log(JSON.stringify({comparisons:summaries.map(x=>({name:x.name,wins:x.wins,ties:x.ties,losses:x.losses,winRate:x.winRate})),identicalPromptAndProcessedTokens:identical,frontier,holdout:holdout.map(x=>({name:x.name,meetsTask:x.meetsTask,n:x.cases?.length}))},null,2));
