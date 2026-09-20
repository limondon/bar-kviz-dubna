'use strict';
const fs=require('node:fs'),path=require('node:path'),{isDeepStrictEqual}=require('node:util');
const {preflight}=require('./release-preflight.cjs');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const stable=value=>{const copy=structuredClone(value);delete copy.createdAt;return copy;};

function verifyReleasePreflight({root,sealed,project,confirmProject,source,migrated,migrationReport,acceptedAuditIssues}){
  if(!sealed||sealed.ok!==true||sealed.version!==1)throw new Error('Invalid release preflight report');
  if(typeof sealed.createdAt!=='string'||!Number.isFinite(Date.parse(sealed.createdAt)))throw new Error('Invalid preflight creation time');
  const current=preflight({root,project,confirmProject,source,migrated,migrationReport,acceptedAuditIssues});
  if(!isDeepStrictEqual(stable(sealed),stable(current)))throw new Error('Release inputs changed after preflight; create and review a new preflight report');
  return {ok:true,project:current.project,createdAt:sealed.createdAt,storage:current.storage,publicBundle:current.publicBundle,server:current.server,deployCommand:current.deployCommand};
}

if(require.main===module){
  try{
    const args=process.argv.slice(2),arg=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
    const preflightFile=arg('--preflight'),project=arg('--project'),confirmProject=arg('--confirm-project'),sourceFile=arg('--source'),migrationFile=arg('--migration'),reportFile=arg('--migration-report'),accepted=arg('--accept-audit-issues');
    if(!preflightFile||!project||!confirmProject||!sourceFile||!migrationFile||!reportFile||accepted==null||[preflightFile,project,confirmProject,sourceFile,migrationFile,reportFile,accepted].some(value=>value.startsWith('--')))throw new Error('Usage: npm run verify:release -- --preflight release-preflight.json --project PROJECT --confirm-project PROJECT --source export.json --migration migrated.json --migration-report migration-report.json --accept-audit-issues N');
    const result=verifyReleasePreflight({root:path.resolve(__dirname,'..'),sealed:read(preflightFile),project,confirmProject,source:read(sourceFile),migrated:read(migrationFile),migrationReport:read(reportFile),acceptedAuditIssues:Number(accepted)});
    console.log(JSON.stringify({ok:true,project:result.project,publicFiles:result.publicBundle.files,serverFiles:result.server.files,sourceSha256:result.storage.sourceSha256,outputSha256:result.storage.outputSha256,deployCommand:result.deployCommand}));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={verifyReleasePreflight};
