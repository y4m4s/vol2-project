import { writeFileSync } from 'node:fs';
import { readJson,save,hash,AXES,mean,percentile } from './lib.mjs';
const [directory,judgmentPath]=process.argv.slice(2);if(!judgmentPath)throw Error('Provide SWEEP_DIR JUDGMENTS_JSON');
const responses=readJson(`${directory}/responses.json`),judgments=readJson(judgmentPath);
const rows=responses.map(r=>{
  const j=judgments.rows.find(j=>j.contextLength===r.contextLength && j.caseId===r.caseId && j.repeat===r.repeat);
  if(!j || j.answerHash!==hash(r.response?.text??'') || AXES.some(a=>!Number.isInteger(j.scores[a]) || j.scores[a]<0 || j.scores[a]>4 || !j.reasons[a]))throw Error('Missing/changed context judgment');
  const stats=r.calls[0]?.stats;
  return {...r,assessment:j,loadMs:stats?.load_duration/1e6,decodeTokensPerSecond:stats?.eval_duration>0?stats.eval_count/(stats.eval_duration/1e9):null};
});
const groups=[4096,8192,16384].map(contextLength=>{
  const matches=rows.filter(x=>x.contextLength===contextLength),warm=matches.filter(x=>x.loadMs<1000);
  return {contextLength,n:matches.length,axes:Object.fromEntries(AXES.map(a=>[a,mean(matches.map(x=>x.assessment.scores[a]))])),
    hardPassRate:mean(matches.map(x=>+Boolean(x.hard?.checks.every(c=>c.passed)))),latencyMedianMs:percentile(matches.map(x=>x.latencyMs),.5),latencyP95Ms:percentile(matches.map(x=>x.latencyMs),.95),
    warmLatencyMedianMs:percentile(warm.map(x=>x.latencyMs),.5),loadMaxMs:percentile(matches.map(x=>x.loadMs),1),decodeTokensPerSecondMedian:percentile(matches.map(x=>x.decodeTokensPerSecond).filter(Number.isFinite),.5)};
});
const frontier=groups.filter(g=>!groups.some(other=>other!==g && other.warmLatencyMedianMs<=g.warmLatencyMedianMs && AXES.every(a=>other.axes[a]>=g.axes[a]) && (other.warmLatencyMedianMs<g.warmLatencyMedianMs || AXES.some(a=>other.axes[a]>g.axes[a])))).map(x=>x.contextLength);
save(`${directory}/summary.json`,{kind:'context-characterization',judge:judgments.judge,groups,frontier,rows,
  limitations:'3 diagnostic cases x 2 repeats only. Warm excludes backend load_duration >=1s; prompt caching remains uncontrolled. Frontier is observed, not statistically confirmed. No production adoption.'});
const lines=['# Context length characterization','\n同じ送信promptを4K/8K/16Kへ各2回。context設定以外のrequestは固定。形式修復なしの1回推論を測定。',
  '\n| Allocated | Hard pass | Correctness | Groundedness | Median ms | Warm median ms | p95 ms | Decode t/s | Max load ms |',
  '|---:|---:|---:|---:|---:|---:|---:|---:|---:|',...groups.map(g=>`| ${g.contextLength} | ${g.hardPassRate.toFixed(2)} | ${g.axes.correctness.toFixed(2)} | ${g.axes.groundedness.toFixed(2)} | ${Math.round(g.latencyMedianMs)} | ${Math.round(g.warmLatencyMedianMs)} | ${Math.round(g.latencyP95Ms)} | ${g.decodeTokensPerSecondMedian.toFixed(1)} | ${Math.round(g.loadMaxMs)} |`),
  `\nObserved multidimensional Pareto frontier: ${frontier.join(', ')} tokens. 9軸の平均とwarm median latencyで非劣位点を列挙する。3課題のみ・cache非統制なので一般化しない。`,
  '\n## Findings','\n- 短文632 tokensと、同じ答えに不要なメモを足した3,992 tokensでは、全contextで17秒に正答。不要文脈は品質改善なし、prefill/cacheによって待ち時間が増える。',
  '- applicationで最新仕様を失った長文は、4Kで処理済み2,050 tokens、8K/16Kで4,550 tokens。同一promptのhashで検証可能。拡大はJSON契約を回復したが、消えた最新17秒の情報を回復しない。',
  '- 8Kは欠落を認める回答2/2、16Kは1/2で旧値を最新と推測。小標本のため16K自体を幻覚の原因と断定しない。',
  '- このセットには4Kを超える全情報が必須の成功課題がない。実タスク全般での最適context値は未確定。まず送信前の情報保持を別評価し、必要情報量を測る。'];
writeFileSync(`${directory}/report.md`,lines.join('\n')+'\n');console.log(JSON.stringify({groups,frontier}));
