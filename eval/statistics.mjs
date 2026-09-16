import { AXES,hash,mean,percentile } from './lib.mjs';
export function validateJudgments(result,packet,complete=true) {
  if(result.packetHash!==hash(packet) || !result.judge?.id || result.judge.candidateModel!==false || /qwen3.*8b/i.test(result.judge.id)) throw Error('Judge identity or packet mismatch');
  const seen=new Set();
  for(const j of result.judgments) {
    const pair=packet.pairs.find(x=>x.pairId===j.pairId);
    if(!pair || seen.has(j.pairId) || j.pairHash!==hash(pair)) throw Error('Missing, duplicate or changed pair');
    seen.add(j.pairId);
    if(!['A_clear','A_slight','tie','B_slight','B_clear'].includes(j.verdict) || !j.reason?.trim()) throw Error('Invalid verdict/reason');
    for(const side of ['A','B']) {
      if(!Array.isArray(j[side]?.failures)) throw Error('Missing failure categories');
      for(const axis of AXES) if(!Number.isInteger(j[side]?.scores?.[axis]) || j[side].scores[axis]<0 || j[side].scores[axis]>4 || !j[side].reasons?.[axis]?.trim()) throw Error(`Invalid ${side} ${axis}`);
    }
  }
  if(complete && seen.size!==packet.pairs.length) throw Error('Incomplete judgments');
}
export function bootstrapCases(rows,seed='bootstrap-v1',iterations=5000) {
  const groupKey=x=>x.problemId??x.caseId;
  const groups=[...new Set(rows.map(groupKey))].map(id=>mean(rows.filter(x=>groupKey(x)===id).map(x=>x.win)));
  if(!groups.length) return null;
  let state=parseInt(hash(seed).slice(0,8),16) || 1;
  const random=()=>{ state ^= state<<13;state ^= state>>>17;state ^= state<<5;return (state>>>0)/4294967296; };
  const draws=Array.from({length:iterations},()=>mean(Array.from({length:groups.length},()=>groups[Math.floor(random()*groups.length)])));
  return {low:percentile(draws,.025),high:percentile(draws,.975),unit:rows.some(x=>x.problemId)?'problem':'case',cases:groups.length,iterations};
}
export function metrics(responses) {
  const latencies=responses.map(x=>x.latencyMs), tokens=responses.flatMap(x=>x.attempts.map(a=>a.response.inputTokens).filter(Number.isFinite));
  const speeds=responses.flatMap(x=>x.calls.flatMap(c=>c.stats?.tokens_per_second != null ? [c.stats.tokens_per_second] : c.stats?.eval_duration>0 ? [c.stats.eval_count/(c.stats.eval_duration/1e9)] : []));
  const loads=responses.flatMap(x=>x.calls.filter(c=>Number.isFinite(c.stats?.load_duration)).map(c=>c.stats.load_duration/1e6));
  return {n:responses.length,hardPassRate:mean(responses.map(x=>+x.hardPassed)),latencyMedianMs:percentile(latencies,.5),latencyP95Ms:percentile(latencies,.95),inputTokensMean:mean(tokens),tokensPerSecondMedian:percentile(speeds,.5),loadMedianMs:percentile(loads,.5),loadMaxMs:percentile(loads,1),
    pipelineFailures:Object.fromEntries([...new Set(responses.flatMap(x=>x.failureCategories))].map(cat=>[cat,responses.filter(x=>x.failureCategories.includes(cat)).length]))};
}
export function summarizeJudgments(result,key) {
  const rows=result.judgments.map(j=>{
    const mapping=key.pairs.find(x=>x.pairId===j.pairId);
    if(!mapping) throw Error('Unknown pair');
    const candidate=j[mapping.candidateSide],baseline=j[mapping.candidateSide==='A'?'B':'A'];
    return {...mapping,win:j.verdict==='tie'?.5:j.verdict.startsWith(mapping.candidateSide)?1:0,verdict:j.verdict,reason:j.reason,candidate,baseline};
  });
  return {pairwiseWinRate:mean(rows.map(x=>x.win)),...(rows.some(x=>x.problemId)?{problemBalancedWinRate:mean([...new Set(rows.map(x=>x.problemId??x.caseId))].map(id=>mean(rows.filter(x=>(x.problemId??x.caseId)===id).map(x=>x.win))))}:{}),decisiveWinRate:mean(rows.filter(x=>x.win!==.5).map(x=>x.win)),ties:rows.filter(x=>x.win===.5).length,ci95:bootstrapCases(rows),
    axes:Object.fromEntries(AXES.map(axis=>[axis,{baseline:mean(rows.map(x=>x.baseline.scores[axis])),candidate:mean(rows.map(x=>x.candidate.scores[axis])),delta:mean(rows.map(x=>x.candidate.scores[axis]-x.baseline.scores[axis]))}])),rows};
}
