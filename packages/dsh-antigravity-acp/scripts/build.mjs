import './check.mjs';
import { cp,lstat,realpath,rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=await realpath(fileURLToPath(new URL('../',import.meta.url)));
const output=path.resolve(root,'lib');
if(path.dirname(output)!==root||path.basename(output)!=='lib')throw new Error('Refusing unexpected output path');
let exists=false;
try{const info=await lstat(output);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Build output must be an owned ordinary directory');exists=true;}
catch(error){if(error.code!=='ENOENT')throw error;}
// Both root and the literal output target were checked before removal.
if(exists)await rm(output,{recursive:true});
await cp(path.join(root,'src'),output,{recursive:true,dereference:false,errorOnExist:true,force:false});
console.log('Built lib/ from source. No profile changes or model calls.');
