// Serialization of explicit human/Codex judgments, not an automatic semantic grader.
import assert from 'node:assert/strict';
import {readJson,save,hash} from './lib.mjs';
import {validateJudgments} from './statistics.mjs';
export function writePairReview(directory,expectedPacketHash,rows){
  const packet=readJson(`${directory}/blind.json`);
  assert.equal(hash(packet),expectedPacketHash,'Packet changed since manual review');
  assert.equal(rows.length,packet.pairs.length);assert.equal(new Set(rows.map(x=>x[0])).size,rows.length);
  const result={judge:{id:'Codex / GPT-6 (session model)',candidateModel:false,independent:false,
    limitations:'同一エージェントが設計と評価。provider・設定名・速度・A/Bキーを除いたpacketを読んで判定。実験計画を知っているため完全な独立性はなく、外部Judgeおよび順序反転の追試は未実施。'},
    packetHash:hash(packet),judgments:rows.map(([index,verdict,A,B,reason])=>{
      const pair=packet.pairs[index];assert.ok(pair);return {pairId:pair.pairId,pairHash:hash(pair),verdict,A,B,reason};
    })};
  validateJudgments(result,packet);save(`${directory}/judgments.json`,result);
}
