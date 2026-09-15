// Serialize a human/Codex-authored assessment; this never assigns scores from model text.
// Usage: node eval/manual-review.mjs COMPARISON_DIR ASSESSMENTS_JSON
import { readJson,save,hash,AXES } from './lib.mjs';
import { validateJudgments } from './statistics.mjs';
const [directory,assessmentPath]=process.argv.slice(2);
const packet=readJson(`${directory}/blind.json`),assessments=readJson(assessmentPath);
function score(value) {
  if(!value || value.scores.length!==9 || value.reasons.length!==9) throw Error('Provide nine explicit scores and nine reasons');
  return {scores:Object.fromEntries(AXES.map((axis,i)=>[axis,value.scores[i]])),reasons:Object.fromEntries(AXES.map((axis,i)=>[axis,value.reasons[i]])),failures:value.failures};
}
const result={judge:{id:'Codex / GPT-6 (session model)',candidateModel:false,independent:false,
  limitations:'同一エージェントが設計と評価を担当。匿名packetだけでA/B評価したが、Baseline回答を以前に閲覧しており完全なidentity blindingではない。外部独立Judge未実施。'},packetHash:hash(packet),
  judgments:assessments.map(j=>{
    const pair=packet.pairs.find(p=>p.pairId===j.pairId);
    if(!pair) throw Error('Unknown pair');
    return {pairId:j.pairId,pairHash:hash(pair),verdict:j.verdict,reason:j.reason,A:score(j.A),B:score(j.B)};
  })};
validateJudgments(result,packet);
save(`${directory}/judgments.json`,result);
