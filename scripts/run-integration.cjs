'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),local=path.join(root,'.local-tools');
let cli;
try{cli=require.resolve('firebase-tools/lib/bin/firebase.js');}catch{cli=path.join(local,'firebase-cli/node_modules/firebase-tools/lib/bin/firebase.js');}
if(!fs.existsSync(cli))throw new Error('Install Firebase CLI: npm install --prefix .local-tools/firebase-cli firebase-tools@15.30.1 --ignore-scripts');
let node=process.execPath;
const runtime=path.join(local,'runtime');
const dirs=fs.existsSync(runtime)?fs.readdirSync(runtime):[];
const portableNode=dirs.find(d=>/^node-v22\..*-win-x64$/.test(d));
if(process.platform==='win32'&&portableNode)node=path.join(runtime,portableNode,'node.exe');
else if(Number(process.versions.node.split('.')[0])!==22)throw new Error('Integration checks require Node.js 22 (the deployed Functions runtime).');
const env={...process.env,CI:'true',GCLOUD_PROJECT:'demo-bar-1708',GOOGLE_CLOUD_PROJECT:'demo-bar-1708',FIREBASE_CLI_DISABLE_UPDATE_CHECK:'true',FIREBASE_EMULATORS_PATH:path.join(local,'emulators'),XDG_CONFIG_HOME:path.join(local,'config')};
// CLI 15 uses project.firebaseio.com for demo Functions by default, whereas the
// browser and rules use project-default-rtdb. Keep all three on the same database.
env.DATABASE_URL='https://demo-bar-1708-default-rtdb.firebaseio.com';
delete env.GOOGLE_APPLICATION_CREDENTIALS;
const portableJava=dirs.find(d=>/^jdk-21[.]/.test(d));
if(process.platform==='win32'&&portableJava)env.JAVA_HOME=path.join(runtime,portableJava);
env.PATH=[path.dirname(node),...(env.JAVA_HOME?[path.join(env.JAVA_HOME,'bin')]:[]),process.env.PATH].join(path.delimiter);
const startOnly=process.argv.includes('--start');
const rehearsalIndex=process.argv.indexOf('--rehearse');
if(rehearsalIndex>=0){
  const supplied=process.argv[rehearsalIndex+1];if(!supplied)throw new Error('Usage: npm run test:rehearsal -- prepared-v2.json');
  const resolved=path.resolve(root,supplied),boundary=root+path.sep;if(resolved!==root&&!resolved.startsWith(boundary))throw new Error('Rehearsal input must be inside the project workspace');
  env.REHEARSAL_INPUT=resolved;
}
const command=rehearsalIndex>=0?'node scripts/rehearse-migration.cjs':process.argv.includes('--load')?`node scripts/load-emulators.cjs${process.argv.includes('--live-history')?' --live-history':''}`:'node --test tests/integration.test.cjs';
const child=spawn(node,[cli,startOnly?'emulators:start':'emulators:exec','--project','demo-bar-1708','--only','auth,database,functions','--non-interactive',...(startOnly?[]:[command])],{cwd:root,env,stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
