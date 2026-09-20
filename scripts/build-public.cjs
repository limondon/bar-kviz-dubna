'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const TOP_FILES=['index.html','guest.html','guest.css','style.css','manifest.json','sw.js'];
const TOP_DIRS=['icons','js'];
const sha256=data=>createHash('sha256').update(data).digest('hex');
function walk(dir,prefix=''){
  const result=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const full=path.join(dir,entry.name),relative=path.posix.join(prefix,entry.name);
    if(entry.isSymbolicLink())throw new Error('Symlinks are not allowed in the public bundle: '+relative);
    if(entry.isDirectory())result.push(...walk(full,relative));
    else if(entry.isFile())result.push(relative);
  }
  return result;
}
function sourceFiles(root){
  const files=[...TOP_FILES];
  for(const dir of TOP_DIRS){const full=path.join(root,dir);if(!fs.statSync(full).isDirectory())throw new Error('Missing public directory: '+dir);files.push(...walk(full,dir));}
  for(const file of files)if(!fs.statSync(path.join(root,...file.split('/'))).isFile())throw new Error('Missing public file: '+file);
  return files.sort();
}
function manifestFor(root,files=sourceFiles(root)){
  return Object.fromEntries(files.map(file=>[file,sha256(fs.readFileSync(path.join(root,...file.split('/'))))]));
}
function verifyServiceWorker(root,files){
  const known=new Set(files),source=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const block=source.match(/const ASSETS\s*=\s*\[([\s\S]*?)\];/)?.[1];
  if(!block)throw new Error('Cannot read the service worker asset list');
  for(const match of block.matchAll(/['"]([^'"]+)['"]/g)){
    const asset=match[1].replace(/^\.\//,'');
    if(asset&&asset!=='./'&&!known.has(asset))throw new Error('Service worker references a file outside the release bundle: '+asset);
  }
}
function buildPublic(root,output,{clean=false}={}){
  root=path.resolve(root);output=path.resolve(output);
  if(output===root||root.startsWith(output+path.sep))throw new Error('Refusing unsafe public output directory');
  if(fs.existsSync(output)){
    if(!clean||output!==path.join(root,'dist'))throw new Error('Public output already exists: '+output);
    fs.rmSync(output,{recursive:true,force:true});
  }
  const files=sourceFiles(root);verifyServiceWorker(root,files);
  for(const file of files){const source=path.join(root,...file.split('/')),target=path.join(output,...file.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);}
  const sourceManifest=manifestFor(root,files),outputFiles=walk(output),outputManifest=manifestFor(output,outputFiles);
  if(JSON.stringify(sourceManifest)!==JSON.stringify(outputManifest))throw new Error('Public bundle verification failed');
  return {files:files.length,bytes:files.reduce((sum,file)=>sum+fs.statSync(path.join(output,...file.split('/'))).size,0),manifest:sourceManifest};
}
function verifyPublicBundle(root,output){
  const expected=manifestFor(path.resolve(root)),actualFiles=walk(path.resolve(output)),actual=manifestFor(path.resolve(output),actualFiles);
  if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error('dist does not exactly match the public source allowlist; run npm run build');
  return {files:Object.keys(actual).length,manifestSha256:sha256(JSON.stringify(actual))};
}
if(require.main===module){
  try{const root=path.resolve(__dirname,'..'),result=buildPublic(root,path.join(root,'dist'),{clean:true});console.log(JSON.stringify({output:'dist',files:result.files,bytes:result.bytes}));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={TOP_FILES,TOP_DIRS,sourceFiles,manifestFor,buildPublic,verifyPublicBundle};
