import { parseArgs } from 'node:util';
import { readFileSync,writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { readJson,save,loadCases,prepare,hardChecks,hash,newDirectory } from './lib.mjs';

// A scoring correction is a derived view, never a new independent inference sample.
const {values:v}=parseArgs({options:{source:{type:'string'},out:{type:'string'},reason:{type:'string'}}});
if(!v.source||!v.out||!v.reason)throw Error('Usage: node eval/recheck.mjs --source RUN --out NEW_RUN --reason EXPLANATION');
const manifest=readJson(`${v.source}/manifest.json`),original=readJson(`${v.source}/responses.json`);
if(!manifest.finishedAt||manifest.dry)throw Error('Only completed inference runs can be rechecked');
const cases=loadCases(manifest.split,undefined,manifest.suite).filter(c=>manifest.caseIds.includes(c.id));
if(cases.length!==manifest.caseIds.length)throw Error('Case set changed');
const serialized=value=>JSON.parse(JSON.stringify(value));
const responses=original.map(r=>{
  const item=cases.find(c=>c.id===r.caseId),prepared=prepare(item,manifest.config);
  if(!isDeepStrictEqual(serialized(prepared.request),r.prepared.request)||!isDeepStrictEqual(serialized(prepared.input),r.prepared.input))throw Error('Recheck cannot change model input');
  const attempts=r.attempts.map(a=>({...a,...hardChecks(item,a.response,r.prepared.input)}));
  if(attempts.some((a,i)=>!isDeepStrictEqual(serialized(a.validation),r.attempts[i].validation)))throw Error('Runtime validation changed; rerun required');
  return {...r,caseHash:hash(item),attempts,hardPassed:!r.failure&&Boolean(attempts.at(-1)?.checks.every(c=>c.passed))};
});
newDirectory(v.out);
for(const name of ['environment-before.json','environment-after.json','rubric.md'])writeFileSync(`${v.out}/${name}`,readFileSync(`${v.source}/${name}`));
save(`${v.out}/cases.json`,cases);save(`${v.out}/responses.json`,responses);
save(`${v.out}/manifest.json`,{...manifest,caseSetHash:hash(cases),derivedFrom:v.source,
  scoringCorrection:{reason:v.reason,at:new Date().toISOString(),originalResponsesHash:hash(original),originalCaseSetHash:manifest.caseSetHash,recheckHash:hash(readFileSync('eval/recheck.mjs','utf8')),identicalModelInputs:true},
  note:'Same acquired observations with corrected evaluator metadata. Do not count as independent samples.'});
console.log(`Rechecked ${responses.length} existing observations; no inference executed.`);
