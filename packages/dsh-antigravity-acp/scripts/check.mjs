import { readdir,readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
if(manifest.name!=='dsh-antigravity-acp') throw new Error('Unexpected package root');
if(manifest.main!=='./lib/host/index.js'||manifest.exports['.']!==manifest.main) throw new Error('Host exports must target generated lib');
if(!manifest.private||!/^0\.1\.\d+(?:-dev\.\d+)?$/.test(manifest.version)) throw new Error('Keep this release in the private 0.1 development-preview series');
if(manifest.dependencies['@modelcontextprotocol/sdk']!=='1.26.0'||manifest.dependencies.ajv!=='8.17.1') throw new Error('Review pinned protocol dependencies before changing them');
for(const [name,version] of Object.entries({'@deepseek-ai/cordis':'4.1.0','@deepseek-ai/dsh-error':'0.2.2-rc.3','@deepseek-ai/dsh-llm':'0.2.2-rc.3','@deepseek-ai/schemastery':'3.19.0'})) {
  if(manifest.devDependencies?.[name]!==version) throw new Error(`Review pinned Runtime test dependency before changing ${name}`);
}

async function sources(directory){
  const files=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const target=path.join(directory,entry.name);
    if(entry.isDirectory())files.push(...await sources(target));
    else if(entry.isFile()&&entry.name.endsWith('.js'))files.push(target);
    else throw new Error('Source tree must contain regular JavaScript files only');
  }
  return files;
}
const files=await sources(path.join(root,'src'));
for(const file of files){
  const checked=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(checked.status!==0)throw new Error(`Syntax check failed: ${path.relative(root,file)}\n${checked.stderr}`);
  const text=await readFile(file,'utf8');
  if(/(?:node:child_process|\bglobalThis\.fetch\s*=|v1internal|oauth2\.googleapis)/.test(text)) throw new Error(`Forbidden runtime bypass: ${path.relative(root,file)}`);
}
for(const locale of ['zh','en']){
  const data=JSON.parse(await readFile(path.join(root,'locale',`${locale}.json`),'utf8'));
  if(!data)throw new Error('Missing locale');
}
const svg=await readFile(path.join(root,'icon.svg'),'utf8');
if(!svg.includes('viewBox="0 0 36 36"'))throw new Error('Missing icon viewBox');
await readFile(path.join(root,'docs/STATUS.md'),'utf8');
console.log(`Static package check passed: ${files.length} source modules. No CLI or model calls.`);
