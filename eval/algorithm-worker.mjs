// Only reviewed repository fixtures. Not a sandbox for model/user-generated code.
import { readFileSync } from 'node:fs';
const task=JSON.parse(readFileSync(0,'utf8'));
const solve=new Function(task.source+'\nreturn solve;')();
const answers=task.inputs.map(args=>{
  const before=JSON.stringify(args);
  try {
    const value=solve(...args);
    return value===undefined ? {error:'UndefinedReturn'} : {value,mutated:before!==JSON.stringify(args)};
  } catch(error) { return {error:error.name}; }
});
process.stdout.write(JSON.stringify({version:process.version,answers}));
