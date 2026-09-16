// Reuse already reviewed identical task+answer judgments. New answers MUST be manually scored.
import { readJson,save,hash } from './lib.mjs';
const [target,notesPath,...previous]=process.argv.slice(2),packet=readJson(`${target}/blind.json`),notes=readJson(notesPath),known=new Map();
const signature=(pair,side)=>hash({task:pair.task,answer:pair[side]});
for(const dir of previous) {
  const old=readJson(`${dir}/blind.json`),reviews=readJson(`${dir}/assessments.json`);
  for(const r of reviews) { const p=old.pairs.find(x=>x.pairId===r.pairId);for(const side of ['A','B'])known.set(signature(p,side),r[side]); }
}
save(`${target}/assessments.json`,packet.pairs.map(pair=>{
  const note=notes.find(x=>x.pairId===pair.pairId);if(!note)throw Error(`Missing verdict ${pair.pairId}`);
  const scores={};for(const side of ['A','B']) {
    const v=note[side] ?? known.get(signature(pair,side));if(!v)throw Error(`Missing assessment ${pair.pairId} ${side}`);
    scores[side]=v;
  }
  return {...note,...scores};
}));
