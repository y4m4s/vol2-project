// A derived view of existing observations, explicitly NOT a new independent sample.
import { copyFileSync } from 'node:fs';
import { readJson,save,hash,newDirectory } from './lib.mjs';
const [source,output,ids]=process.argv.slice(2);if(!ids)throw Error('Usage: node eval/subset.mjs SOURCE NEW_DIRECTORY ID,ID');
const wanted=ids.split(','),manifest=readJson(`${source}/manifest.json`),cases=readJson(`${source}/cases.json`).filter(c=>wanted.includes(c.id));
if(cases.length!==wanted.length || !manifest.finishedAt)throw Error('Unknown IDs or incomplete source');
newDirectory(output);save(`${output}/manifest.json`,{...manifest,derivedFrom:source,caseIds:cases.map(c=>c.id),caseSetHash:hash(cases),independentSample:false});
save(`${output}/cases.json`,cases);save(`${output}/responses.json`,readJson(`${source}/responses.json`).filter(r=>wanted.includes(r.caseId)));
for(const f of ['environment-before.json','environment-after.json'])copyFileSync(`${source}/${f}`,`${output}/${f}`);
