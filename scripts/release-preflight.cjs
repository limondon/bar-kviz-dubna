'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {verifyStorage}=require('./verify-storage-v2.cjs');
const {verifyPublicBundle}=require('./build-public.cjs');
const sha256=data=>createHash('sha256').update(data).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
function codeFingerprint(root){
  const files=['firebase.json','database.rules.json'];
  const walk=(dir,prefix)=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(entry.name==='node_modules'||entry.name.endsWith('.log'))continue;const full=path.join(dir,entry.name),relative=path.posix.join(prefix,entry.name);if(entry.isSymbolicLink())throw new Error('Symlink in server release: '+relative);if(entry.isDirectory())walk(full,relative);else if(entry.isFile())files.push(relative);}};
  walk(path.join(root,'functions'),'functions');files.sort();
  const manifest=Object.fromEntries(files.map(file=>[file,sha256(fs.readFileSync(path.join(root,...file.split('/'))))]));
  return {files:files.length,sha256:sha256(JSON.stringify(manifest))};
}
function preflight({root,project,confirmProject,source,migrated,migrationReport,acceptedAuditIssues}){
  root=path.resolve(root);
  if(typeof project!=='string'||!/^[a-z][a-z0-9-]{4,29}$/.test(project)||project.startsWith('demo-'))throw new Error('Provide the exact non-demo Firebase project ID');
  if(confirmProject!==project)throw new Error('Project confirmation does not match --project');
  if(!Number.isSafeInteger(acceptedAuditIssues)||acceptedAuditIssues<0)throw new Error('Provide --accept-audit-issues with the reviewed audit issue count');
  const config=read(path.join(root,'firebase.json')),functions=Array.isArray(config.functions)?config.functions[0]:config.functions;
  if(functions?.source!=='functions'||functions?.runtime!=='nodejs22'||functions?.codebase!=='bar-orders')throw new Error('firebase.json Functions target is incomplete');
  if(config.database?.rules!=='database.rules.json')throw new Error('firebase.json Database rules target is incomplete');
  if(config.hosting?.public!=='dist')throw new Error('firebase.json Hosting must publish only dist');
  const publicBundle=verifyPublicBundle(root,path.join(root,'dist'));
  const storage=verifyStorage({source,migrated,migrationReport});if(!storage.ok)throw new Error('Storage verification failed with '+storage.summary.integrityIssues+' integrity issue(s)');
  if(storage.summary.auditIssues!==acceptedAuditIssues)throw new Error('Reviewed audit issue count does not match migration report');
  const server=codeFingerprint(root);
  return {ok:true,version:1,createdAt:new Date().toISOString(),project,confirmedProject:confirmProject,storage:{sourceSha256:storage.sourceSha256,outputSha256:storage.outputSha256,...storage.summary,auditCounts:storage.auditCounts},publicBundle,server,deployCommand:`firebase deploy --project ${project} --only functions:bar-orders,database,hosting`};
}
if(require.main===module){
  try{
    const args=process.argv.slice(2),arg=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
    const project=arg('--project'),confirmProject=arg('--confirm-project'),sourceFile=arg('--source'),migrationFile=arg('--migration'),reportFile=arg('--migration-report'),output=arg('--output'),accepted=arg('--accept-audit-issues');
    if(!project||!confirmProject||!sourceFile||!migrationFile||!reportFile||!output||accepted==null||[project,confirmProject,sourceFile,migrationFile,reportFile,output,accepted].some(v=>v.startsWith('--')))throw new Error('Usage: npm run preflight:release -- --project PROJECT --confirm-project PROJECT --source export.json --migration migrated.json --migration-report migration-report.json --accept-audit-issues N --output release-preflight.json');
    if(fs.existsSync(output))throw new Error('Preflight output already exists: '+output);
    const result=preflight({root:path.resolve(__dirname,'..'),project,confirmProject,source:read(sourceFile),migrated:read(migrationFile),migrationReport:read(reportFile),acceptedAuditIssues:Number(accepted)});
    fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({ok:true,project,publicFiles:result.publicBundle.files,serverFiles:result.server.files,integrityIssues:result.storage.integrityIssues,auditIssues:result.storage.auditIssues}));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={preflight,codeFingerprint};
