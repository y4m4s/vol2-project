// Read metadata only. Does not load, rewrite or delete a model. Skips tensor data and token arrays.
import { openSync,readSync,closeSync,statSync } from 'node:fs';
import { save,hash } from './lib.mjs';
import { modelFileReference } from './model-metadata.mjs';
const [path,out]=process.argv.slice(2);if(!path || !out)throw Error('Usage: node eval/inspect-gguf.mjs MODEL.gguf OUTPUT.json');
const fd=openSync(path,'r');let offset=0;
const read=n=>{const b=Buffer.alloc(n);if(readSync(fd,b,0,n,offset)!==n)throw Error('Unexpected EOF');offset+=n;return b;};
const u32=()=>read(4).readUInt32LE(),u64=()=>{const x=Number(read(8).readBigUInt64LE());if(!Number.isSafeInteger(x))throw Error('Unsafe length');return x;};
function string(keep=true){const n=u64();if(n>10000000)throw Error('Excessive string');if(keep)return read(n).toString('utf8');offset+=n;}
const sizes={0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8};
function value(type,keep){
  if(type===8)return string(keep);
  if(type===9){const inner=u32(),n=u64();if(n>10000000)throw Error('Excessive array');if(!keep && sizes[inner]){offset+=n*sizes[inner];return;}const a=[];for(let i=0;i<n;i++){const v=value(inner,keep);if(keep)a.push(v);}return keep?a:undefined;}
  if(!sizes[type])throw Error(`Unknown GGUF type ${type}`);
  if(!keep){offset+=sizes[type];return;}
  const b=read(sizes[type]);
  return ({0:()=>b.readUInt8(),1:()=>b.readInt8(),2:()=>b.readUInt16LE(),3:()=>b.readInt16LE(),4:()=>b.readUInt32LE(),5:()=>b.readInt32LE(),6:()=>b.readFloatLE(),7:()=>Boolean(b[0]),10:()=>Number(b.readBigUInt64LE()),11:()=>Number(b.readBigInt64LE()),12:()=>b.readDoubleLE()})[type]();
}
try {
  if(read(4).toString()!=='GGUF')throw Error('Not GGUF');const version=u32();if(![2,3].includes(version))throw Error('Unsupported version');
  const tensors=u64(),count=u64(),metadata={};
  for(let i=0;i<count;i++){const key=string(),type=u32();const keep=/^(general\.(name|basename|file_type|quantization_version)|qwen(?:3|35)\.(context_length|rope.freq_base)|tokenizer\.chat_template)$/.test(key);const v=value(type,keep);if(keep)metadata[key]=v;}
  save(out,{file:modelFileReference(path),size:statSync(path).size,version,tensors,metadata,templateHash:metadata['tokenizer.chat_template']?hash(metadata['tokenizer.chat_template']):null});
}finally{closeSync(fd);}
