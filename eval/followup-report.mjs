import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readJson,save,hash,loadCases} from './lib.mjs';

// Apply predeclared gates to explicit manual reviews. Never promotes production.
const decisions=[];
for(const provider of ['lm','oll'])for(const round of ['thinking','automatic']){
  const prefix=`eval/results/af-${provider}-${round}${round==='thinking'?'-pilot':''}`;
  const comparison=`eval/results/af-${provider}-${round}-comparison`;
  const d=readJson(`${prefix}-diagnostics.json`),s=readJson(`${comparison}/summary.json`);
  assert.deepEqual(d.runs.map(r=>r.run),[s.baselineRun,s.candidateRun]);
  const cases=readJson(`${s.baselineRun}/cases.json`);
  const defective=s.rows.filter(r=>{
    const c=cases.find(c=>c.id===r.caseId);
    return c.input.kind==='always'&&['buggy','incomplete'].includes(c.variant);
  });
  assert.ok(s.rows.every(r=>['baseline','candidate'].every(side=>typeof r[side].meetsTask==='boolean')));
  const taskSuccess=side=>s.rows.filter(r=>r[side].meetsTask).length;
  const defectSuccess=side=>defective.filter(r=>r[side].meetsTask).length;
  const gates={...s.gates,...(round==='thinking'?{pilotFeasible:d.pilotExpansionAllowed}:{
    fewerUnnecessaryInterventions:d.runs[1].automaticCorrect.unnecessaryAdvice<d.runs[0].automaticCorrect.unnecessaryAdvice,
    noLossOfDefectTaskSuccess:defectSuccess('candidate')>=defectSuccess('baseline'),
    noMoreMissedBySilence:d.runs[1].automaticDefective.missedBySilence<=d.runs[0].automaticDefective.missedBySilence
  })};
  decisions.push({provider,round,comparison,diagnostics:`${prefix}-diagnostics.json`,
    n:s.rows.length,taskSuccess:{baseline:taskSuccess('baseline'),candidate:taskSuccess('candidate')},
    defectiveTaskSuccess:{n:defective.length,baseline:defectSuccess('baseline'),candidate:defectSuccess('candidate')},
    pairwiseWinRate:s.pairwiseWinRate,problemBalancedWinRate:s.problemBalancedWinRate,ci95:s.ci95,
    axes:s.axes,latencyRatio:d.latencyRatio,gates,
    failedGates:Object.entries(gates).filter(([,ok])=>!ok).map(([name])=>name),
    decision:Object.values(gates).every(Boolean)?'eligible_for_confirmation_not_adopted':'reject_keep_production',
    nextHypothesis:round==='thinking'?'Explicit manual reasoning may merit an opt-in latency budget; no automatic/default rollout from this pilot.':'Investigate contract confusion and defect-specific reasoning using independent execution evidence, rather than forcing silence.'});
}
const freeze=readJson('eval/results/af-preregistration.json');
assert.equal(hash(loadCases('holdout',undefined,'algorithms-v2')),freeze.holdoutCaseSetHash,'Fresh holdout changed');
let confirmation=null;
const confirmationPath='eval/results/af-lm-confirmation-comparison/summary.json';
if(existsSync(confirmationPath)){
  const s=readJson(confirmationPath),d=readJson('eval/results/af-lm-confirmation-diagnostics.json');
  assert.equal(s.split,'holdout');
  assert.equal(readJson(`${s.baselineRun}/manifest.json`).caseSetHash,freeze.holdoutCaseSetHash);
  const cases=readJson(`${s.baselineRun}/cases.json`);
  const subset=kind=>s.rows.filter(r=>cases.find(c=>c.id===r.caseId).input.kind===kind);
  const task=rows=>Object.fromEntries(['baseline','candidate'].map(side=>[side,rows.filter(r=>r[side].meetsTask).length]));
  const total=task(s.rows),automatic=task(subset('always'));
  const gates={noNewHardFailures:s.gates.noNewHardFailures,criticalAxes:s.gates.criticalAxes,latency:s.gates.latency,
    noLossOfTaskSuccess:total.candidate>=total.baseline,
    noLossOfAutomaticTaskSuccess:automatic.candidate>=automatic.baseline,
    noMoreMissedBySilence:d.runs[1].automaticDefective.missedBySilence<=d.runs[0].automaticDefective.missedBySilence};
  confirmation={summary:confirmationPath,n:s.rows.length,taskSuccess:total,automaticTaskSuccess:automatic,
    unchangedManualControls:task(subset('manual')),gates,
    decision:Object.values(gates).every(Boolean)?'pending_qualitative_review_not_adopted':'reject_keep_production',
    warning:'Holdout is now observed. Do not tune against these answers and reuse it as unseen evidence.'};
}
save('eval/results/af-decisions.json',{plan:'eval/FOLLOWUP_THINKING_PLAN.md',decisions,
  confirmation,champion:'Current production; no automatic adoption from numeric gates.',
  holdout:{caseSetHash:freeze.holdoutCaseSetHash,unchanged:true,observed:Boolean(confirmation)},
  limitations:'Shared-design Codex judge; no independent external judge or order reversal. Thinking pilot only four pairs/provider; automatic round five problem clusters. No model-capability ceiling claim.'});
console.log(JSON.stringify({decisions:decisions.map(({provider,round,n,taskSuccess,gates,decision})=>({provider,round,n,taskSuccess,gates,decision})),confirmation},null,2));
