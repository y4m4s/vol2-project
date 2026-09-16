// Explicitly invoked interchangeable judge adapter. Credentials never enter artifacts.
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readJson,save,hash,AXES } from './lib.mjs';
import { validateJudgments } from './statistics.mjs';
const {values:v}=parseArgs({options:{packet:{type:'string'},out:{type:'string'},adapter:{type:'string'},model:{type:'string'},endpoint:{type:'string'}}});
if(!v.packet || !v.out) throw Error('Provide --packet blind.json --out judgments.json and --adapter MODULE or --endpoint URL --model ID');
const packet=readJson(v.packet);
const schema={verdict:'A_clear|A_slight|tie|B_slight|B_clear',reason:'decisive evidence',A:{scores:Object.fromEntries(AXES.map(x=>[x,4])),reasons:Object.fromEntries(AXES.map(x=>[x,'axis evidence'])),failures:[]},B:'same object schema as A'};
let judge;
if(v.adapter) judge=(await import(pathToFileURL(v.adapter).href)).judge;
else {
  if(!v.endpoint || !v.model || /qwen3.*8b/i.test(v.model)) throw Error('Configure a non-candidate judge model');
  const url=new URL(v.endpoint);
  if(url.username || url.password || url.search || url.hash || (url.protocol!=='https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw Error('Judge requires HTTPS or loopback');
  judge=async task=>{
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(process.env.NAVICOM_JUDGE_API_KEY ? {Authorization:`Bearer ${process.env.NAVICOM_JUDGE_API_KEY}`} : {})},
      body:JSON.stringify({model:v.model,temperature:0,messages:[{role:'system',content:packet.rubric+'\nReturn ONLY JSON matching '+JSON.stringify(schema)},{role:'user',content:JSON.stringify(task)}]}),signal:AbortSignal.timeout(120000)});
    if(!r.ok) throw Error(`Judge HTTP ${r.status}`);
    return JSON.parse((await r.json()).choices[0].message.content);
  };
}
const result={judge:{id:v.model ?? v.adapter,candidateModel:false,independent:true,limitations:'Single external judge; order reversal not yet measured'},packetHash:hash(packet),judgments:[]};
for(const pair of packet.pairs) {
  const judgment=await judge({rubric:packet.rubric,schema,pair});
  result.judgments.push({...judgment,pairId:pair.pairId,pairHash:hash(pair)});
  validateJudgments(result,packet,false);
  save(v.out,result);
  console.log(`${result.judgments.length}/${packet.pairs.length} judged`);
}
validateJudgments(result,packet);
