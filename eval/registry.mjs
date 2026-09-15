import { readdirSync,existsSync,writeFileSync } from 'node:fs';
import { readJson,save,mean } from './lib.mjs';
import { metrics } from './statistics.mjs';
const summaries=readdirSync('eval/results',{withFileTypes:true}).filter(x=>x.isDirectory()&&existsSync(`eval/results/${x.name}/summary.json`)).map(x=>readJson(`eval/results/${x.name}/summary.json`));
const records=[];
for(const dir of readdirSync('eval/results',{withFileTypes:true}).filter(x=>x.isDirectory())) {
  const root=`eval/results/${dir.name}`;if(!existsSync(`${root}/manifest.json`))continue;
  const m=readJson(`${root}/manifest.json`);if(m.dry || !m.config || !m.finishedAt)continue;
  const before=readJson(`${root}/environment-before.json`),after=readJson(`${root}/environment-after.json`),responses=readJson(`${root}/responses.json`),config=m.config;
  const model=before.models?.models?.find(x=>(x.key??x.name)===config.model);
  const matched=summaries.find(x=>x.candidateRun===root && x.split===m.split);
  const baselineScore=summaries.find(x=>x.baselineRun===root && x.split===m.split);
  const standalone=existsSync(`${root}/assessment.json`)?readJson(`${root}/assessment.json`):null;
  const axes=matched?Object.fromEntries(Object.entries(matched.semanticOnly?.axes??matched.axes).map(([k,v])=>[k,v.candidate])):baselineScore?Object.fromEntries(Object.entries(baselineScore.axes).map(([k,v])=>[k,v.baseline])):standalone?.scores??null;
  records.push({experimentId:m.experimentId,run:root,derivedFrom:m.derivedFrom??null,split:m.split,model:config.model,quantization:model?.quantization?.name??model?.details?.quantization_level??null,
    modelDigest:model?.digest??null,provider:config.provider,promptVersion:config.promptVersion,promptRevision:m.provenance?.promptRevision??null,
    sourceHashes:m.provenance?.files??null,languageReferenceControl:config.languageReference??'production',contextStrategy:config.contextStrategy,thinking:config.thinking,
    temperature:config.sampling.temperature??null,top_p:config.sampling.top_p??null,top_k:config.sampling.top_k??null,min_p:config.sampling.min_p??null,
    penalty:{repeat:config.sampling.repeat_penalty??null,presence:config.sampling.presence_penalty??null,frequency:config.sampling.frequency_penalty??null},
    unspecifiedParameters:'Inherited backend value; null is unknown/unset, never zero.',modelParameterDefaults:before.details?.parameters??null,
    contextLengthRequested:config.contextLength,contextLengthObserved:config.provider==='ollama'?after.loaded?.models?.find(x=>x.name===config.model)?.context_length??null:model?.loaded_instances?.[0]?.config?.context_length??null,
    maxOutputTokens:[...new Set(responses.map(x=>x.prepared.request.maxOutputTokens))],evaluationScore:axes?mean(Object.values(axes)):null,axes,pairwiseWinRate:matched?.pairwiseWinRate??null,
    comparison:matched?matched.baselineRun:null,...metrics(responses),semanticFailures:matched?Object.fromEntries([...new Set(matched.rows.flatMap(r=>r.candidate.failures))].map(f=>[f,matched.rows.filter(r=>r.candidate.failures.includes(f)).length])):null});
}
save('eval/results/experiments.json',records);
const headers=['experimentId','provider','model','quantization','promptVersion','contextStrategy','thinking','temperature','top_p','top_k','min_p','contextLengthRequested','contextLengthObserved','evaluationScore','pairwiseWinRate','hardPassRate','latencyMedianMs','latencyP95Ms','tokensPerSecondMedian'];
writeFileSync('eval/results/experiments.tsv',headers.join('\t')+'\n'+records.map(r=>headers.map(h=>r[h]??'unknown').join('\t')).join('\n')+'\n');
console.log(`Indexed ${records.length} runs; unknown values remain null.`);
