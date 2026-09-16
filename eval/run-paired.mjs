import {parseArgs} from 'node:util';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {readJson,save,validateConfig,loadCases,provenance,hash,probe,createClient,generate,shuffle,randomSeed,newDirectory} from './lib.mjs';
import {algorithmProvenance} from './algorithms.mjs';

const {values:v}=parseArgs({options:{baseline:{type:'string'},candidate:{type:'string'},out:{type:'string'},ids:{type:'string'},repeat:{type:'string',default:'1'},split:{type:'string',default:'tuning'},'confirm-holdout':{type:'boolean'},resume:{type:'boolean'}}});
if(!v.baseline||!v.candidate||!v.out)throw Error('Use --baseline CONFIG --candidate CONFIG --out NEW_PREFIX [--ids ID,ID --repeat 2 --resume]');
if(v.split==='holdout'&&!v['confirm-holdout'])throw Error('Holdout requires explicit confirmation after selection');
const configs=[v.baseline,v.candidate].map(p=>validateConfig(readJson(p)));
if(configs[0].provider!==configs[1].provider||configs[0].model!==configs[1].model)throw Error('Pairing requires same provider and model');
const ids=v.ids?.split(','),all=loadCases(v.split,undefined,'algorithms-v2'),cases=all.filter(c=>!ids||ids.includes(c.id));
if(!cases.length||ids&&(new Set(ids).size!==ids.length||ids.length!==cases.length))throw Error('Unknown/duplicate case ids');
const repeats=Number(v.repeat);if(!Number.isInteger(repeats)||repeats<1||repeats>3)throw Error('Use 1..3 paired repeats');
const roots=['baseline','candidate'].map(side=>`${v.out}-${side}`);
const rubric=readFileSync('eval/rubric.md','utf8')+'\n\n'+readFileSync('eval/algorithm-rubric.md','utf8');
const source=provenance(),algorithm=algorithmProvenance(),seed=v.resume?readJson(`${roots[0]}/manifest.json`).orderSeed:randomSeed();
if(!v.resume&&roots.some(existsSync))throw Error('Both run directories must be new');
const manifests=[],results=[];
for(let i=0;i<2;i++){
  if(v.resume){
    const m=readJson(`${roots[i]}/manifest.json`);
    for(const [key,value] of Object.entries({config:configs[i],caseSetHash:hash(cases),rubricHash:hash(rubric),algorithmProvenance:algorithm,orderSeed:seed,repeats,split:v.split}))assert.deepEqual(m[key],value,`Resume mismatch: ${key}`);
    assert.equal(m.provenance.harnessHash,source.harnessHash);assert.deepEqual(m.provenance.files,source.files);
    manifests.push(m);results.push(readJson(`${roots[i]}/responses.json`));
  }else{
    newDirectory(roots[i]);
    const m={schemaVersion:1,experimentId:configs[i].id,config:configs[i],suite:'algorithms-v2',split:v.split,repeats,caseIds:cases.map(c=>c.id),caseSetHash:hash(cases),provenance:source,algorithmProvenance:algorithm,rubricHash:hash(rubric),startedAt:new Date().toISOString(),orderSeed:seed,dry:false,paired:{partner:roots[1-i],runnerHash:hash(readFileSync('eval/run-paired.mjs','utf8')),order:'Shuffled case-repeat pairs; alternating first arm. Serial inference.'}};
    manifests.push(m);results.push([]);save(`${roots[i]}/manifest.json`,m);save(`${roots[i]}/cases.json`,cases);save(`${roots[i]}/responses.json`,[]);writeFileSync(`${roots[i]}/rubric.md`,rubric);save(`${roots[i]}/environment-before.json`,await probe(configs[i]));
  }
}
const entries=shuffle(Array.from({length:repeats},(_,repeat)=>cases.map(item=>({item,repeat}))).flat(),seed);
const clients=configs.map(createClient);
for(let j=0;j<entries.length;j++){
  const {item,repeat}=entries[j];
  for(const arm of j%2?[1,0]:[0,1]){
    if(results[arm].some(r=>r.caseId===item.id&&r.repeat===repeat))continue;
    const r={...await generate(item,configs[arm],clients[arm]),repeat,pairedSequence:{pair:j,position:arm===(j%2)?0:1}};
    results[arm].push(r);save(`${roots[arm]}/responses.json`,results[arm]);
    console.log(`${configs[arm].id} ${item.id} #${repeat} hard=${r.hardPassed} latency=${Math.round(r.latencyMs)}ms thinkingChars=${r.calls.reduce((n,c)=>n+(c.reasoningChars??0),0)} ${r.failure??''}`);
  }
}
for(let i=0;i<2;i++)if(!manifests[i].finishedAt){
  save(`${roots[i]}/environment-after.json`,await probe(configs[i]));
  save(`${roots[i]}/manifest.json`,{...manifests[i],finishedAt:new Date().toISOString(),status:results[i].some(x=>x.failure)?'completed_with_errors':'completed'});
}
