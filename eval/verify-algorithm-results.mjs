import assert from 'node:assert/strict';
import {readJson,save,hash,hardChecks,prepare,loadCases,provenance} from './lib.mjs';
import {algorithmProvenance} from './algorithms.mjs';
import {validateJudgments} from './statistics.mjs';
const names=['alg-lm-baseline-v2','alg-lm-sections','alg-oll-baseline','alg-lm-holdout','alg-oll-holdout'];
const freeze=readJson('eval/results/alg-freeze.json');
const current=provenance();
for(const field of ['files','promptRevision','harnessHash'])assert.deepEqual(current[field],freeze.source[field],'Production input pipeline changed after selection');
const runs=names.map(name=>{
  const root=`eval/results/${name}`,m=readJson(`${root}/manifest.json`),cases=readJson(`${root}/cases.json`),rs=readJson(`${root}/responses.json`);
  assert.equal(hash(cases),m.caseSetHash);
  assert.equal(hash(loadCases(m.split,undefined,'algorithms')),m.caseSetHash);
  if(m.split==='holdout')assert.equal(m.caseSetHash,freeze.holdoutCaseSetHash);
  for(const r of rs){
    const item=cases.find(x=>x.id===r.caseId);
    assert.equal(hash(item),r.caseHash);
    assert.deepEqual(JSON.parse(JSON.stringify(prepare(item,m.config).request)),r.prepared.request);
    for(const a of r.attempts)assert.deepEqual(JSON.parse(JSON.stringify(hardChecks(item,a.response,r.prepared.input))),{validation:a.validation,checks:a.checks});
  }
  return {run:root,observations:rs.length,responsesHash:hash(rs),originalAlgorithmProvenance:m.algorithmProvenance,allPromptsAndChecksUnchanged:true};
});
const directory='eval/results/alg-lm-layout-comparison';
validateJudgments(readJson(`${directory}/judgments.json`),readJson(`${directory}/blind.json`));
save('eval/results/alg-verification.json',{currentAlgorithmProvenance:algorithmProvenance(),runs,
  note:'After acquisition, scalar hard-check parsing was hardened against numeric prefixes and mixed duplicate labels. All 176 saved observations retain exactly the same prompts, runtime validation and hard-check results. No new inference or semantic retuning.'});
console.log('Verified 176 observations: frozen inputs, case hashes and all hard checks unchanged.');
