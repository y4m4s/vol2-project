import { parseArgs } from 'node:util';
import { readFileSync,existsSync } from 'node:fs';
import { readJson,save,hash,randomSeed,newDirectory,shuffle } from './lib.mjs';
const {values:v} = parseArgs({options:{baseline:{type:'string'},candidate:{type:'string'},out:{type:'string'},'reverse-of':{type:'string'}}});
if(v['reverse-of']) {
  if(!v.out)throw Error('Specify --out for reversed packet');
  const original=readJson(`${v['reverse-of']}/blind.json`),originalKey=readJson(`${v['reverse-of']}/key.private.json`);
  const packet={...original,pairs:original.pairs.map(p=>({...p,A:p.B,B:p.A}))};
  const key={...originalKey,reversedFrom:v['reverse-of'],packetHash:hash(packet),pairs:originalKey.pairs.map(p=>({...p,candidateSide:p.candidateSide==='A'?'B':'A',pairHash:hash(packet.pairs.find(x=>x.pairId===p.pairId))}))};
  newDirectory(v.out);save(`${v.out}/blind.json`,packet);save(`${v.out}/key.private.json`,key);
  console.log(`Reversed ${packet.pairs.length} pairs exactly.`);process.exit(0);
}
if(!v.baseline || !v.candidate || !v.out) throw Error('Usage: node eval/compare.mjs --baseline RUN --candidate RUN --out NEW_DIRECTORY [--reverse]');
const runs = [v.baseline,v.candidate].map(dir=>({manifest:readJson(`${dir}/manifest.json`),cases:readJson(`${dir}/cases.json`),responses:readJson(`${dir}/responses.json`)}));
const rubrics=[v.baseline,v.candidate].map(dir=>readFileSync(existsSync(`${dir}/rubric.md`)?`${dir}/rubric.md`:'eval/rubric.md','utf8'));
if(rubrics[0]!==rubrics[1]||runs.some((r,i)=>r.manifest.rubricHash&&r.manifest.rubricHash!==hash(rubrics[i])))throw Error('Rubric mismatch');
if(runs.some(r=>!r.manifest.finishedAt) || runs[0].manifest.caseSetHash !== runs[1].manifest.caseSetHash || runs[0].manifest.split !== runs[1].manifest.split || runs[0].manifest.repeats !== runs[1].manifest.repeats) throw Error('Only complete runs with identical cases, split and repeat counts can be paired');
const seed=randomSeed(), pairs=[],key=[];
function anonymous(result) {
  return {outcome:result.delivered?.outcome ?? 'error',text:result.delivered?.text ?? '',focus:result.delivered?.focus ?? null,
    rawAnswer:result.attempts.at(-1)?.response.text ?? '',hardChecks:result.attempts.at(-1)?.checks ?? [{name:'request_completed',passed:false}],
    pipelineFailure:Boolean(result.failure),failureCategories:result.failureCategories};
}
for(const a of runs[0].responses) {
  const b = runs[1].responses.find(x=>x.caseId===a.caseId && x.repeat===a.repeat);
  if(!b || a.caseHash!==b.caseHash) throw Error('Unmatched observation');
  const item = runs[0].cases.find(x=>x.id===a.caseId);
  const pairId = hash(`${seed}:${a.caseId}:${a.repeat}`).slice(0,16);
  const swapped = parseInt(hash(pairId).slice(0,8),16)%2===1;
  const pair = {pairId,task:{input:item.input,expected:item.expected,category:item.category,...(item.oracleEvidence?{oracleEvidence:item.oracleEvidence}:{})},A:anonymous(swapped?b:a),B:anonymous(swapped?a:b)};
  pairs.push(pair);key.push({pairId,caseId:a.caseId,...(item.problemId?{problemId:item.problemId}:{}),repeat:a.repeat,candidateSide:swapped?'A':'B',pairHash:hash(pair)});
}
newDirectory(v.out);
const packet={schemaVersion:1,rubric:rubrics[0],pairs:shuffle(pairs,seed)};
save(`${v.out}/blind.json`,packet);
save(`${v.out}/key.private.json`,{baseline:v.baseline,candidate:v.candidate,split:runs[0].manifest.split,seed,packetHash:hash(packet),pairs:key});
save(`${v.out}/judgments.template.json`,{judge:{id:'REQUIRED: model or reviewer',candidateModel:false,independent:false,limitations:'Record prior context and calibration limitations'},packetHash:hash(packet),judgments:pairs.map(p=>({pairId:p.pairId,pairHash:hash(p),verdict:null,reason:null,A:null,B:null}))});
console.log(`Prepared ${pairs.length} anonymous pairs. Judge receives blind.json ONLY; keep key.private.json separate.`);
