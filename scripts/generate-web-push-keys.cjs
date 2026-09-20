'use strict';
const fs=require('node:fs'),path=require('node:path');
const webpush=require('../functions/node_modules/web-push');
try{
  const root=path.resolve(__dirname,'..'),args=process.argv.slice(2),index=args.indexOf('--output');
  const output=path.resolve(root,index>=0?args[index+1]:'.release/web-push-keys.json');
  if(!output.startsWith(root+path.sep)||output===root||fs.existsSync(output))throw new Error('Укажите новый файл внутри проекта');
  const keys=webpush.generateVAPIDKeys();
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify({WEB_PUSH_PUBLIC_KEY:keys.publicKey,WEB_PUSH_PRIVATE_KEY:keys.privateKey},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({ok:true,output:path.relative(root,output).replaceAll('\\','/')}));
}catch(error){console.error(error.message);process.exitCode=1;}
