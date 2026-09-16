function arrays(values,max,min=0){const result=[];function visit(a){if(a.length>=min)result.push(a);if(a.length<max)for(const v of values)visit([...a,v]);}visit([]);return result;}
export function followupOracle(name){
  if(name==='max-subarray')return {inputs:arrays([-3,-1,0,2],5,1).map(a=>[a]),expected:([a])=>Math.max(...a.flatMap((_,i)=>a.slice(i).map((_,j)=>a.slice(i,i+j+1).reduce((s,x)=>s+x,0)))),scope:'all nonempty arrays length1..5 over -3,-1,0,2; brute contiguous segment enumeration'};
  if(name==='parentheses')return {inputs:arrays(['(',')'],7).map(a=>[a.join('')]),expected:([s])=>{let old;do{old=s;s=s.replaceAll('()','');}while(s!==old);return s==='';},scope:'all parenthesis strings length0..7; independent repeated pair removal'};
  if(name==='gcd')return {inputs:[...Array.from({length:16},(_,i)=>Array.from({length:16},(_,j)=>[i+1,j+1])).flat(),[48,18]],expected:([a,b])=>{for(let d=Math.min(a,b);d>=1;d--)if(a%d===0&&b%d===0)return d;},scope:'all positive integer pairs1..16 plus48,18; divisor enumeration'};
  if(name==='merge'){
    const sorted=[...new Map(arrays([-1,0,2],3).map(a=>{const b=[...a].sort((x,y)=>x-y);return [JSON.stringify(b),b];})).values()];
    return {inputs:sorted.flatMap(a=>sorted.map(b=>[a,b])),expected:([a,b])=>[...a,...b].sort((x,y)=>x-y),scope:'all pairs of sorted arrays length0..3 over -1,0,2; concatenation and numeric sorting; immutability checked'};
  }
  return null;
}
