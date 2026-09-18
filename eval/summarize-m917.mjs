// Rebuild the model-screen summary from frozen responses and explicit reviews.
import {readJson,save,mean,percentile} from './lib.mjs';
import {metrics} from './statistics.mjs';
const loaded=readJson('eval/results/m917-oll-vulkan-loaded-samples.json').flatMap(x=>x.loaded.models);
const runs=[];
for(const prefix of ['m917-lm','m917-oll-vulkan']) {
  const comparison=readJson(`eval/results/${prefix}-comparison/summary.json`);
  for(const side of ['baseline','candidate']) {
    const root=`eval/results/${prefix}-${side}`,manifest=readJson(`${root}/manifest.json`);
    if(!manifest.finishedAt)throw Error(`Incomplete: ${root}`);
    const responses=readJson(`${root}/responses.json`),before=readJson(`${root}/environment-before.json`);
    const config=manifest.config,model=before.models.models.find(x=>(x.key??x.name)===config.model);
    const observations=comparison.rows.map(row=>({caseId:row.caseId,...row[side]}));
    const lowLoad=responses.filter(r=>r.calls.length&&r.calls.every(c=>Number.isFinite(c.stats?.load_duration)&&c.stats.load_duration<1e9));
    const tokenCounts=responses.flatMap(r=>r.attempts.map(a=>a.response.inputTokens).filter(Number.isFinite));
    const calls=responses.flatMap(r=>r.calls);
    runs.push({run:root,model:config.model,provider:config.provider,transport:config.transport,config,
      quantization:model.quantization?.name??model.details?.quantization_level,
      contextObserved:config.provider==='lmStudio'?model.loaded_instances?.[0]?.config.context_length:loaded.find(x=>x.name===config.model)?.context_length,
      modelDigest:model.digest??null,modelParameterDefaults:before.details?.parameters??null,
      ...metrics(responses),meetsTask:observations.filter(x=>x.meetsTask).length,
      axes:Object.fromEntries(Object.entries(comparison.axes).map(([axis,values])=>[axis,values[side]])),
      inputTokensMin:Math.min(...tokenCounts),inputTokensMax:Math.max(...tokenCounts),
      outputTokensTotal:responses.reduce((n,r)=>n+r.attempts.reduce((a,b)=>a+(b.response.outputTokens??0),0),0),
      repairs:responses.filter(r=>r.attempts.length>1).length,
      reasoningChars:calls.reduce((n,c)=>n+(c.reasoningChars??0),0),
      lowLoad:{definition:'All calls report load_duration < 1 second; not a controlled warm-cache benchmark.',...metrics(lowLoad)},
      outputTokensPerResponseMean:mean(responses.map(r=>r.attempts.reduce((n,a)=>n+(a.response.outputTokens??0),0))),
      loadDurationP95Ms:percentile(calls.map(c=>c.stats?.load_duration/1e6).filter(Number.isFinite),.95),
      pairwise:side==='candidate'?{winRate:comparison.pairwiseWinRate,ci95:comparison.ci95,ties:comparison.ties}:null,
      semanticFailures:Object.fromEntries([...new Set(observations.flatMap(x=>x.failures))].map(f=>[f,observations.filter(x=>x.failures.includes(f)).length])),
      observations});
  }
}
save('eval/results/m917-summary.json',{scope:'Exploratory 16-case screen per deployment. Previously observed tuning set, one sample each. Same-agent anonymous judgment. Not a final adoption or unseen holdout evaluation.',hardware:readJson('eval/results/m917-hardware.json'),runs});
console.log(JSON.stringify(runs.map(({model,provider,meetsTask,hardPassRate,latencyMedianMs,tokensPerSecondMedian,lowLoad,repairs})=>({model,provider,meetsTask,hardPassRate,latencyMedianMs,tokensPerSecondMedian,lowLoadN:lowLoad.n,lowLoadMedianMs:lowLoad.latencyMedianMs,repairs})),null,2));
