'use strict';
const assert=require('node:assert/strict');
const project='demo-bar-1708';
function guard(){
  assert.equal(process.env.GCLOUD_PROJECT,project,'Only the demo project is permitted');
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,'127.0.0.1:9000');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
}
async function database(path='',method='GET',body){
  guard();path=path.startsWith('/')?path.slice(1):'live'+(path?'/'+path:'');const url=new URL(`http://127.0.0.1:9000/${path}.json`);url.searchParams.set('ns',project+'-default-rtdb');
  const res=await fetch(url,{method,headers:{Authorization:'Bearer owner'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  assert.equal(res.status,200,`Emulator database ${method} failed`);return res.json();
}
async function callable(action,data,token){
  guard();const started=performance.now();
  try{
    const res=await fetch(`http://127.0.0.1:5001/${project}/us-central1/${action}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({data}),signal:AbortSignal.timeout(45000)});
    const body=await res.json();
    return{...body,...(!res.ok||!body.result?{error:body.error||{status:'HTTP_'+res.status+'_MISSING_RESULT'}}:{}),ms:Math.round(performance.now()-started)};
  }catch(e){return{error:{status:e.name},ms:Math.round(performance.now()-started)};}
}
async function signup(extra={}){
  guard();const res=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true,...extra}),signal:AbortSignal.timeout(15000)});
  const body=await res.json();assert.ok(body.idToken,'Emulator auth signup failed');return body.idToken;
}
module.exports={guard,database,callable,signup};
