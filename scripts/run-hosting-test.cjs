'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),local=path.join(root,'.local-tools');let cli;
try{cli=require.resolve('firebase-tools/lib/bin/firebase.js');}catch{cli=path.join(local,'firebase-cli/node_modules/firebase-tools/lib/bin/firebase.js');}
if(!fs.existsSync(cli))throw new Error('Install Firebase CLI: npm install --prefix .local-tools/firebase-cli firebase-tools@15.30.1 --ignore-scripts');
const env={...process.env,CI:'true',GCLOUD_PROJECT:'demo-bar-1708',GOOGLE_CLOUD_PROJECT:'demo-bar-1708',FIREBASE_CLI_DISABLE_UPDATE_CHECK:'true',FIREBASE_EMULATORS_PATH:path.join(local,'emulators'),XDG_CONFIG_HOME:path.join(local,'config')};
delete env.GOOGLE_APPLICATION_CREDENTIALS;
const child=spawn(process.execPath,[cli,'emulators:exec','--project','demo-bar-1708','--only','hosting','--non-interactive','node scripts/check-hosting-emulator.cjs'],{cwd:root,env,stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
