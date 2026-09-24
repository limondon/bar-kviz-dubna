'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
function walk(dir){
  return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(entry=>{
    if(entry.isSymbolicLink())throw new Error('Symlinks are not allowed in the site: '+entry.name);
    const name=path.posix.join(dir,entry.name);
    return entry.isDirectory()?walk(name):[name];
  });
}
function build(){
  const files=['index.html','guest.html','guest.css','style.css','manifest.json','sw.js',...walk('js'),...walk('icons')].sort();
  for(const name of files.filter(name=>/\.(js|html)$/.test(name))){
    const source=fs.readFileSync(path.join(root,name),'utf8');
    if(/firebase-functions|httpsCallable|cloudfunctions\.net|callService\s*\(|['"]live\//.test(source))throw new Error('Server-only dependency in Spark release: '+name);
  }
  const worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const assets=worker.match(/const ASSETS\s*=\s*\[([\s\S]*?)\];/)?.[1];
  if(!assets)throw new Error('Cannot read service worker assets');
  for(const [,asset] of assets.matchAll(/['"]([^'"]+)['"]/g))if(asset!=='./'&&!files.includes(asset))throw new Error('Missing cached asset: '+asset);
  const config=JSON.parse(fs.readFileSync(path.join(root,'firebase.json'),'utf8'));
  if(Object.keys(config).join()!=='hosting'||config.hosting.public!=='dist-spark')throw new Error('Spark config must publish only Hosting from dist-spark');
  const output=path.resolve(root,'dist-spark');
  // Only this generated directory inside the workspace can be replaced.
  if(path.dirname(output)!==root||path.basename(output)!=='dist-spark')throw new Error('Unsafe output directory');
  if(fs.existsSync(output)){
    if(fs.lstatSync(output).isSymbolicLink())throw new Error('Output directory cannot be a symlink');
    fs.rmSync(output,{recursive:true,force:true});
  }
  const hashes={};
  for(const name of files){
    const content=fs.readFileSync(path.join(root,name)),dest=path.join(output,name);
    fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content);
    hashes[name]=createHash('sha256').update(content).digest('hex');
  }
  fs.mkdirSync(path.join(root,'.release'),{recursive:true});
  fs.writeFileSync(path.join(root,'.release','spark-build.json'),JSON.stringify({base:'39b85a6',target:'GitHub Pages + Vercel / static site only',files:hashes},null,2)+'\n');
  console.log(JSON.stringify({output:'dist-spark',files:files.length,serverFunctions:false,databaseMigration:false}));
}
if(require.main===module){try{build();}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={build};
