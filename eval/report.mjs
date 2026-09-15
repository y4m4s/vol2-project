import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { readJson,save,hash } from './lib.mjs';
import { validateJudgments,summarizeJudgments,metrics } from './statistics.mjs';
const {values:v}=parseArgs({options:{comparison:{type:'string'},judgments:{type:'string'}}});
if(!v.comparison || !v.judgments) throw Error('Usage: node eval/report.mjs --comparison DIR --judgments FILE');
const packet=readJson(`${v.comparison}/blind.json`),key=readJson(`${v.comparison}/key.private.json`),judgments=readJson(v.judgments);
if(key.packetHash!==hash(packet)) throw Error('Key mismatch');
validateJudgments(judgments,packet);
const baseline=metrics(readJson(`${key.baseline}/responses.json`)),candidate=metrics(readJson(`${key.candidate}/responses.json`));
const baselineResponses=readJson(`${key.baseline}/responses.json`),candidateResponses=readJson(`${key.candidate}/responses.json`);
const summary={judge:judgments.judge,split:key.split,baselineRun:key.baseline,candidateRun:key.candidate,baseline,candidate,...summarizeJudgments(judgments,key)};
const semanticPairs=packet.pairs.filter(p=>!p.A.pipelineFailure && !p.B.pipelineFailure);
summary.scoringScope='end_to_end_delivery';
summary.semanticOnly=semanticPairs.length ? summarizeJudgments({...judgments,judgments:judgments.judgments.filter(j=>semanticPairs.some(p=>p.pairId===j.pairId))},key) : null;
summary.infrastructureExcludedPairs=packet.pairs.length-semanticPairs.length;
summary.gates={noNewHardFailures:summary.rows.every(row=>{
  const base=baselineResponses.find(x=>x.caseId===row.caseId && x.repeat===row.repeat);
  const current=candidateResponses.find(x=>x.caseId===row.caseId && x.repeat===row.repeat);
  return !base.hardPassed || current.hardPassed;
}),criticalAxes: ['correctness','groundedness','instruction_following'].every(a=>summary.axes[a].delta>=-.25),qualityCI:summary.ci95.low>.5,latency:candidate.latencyMedianMs<=baseline.latencyMedianMs*1.25};
summary.decision='Review gates and qualitative regressions; no automatic champion promotion. Holdout required for adoption.';
save(`${v.comparison}/summary.json`,summary);
const lines=['# Pairwise evaluation',`\nBaseline: ${key.baseline}\n\nCandidate: ${key.candidate}\n\nSplit: ${key.split}; judge: ${judgments.judge.id}`,
  `\nWin rate (ties=0.5): ${summary.pairwiseWinRate.toFixed(3)}; case bootstrap 95% CI [${summary.ci95.low.toFixed(3)}, ${summary.ci95.high.toFixed(3)}]; ties ${summary.ties}/${summary.rows.length}.`,
  '\n| Axis | Baseline | Candidate | Delta |','|---|---:|---:|---:|',...Object.entries(summary.axes).map(([a,s])=>`| ${a} | ${s.baseline.toFixed(2)} | ${s.candidate.toFixed(2)} | ${s.delta.toFixed(2)} |`),
  `\nHard pass: ${baseline.hardPassRate} → ${candidate.hardPassRate}. Median latency: ${Math.round(baseline.latencyMedianMs)} → ${Math.round(candidate.latencyMedianMs)} ms. p95: ${Math.round(baseline.latencyP95Ms)} → ${Math.round(candidate.latencyP95Ms)} ms.`,
  `\nGates: ${JSON.stringify(summary.gates)}\n\n${summary.decision}`,
  `\nScores above are end-to-end delivery. Infrastructure-excluded semantic comparison: ${semanticPairs.length} pairs, win rate ${summary.semanticOnly?.pairwiseWinRate ?? 'unavailable'}. ${summary.infrastructureExcludedPairs} transport-failure pairs are excluded from that semantic analysis; see summary.json semanticOnly.axes.`,
  '\n## Cases',...summary.rows.map(r=>`\n- ${r.caseId} #${r.repeat}: candidate win=${r.win}. ${r.reason}`)];
writeFileSync(`${v.comparison}/report.md`,lines.join('\n')+'\n');
console.log(JSON.stringify({pairwiseWinRate:summary.pairwiseWinRate,ci95:summary.ci95,gates:summary.gates}));
