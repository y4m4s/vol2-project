import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { followupOracle } from './algorithm-followup-oracles.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const cache=new Map();
export const ALGORITHM_LANGUAGES=['python','javascript'];
export const ALGORITHM_RUBRIC_PATH='eval/algorithm-rubric.md';

export function algorithmProvenance() {
  return Object.fromEntries(['algorithms.mjs','algorithm-worker.py','algorithm-worker.mjs','algorithm-rubric.md','algorithm-followup-oracles.mjs','intervention-policy.mjs'].map(name=>[name,digest(readFileSync(`eval/${name}`))]));
}

export function problemText(problem,layout='plain') {
  if(layout==='plain') return [problem.task,problem.constraints,problem.examples].join('\n');
  if(layout==='sections') return `問題\n${problem.task}\n\n制約\n${problem.constraints}\n\n入出力例\n${problem.examples}`;
  throw Error('Unknown problem layout');
}

export function expandAlgorithms(rawCases) {
  return rawCases.flatMap(raw=>{
    if(!/^[a-z0-9-]+$/.test(raw.id)||!raw.problemId||!raw.problem?.task)throw Error('Invalid algorithm fixture');
    return ALGORITHM_LANGUAGES.map(language=>{
      const file=`eval/fixtures/algorithms/${raw.id}.${language==='python'?'py':'js'}`;
      const code=readFileSync(file,'utf8').replace(/\r\n/g,'\n');
      if(code.length>8000)throw Error('Algorithm fixture outside scope');
      const item={...raw,id:`alg-${raw.id}-${language==='python'?'py':'js'}`,language,code,fixturePath:file,fixtureHash:digest(code)};
      const oracleEvidence=verifyAlgorithm(item);
      const context={activeFilePath:language==='python'?'main.py':'main.js',activeFileLanguage:language,activeFileExcerpt:code,
        additionalContext:problemText(raw.problem),diagnosticsSummary:[],recentEditsSummary:[],relatedSymbols:[],referencedFiles:[]};
      return {...item,oracleEvidence,input:{kind:raw.kind??'manual',assistanceDepth:'low',userPrompt:raw.question,context,
        ...(raw.kind==='always'?{automaticObservation:{triggerReasons:['text_edit'],idleDurationMs:12000,
          cursor:{line:code.trimEnd().split('\n').length,column:1},cursorExcerpt:code.trimEnd()+'\n<<<NAVICOM_CURSOR>>>',selectionPresent:false,
          lastEdit:{lineStart:1,lineEnd:code.trimEnd().split('\n').length,cursorDistanceLines:0,changedLineCount:1,insertedCharCount:1,deletedCharCount:0},
          diagnostics:{added:[],resolvedCount:0,remainingCount:0}}}:{})}};
    });
  });
}

function arrays(values,max,min=0) {
  const result=[];
  function add(prefix){if(prefix.length>=min)result.push(prefix);if(prefix.length<max)for(const value of values)add([...prefix,value]);}
  add([]);return result;
}
function sortedArrays(values,max,min=0) {
  return [...new Map(arrays(values,max,min).map(a=>{const b=[...a].sort((x,y)=>x-y);return [JSON.stringify(b),b];})).values()];
}
function shortest(graph,start,target) {
  let best=Infinity;
  function visit(v,seen){if(v===target){best=Math.min(best,seen.length-1);return;}for(const next of graph[v])if(!seen.includes(next))visit(next,[...seen,next]);}
  visit(start,[start]);return Number.isFinite(best)?best:-1;
}
export function oracleDomain(name) {
  const followup=followupOracle(name);if(followup)return followup;
  switch(name) {
    case 'sum': return {inputs:arrays([-2,-1,0,1,2],4).map(a=>[a]),expected:([a])=>a.reduce((n,x)=>n+x,0),scope:'all arrays length0..4 over -2..2'};
    case 'lower-bound': return {inputs:sortedArrays([-1,0,1,2],4).flatMap(a=>[-2,-1,0,1,2,3].map(t=>[a,t])),expected:([a,t])=>{const i=a.findIndex(x=>x>=t);return i<0?a.length:i;},scope:'all sorted arrays length0..4 over -1..2; targets -2..3'};
    case 'frequency': return {inputs:arrays(['a','b','c'],5).map(a=>[a.join('')]),expected:([s])=>Object.fromEntries([...new Set(s)].map(c=>[c,[...s].filter(x=>x===c).length])),scope:'all strings length0..5 over a,b,c'};
    case 'pair': return {inputs:sortedArrays([-1,0,1,2,4,7],4,2).flatMap(a=>[-2,0,2,4,6,8].map(t=>[a,t])),expected:([a,t])=>a.some((x,i)=>a.slice(i+1).some(y=>x+y===t)),scope:'all sorted arrays length2..4 over -1,0,1,2,4,7; six target values'};
    case 'pair-count': return {inputs:arrays([-1,0,1],4).flatMap(a=>[-2,-1,0,1,2].map(t=>[a,t])),expected:([a,t])=>a.flatMap((x,i)=>a.slice(i+1).map(y=>x+y)).filter(s=>s===t).length,scope:'all arrays length0..4 over -1,0,1; targets -2..2; does not certify asymptotic performance'};
    case 'prefix': return {inputs:arrays([-1,0,2],4,1).flatMap(a=>a.flatMap((_,l)=>a.slice(l).map((_,j)=>[a,l,l+j]))),expected:([a,l,r])=>a.slice(l,r+1).reduce((n,x)=>n+x,0),scope:'all arrays length1..4 over -1,0,2 and all valid inclusive intervals'};
    case 'bfs': {
      const graphs=Array.from({length:64},(_,mask)=>{let bit=0;return Array.from({length:3},(_,i)=>Array.from({length:3},(_,j)=>j).filter(j=>j!==i).filter(()=>Boolean(mask&(1<<bit++))));});
      const inputs=graphs.flatMap(g=>[0,1,2].flatMap(s=>[0,1,2].map(t=>[g,s,t])));
      inputs.push([[[1,2],[4],[3],[4],[]],0,4]);
      return {inputs,expected:([g,s,t])=>shortest(g,s,t),scope:'all 64 directed loop-free graphs on3 nodes, all endpoints; one5-node counterexample'};
    }
    case 'stairs': {const count=n=>n===0?1:n<0?0:count(n-1)+count(n-2);return {inputs:Array.from({length:13},(_,n)=>[n]),expected:([n])=>count(n),scope:'all n0..12 using independent recursive enumeration'};}
    case 'sort': return {inputs:arrays([0,1,2,10,11],4).map(a=>[a]),expected:([a])=>{const result=[];for(const x of a){const i=result.findIndex(y=>y>x);result.splice(i<0?result.length:i,0,x);}return result;},scope:'all arrays length0..4 over0,1,2,10,11; also checks input immutability'};
    default: throw Error('Unknown oracle');
  }
}

export function verifyAlgorithm(item) {
  if(item.oracle===null)return {status:'unavailable',reason:'Required transform implementation/contract is intentionally absent; no execution attempted.'};
  const key=[item.fixtureHash,item.language,item.oracle].join(':');
  if(cache.has(key))return cache.get(key);
  const domain=oracleDomain(item.oracle);
  const inputs=structuredClone(domain.inputs);
  const command=item.language==='python'?(process.env.NAVICOM_EVAL_PYTHON??'python'):process.execPath;
  const args=item.language==='python'?['-I','-S','eval/algorithm-worker.py']:['--max-old-space-size=96','eval/algorithm-worker.mjs'];
  let response;
  try {response=JSON.parse(execFileSync(command,args,{input:JSON.stringify({source:item.code,inputs}),encoding:'utf8',timeout:5000,maxBuffer:1024*1024,windowsHide:true,stdio:['pipe','pipe','pipe']}));}
  catch(error){throw Error(`Algorithm fixture execution failed (${item.id}; ${error.code??'worker error'})`);}
  if(!Array.isArray(response.answers)||response.answers.length!==inputs.length)throw Error('Incomplete oracle execution');
  const failures=[];
  response.answers.forEach((actual,i)=>{
    const expected=domain.expected(inputs[i]);
    if(actual.error||!isDeepStrictEqual(actual.value,expected)||['sort','merge'].includes(item.oracle)&&actual.mutated)
      failures.push({input:inputs[i],expected,actual});
  });
  const correct=['correct','correct_slow'].includes(item.variant);
  if(correct&&failures.length||!correct&&!failures.length)throw Error(`Fixture variant disagrees with oracle: ${item.id}`);
  const result={status:'verified',runtime:response.version,fixtureHash:item.fixtureHash,scope:domain.scope,testCount:inputs.length,
    mismatches:failures.length,correctOnTestDomain:failures.length===0,counterexamples:failures.slice(0,3),
    transcriptHash:digest(JSON.stringify({inputs,answers:response.answers})),
    limitation:'Finite-domain execution evidence, not proof for full constraints. Never sent to candidate model.'};
  cache.set(key,result);return result;
}

export function algorithmHardChecks(item,text) {
  if(item.scalarAnswer===undefined)return [];
  const normalized=text.replace(/<[^>]*>/g,'').replace(/[`*]/g,'');
  const labels=[...normalized.matchAll(/結果\s*[:：]/g)];
  const matches=[...normalized.matchAll(/結果\s*[:：]\s*(-?\d+)(?![\dA-Za-z_+\/-]|[.,]\d)/g)];
  return [{name:'requested_scalar_answer',passed:labels.length===1&&matches.length===1&&Number(matches[0][1])===item.scalarAnswer,
    reason:`Requested one labelled scalar ${item.scalarAnswer}; observed ${matches.map(x=>x[1]).join(',')||'missing'}`}];
}
