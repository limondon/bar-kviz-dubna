'use strict';
const assert=require('node:assert/strict');
async function get(path){const response=await fetch('http://127.0.0.1:5000'+path,{signal:AbortSignal.timeout(10000)});return {status:response.status,text:await response.text()};}
(async()=>{
  const index=await get('/');assert.equal(index.status,200);assert.match(index.text,/1708/);
  const guest=await get('/guest.html');assert.equal(guest.status,200);assert.match(guest.text,/waiterBtn/);
  const worker=await get('/sw.js');assert.equal(worker.status,200);assert.match(worker.text,/bar-v35/);
  for(const path of ['/RELEASE.md','/scripts/build-public.cjs','/functions/index.js','/tests/server.test.cjs'])assert.equal((await get(path)).status,404,path+' must not be public');
  console.log(JSON.stringify({hosting:'passed',public:['/','/guest.html','/sw.js'],privatePathsBlocked:4}));
})().catch(e=>{console.error(e);process.exitCode=1;});
