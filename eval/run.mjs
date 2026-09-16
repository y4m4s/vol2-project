import { parseArgs } from 'node:util';
import { mkdirSync } from 'node:fs';
import { readJson,save,validateConfig,loadCases,provenance,hash,probe,createClient,generate,prepare,shuffle,randomSeed,newDirectory } from './lib.mjs';

const {values:v} = parseArgs({options:{config:{type:'string'},suite:{type:'string'},'cases-file':{type:'string'},split:{type:'string',default:'tuning'},repeat:{type:'string',default:'1'},out:{type:'string'},filter:{type:'string'},ids:{type:'string'},dry:{type:'boolean',default:false},'confirm-holdout':{type:'boolean',default:false}}});
if (!v.config || !v.out) throw Error('Usage: node eval/run.mjs --config PATH --out NEW_DIRECTORY [--split tuning|holdout --repeat 3 --dry]');
if(v.split === 'holdout' && !v['confirm-holdout']) throw Error('Frozen holdout requires --confirm-holdout after candidate selection');
const config = validateConfig(readJson(v.config)), repeats = Number(v.repeat);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw Error('repeat must be 1..10');
const requestedIds=v.ids?.split(',');
const cases = loadCases(v.split,v['cases-file'],v.suite).filter(x => (!v.filter || x.id.includes(v.filter)) && (!requestedIds || requestedIds.includes(x.id)));
if(requestedIds && (new Set(requestedIds).size!==requestedIds.length || cases.length!==requestedIds.length))throw Error('Unknown or duplicate --ids');
if(!cases.length) throw Error('No cases');
mkdirSync('eval/results',{recursive:true});
newDirectory(v.out);
const orderSeed = randomSeed();
const manifest = {schemaVersion:1,experimentId:config.id,config,suite:v.suite ?? 'original',split:v.split,repeats,caseIds:cases.map(x=>x.id),caseSetHash:hash(cases),provenance:provenance(),startedAt:new Date().toISOString(),orderSeed,dry:v.dry};
save(`${v.out}/manifest.json`,manifest);
save(`${v.out}/cases.json`,cases);
if(v.dry) { save(`${v.out}/prompts.json`,cases.map(item=>({caseId:item.id,...prepare(item,config)}))); process.exit(0); }
save(`${v.out}/environment-before.json`,await probe(config));
const client = createClient(config), results = [];
// Serial inference avoids GPU contention. Random case order per run; all failures persist immediately.
for (const entry of shuffle(Array.from({length:repeats},(_,repeat)=>cases.map(item=>({item,repeat}))).flat(),orderSeed)) {
  const result = {...await generate(entry.item,config,client),repeat:entry.repeat};
  results.push(result);
  save(`${v.out}/responses.json`,results);
  console.log(`${result.caseId} #${entry.repeat} hard=${result.hardPassed} input=${result.attempts[0]?.response.inputTokens ?? '?'} latency=${Math.round(result.latencyMs)}ms ${result.failure ?? ''}`);
}
save(`${v.out}/environment-after.json`,await probe(config));
save(`${v.out}/manifest.json`,{...manifest,finishedAt:new Date().toISOString(),status:results.some(x=>x.failure) ? 'completed_with_errors' : 'completed'});
