import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { readJson,save,hash,AXES,mean } from './lib.mjs';
import { metrics } from './statistics.mjs';
import { problemText } from './algorithms.mjs';

// Recompute delivery metrics and join explicitly reviewed judgments. No inferred semantic scores.
const {values:v}=parseArgs({options:{runs:{type:'string'},comparisons:{type:'string'},out:{type:'string'}}});
if(!v.runs||!v.out)throw Error('Usage: node eval/algorithm-report.mjs --runs RUN,RUN --comparisons COMPARISON --out SUMMARY.json');
const comparisons=(v.comparisons?.split(',')??[]).map(dir=>readJson(`${dir}/summary.json`));
const runs=v.runs.split(',').map(dir=>{
  const manifest=readJson(`${dir}/manifest.json`),cases=readJson(`${dir}/cases.json`),responses=readJson(`${dir}/responses.json`);
  if(!['algorithms','algorithms-v2'].includes(manifest.suite)||!manifest.finishedAt||hash(cases)!==manifest.caseSetHash)throw Error('Incomplete or changed algorithm run');
  const comparison=comparisons.find(x=>[x.baselineRun,x.candidateRun].includes(dir));
  let reviewed=[];
  if(comparison){
    const side=comparison.baselineRun===dir?'baseline':'candidate';
    reviewed=comparison.rows.map(x=>({caseId:x.caseId,repeat:x.repeat,...x[side]}));
  }else if(existsSync(`${dir}/assessment.json`)){
    const assessment=readJson(`${dir}/assessment.json`);
    if(assessment.caseSetHash!==manifest.caseSetHash||assessment.responsesHash!==hash(responses)||assessment.rubricHash!==manifest.rubricHash||assessment.judge?.candidateModel!==false)throw Error('Unanchored assessment');
    reviewed=assessment.observations;
    const seen=new Set();
    for(const row of reviewed){
      const result=responses.find(x=>x.caseId===row.caseId&&x.repeat===row.repeat),key=`${row.caseId}:${row.repeat}`;
      if(!result||seen.has(key)||row.caseHash!==result.caseHash||row.answerHash!==hash(result.delivered)||typeof row.meetsTask!=='boolean')throw Error('Changed or duplicate assessment observation');
      seen.add(key);
      for(const axis of AXES)if(!Number.isInteger(row.scores?.[axis])||row.scores[axis]<0||row.scores[axis]>4||!row.reasons?.[axis])throw Error('Incomplete assessment axes');
      if(!Array.isArray(row.failures))throw Error('Missing failure categories');
    }
    if(reviewed.length!==responses.length)throw Error('Incomplete assessment');
  }
  const observations=responses.map(r=>{
    const item=cases.find(c=>c.id===r.caseId),judgment=reviewed.find(x=>x.caseId===r.caseId&&x.repeat===r.repeat);
    return {...r,language:item.language,variant:item.variant,problemId:item.problemId,kind:item.input.kind,judgment,
      inputIntegrity:{activeFilePreserved:r.prepared.input.context.activeFileExcerpt===item.code,
        problemPreserved:r.prepared.input.context.additionalContext===problemText(item.problem,manifest.config.problemLayout??'plain')}};
  });
  function summarize(xs){
    const judged=xs.filter(x=>x.judgment),correct=xs.filter(x=>x.kind==='always'&&x.variant==='correct');
    const defective=xs.filter(x=>x.kind==='always'&&['buggy','incomplete'].includes(x.variant));
    return {...metrics(xs),problemGroups:new Set(xs.map(x=>x.problemId)).size,
      automaticCorrect:{n:correct.length,unnecessaryAdvice:correct.filter(x=>x.delivered?.outcome==='advice').length,deliveryFailures:correct.filter(x=>!x.delivered).length},
      automaticDefective:{n:defective.length,missedBySilence:defective.filter(x=>x.delivered?.outcome==='no_advice').length,deliveryFailures:defective.filter(x=>!x.delivered).length},
      reviewed:judged.length,meetsTask:judged.length&&judged.every(x=>typeof x.judgment.meetsTask==='boolean')?judged.filter(x=>x.judgment.meetsTask).length:null,
      axes:judged.length?Object.fromEntries(AXES.map(axis=>[axis,mean(judged.map(x=>x.judgment.scores[axis]))])):null,
      semanticFailures:Object.fromEntries([...new Set(judged.flatMap(x=>x.judgment.failures))].map(f=>[f,judged.filter(x=>x.judgment.failures.includes(f)).length]))};
  }
  return {run:dir,experimentId:manifest.experimentId,split:manifest.split,provider:manifest.config.provider,config:manifest.config,...summarize(observations),
    by:Object.fromEntries(['language','category','variant','problemId'].map(key=>[key,Object.fromEntries([...new Set(observations.map(x=>x[key]))].map(value=>[value,summarize(observations.filter(x=>x[key]===value))]))])),
    promptTokens:observations.map(x=>({caseId:x.caseId,repeat:x.repeat,approximate:x.prepared.approximateInputTokens,processed:x.attempts[0]?.response.inputTokens??null,...x.inputIntegrity})),
    oracle:cases.map(c=>({caseId:c.id,...c.oracleEvidence}))};
});
save(v.out,{runs,comparisons:comparisons.map(s=>({baseline:s.baselineRun,candidate:s.candidateRun,winRate:s.pairwiseWinRate,problemBalancedWinRate:s.problemBalancedWinRate,ci95:s.ci95,gates:s.gates,axes:s.axes})),
  limitations:'Synthetic original problems. Language/variant/repeat samples share problem groups. Execution covers stated finite domains only. Hard checks are not semantic correctness. Null semantic scores mean unreviewed.'});
console.log(JSON.stringify(runs.map(r=>({run:r.run,n:r.n,hard:r.hardPassRate,medianMs:r.latencyMedianMs,automaticCorrect:r.automaticCorrect,automaticDefective:r.automaticDefective,reviewed:r.reviewed})),null,2));
