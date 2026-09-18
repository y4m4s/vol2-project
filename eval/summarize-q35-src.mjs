// Summarize a frozen production-source comparison, never re-run inference.
import assert from 'node:assert/strict';
import {readJson,save,hash,AXES,mean} from './lib.mjs';
import {metrics} from './statistics.mjs';

const trial=process.argv[2] ?? 'factual';
assert.ok(['factual','contract'].includes(trial));
const roots=['eval/results/q35-src-baseline',`eval/results/q35-src-${trial}`];
const runs=roots.map(root=>({manifest:readJson(`${root}/manifest.json`),responses:readJson(`${root}/responses.json`)}));
assert.ok(runs.every(x=>x.manifest.finishedAt));
assert.equal(runs[0].manifest.caseSetHash,runs[1].manifest.caseSetHash);
assert.equal(runs[0].manifest.rubricHash,runs[1].manifest.rubricHash);
const controls=runs.map(x=>{const {id,...settings}=x.manifest.config;return settings;});
assert.deepEqual(controls[0],controls[1]);
const comparison=readJson(`eval/results/${trial==='factual'?'q35-src':'q35-contract'}-comparison/summary.json`);
const observations=runs[0].responses.map(a=>{
  const b=runs[1].responses.find(x=>x.caseId===a.caseId&&x.repeat===a.repeat);
  assert.ok(b);assert.equal(a.caseHash,b.caseHash);
  const row=comparison.rows.find(x=>x.caseId===a.caseId&&x.repeat===a.repeat);
  const changed=hash(a.prepared.request)!==hash(b.prepared.request);
  const shouldChange=trial==='factual'?a.prepared.input.kind!=='always':a.prepared.input.kind==='always';
  assert.equal(changed,shouldChange,'Request change exceeded the declared experiment scope');
  return {caseId:a.caseId,repeat:a.repeat,requestChanged:changed,
    baselineHard:a.hardPassed,candidateHard:b.hardPassed,
    baselineMeetsTask:row.baseline.meetsTask,candidateMeetsTask:row.candidate.meetsTask,
    win:row.win,reason:row.reason,
    baselineAttempts:a.attempts.length,candidateAttempts:b.attempts.length,
    baselineLatencyMs:a.latencyMs,candidateLatencyMs:b.latencyMs};
});
const summary={controls:controls[0],
  limitation:'One sample/case, sequential runs, previously observed tuning cases, same-agent judge. Unchanged requests are negative controls; their output variation is not a source-change effect.',
  changedSourceModules:Object.keys(runs[0].manifest.provenance.files).filter(k=>runs[0].manifest.provenance.files[k]!==runs[1].manifest.provenance.files[k]),
  groups:Object.fromEntries([true,false].map(changed=>{
    const selected=observations.filter(x=>x.requestChanged===changed);
    const ids=new Set(selected.map(x=>x.caseId));
    const scored=comparison.rows.filter(x=>ids.has(x.caseId));
    return [changed?'changedRequests':'identicalRequests',{
      n:selected.length,
      baselineMeetsTask:selected.filter(x=>x.baselineMeetsTask).length,
      candidateMeetsTask:selected.filter(x=>x.candidateMeetsTask).length,
      wins:selected.filter(x=>x.win===1).length,losses:selected.filter(x=>x.win===0).length,ties:selected.filter(x=>x.win===.5).length,
      noNewHardFailures:selected.every(x=>!x.baselineHard||x.candidateHard),
      criticalAxesPass:['correctness','groundedness','instruction_following'].every(axis=>mean(scored.map(x=>x.candidate.scores[axis]-x.baseline.scores[axis]))>=-.25),
      axes:Object.fromEntries(AXES.map(axis=>[axis,{
        baseline:mean(scored.map(x=>x.baseline.scores[axis])),
        candidate:mean(scored.map(x=>x.candidate.scores[axis])),
        delta:mean(scored.map(x=>x.candidate.scores[axis]-x.baseline.scores[axis]))
      }])),
      baseline:metrics(runs[0].responses.filter(x=>ids.has(x.caseId))),
      candidate:metrics(runs[1].responses.filter(x=>ids.has(x.caseId)))
    }];
  })),observations};
save(`eval/results/${trial==='factual'?'q35-src':'q35-contract'}-summary.json`,summary);
console.log(JSON.stringify({...summary,observations:undefined},null,2));
