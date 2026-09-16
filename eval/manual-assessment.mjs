// Serialization only: the reviewer supplies every score, reason, failure and task decision.
import { readJson,save,hash,AXES,mean } from './lib.mjs';
const labels=['正確性','提示コード・制約との整合','必要文脈の利用','根拠のない事実の有無','質問とヒント制約の遵守','理解を助ける説明','適切な次の着目点','簡潔さと関連性','日本語の明瞭さ'];
export function manualScore(vector,evidence,failures=[],meetsTask=true){
  const values=[...vector].map(Number);
  if(values.length!==9||values.some(x=>!Number.isInteger(x)||x<0||x>4)||!evidence?.trim())throw Error('Nine manual scores and evidence required');
  return {scores:Object.fromEntries(AXES.map((a,i)=>[a,values[i]])),
    reasons:Object.fromEntries(AXES.map((a,i)=>[a,`${labels[i]} ${values[i]}/4。${evidence}`])),failures,meetsTask};
}
export function writeAssessment(dir,expectedResponsesHash,notes){
  const m=readJson(`${dir}/manifest.json`),responses=readJson(`${dir}/responses.json`);
  if(!m.finishedAt||hash(responses)!==expectedResponsesHash)throw Error('Answers changed since manual review');
  const entries=Object.entries(notes).flatMap(([caseId,rs])=>rs.map((score,repeat)=>({caseId,repeat,score})));
  if(entries.length!==responses.length)throw Error('Incomplete manual assessment');
  const observations=responses.map(r=>{
    const score=entries.find(x=>x.caseId===r.caseId&&x.repeat===r.repeat)?.score;
    if(!score||typeof score.meetsTask!=='boolean'||!Array.isArray(score.failures))throw Error('Missing manual observation');
    return {caseId:r.caseId,repeat:r.repeat,caseHash:r.caseHash,answerHash:hash(r.delivered),hardPassed:r.hardPassed,...score};
  });
  const result={judge:{id:'Codex / GPT-6 (session model)',candidateModel:false,independent:false,
    limitations:'同一エージェントが設計と評価。各回答をコード・制約・有限領域の実行根拠に照合。単独評価でproviderは既知。外部独立Judgeなし。holdout回答による追加最適化なし。'},
    caseSetHash:m.caseSetHash,responsesHash:hash(responses),rubricHash:m.rubricHash,
    scores:Object.fromEntries(AXES.map(a=>[a,mean(observations.map(x=>x.scores[a]))])),meetsTask:observations.filter(x=>x.meetsTask).length,observations};
  save(`${dir}/assessment.json`,result);return result;
}
