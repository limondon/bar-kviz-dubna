const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
async function setup(page,{orders={},waiterCalls={},menu2}={}){
  const date=new Date().toLocaleDateString('en-CA');
  let data={orders,menu2:[{cat:'Напитки',items:[{name:'Вода',price:100,stock:10}]},{cat:'Чай листовой',items:[{name:'Сенча',price:300,stock:10}]}],tables:{[date+'_1']:{status:'open',date,tNum:'1',token:'test-token',sid:'session',openedAt:Date.now()}},publicCounters:{orderNum:0},config:{},waiterCalls};
  const errors=[],external=[];
  if(menu2!==undefined)data.menu2=menu2;
  page.on('pageerror',error=>errors.push(error.message));
  await page.exposeFunction('__syncDb',next=>{data=next;});
  await page.addInitScript(()=>{
    localStorage.setItem('bar_role','admin');
    window.__beeps=0;
    const param={setValueAtTime(){},linearRampToValueAtTime(){}};
    window.AudioContext=class{
      state='running';currentTime=0;destination={};
      createBuffer(){return {};}
      createBufferSource(){return {connect(){},start(){}};}
      createOscillator(){return {frequency:param,connect(){},start(){window.__beeps++;},stop(){}};}
      createGain(){return {gain:param,connect(){}};}
      async resume(){} async close(){}
    };
    // Sound must work even when system notifications are denied.
    window.Notification=class{static permission='denied';static async requestPermission(){return 'denied';}};
  });
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='www.gstatic.com'&&/firebase-(app|auth|database)\.js$/.test(url.pathname))return route.fulfill({contentType:'text/javascript',body:'export * from "https://bar.test/__sdk.js";'});
    if(url.origin!=='https://bar.test'){
      if(!['fonts.googleapis.com','fonts.gstatic.com','cdnjs.cloudflare.com'].includes(url.hostname))external.push(url.href);
      return route.abort();
    }
    if(url.pathname==='/__sdk.js')return route.fulfill({contentType:'text/javascript',body:`
      let data=${JSON.stringify(data)},counter=0;const listeners=new Map();
      const clone=v=>v==null?null:structuredClone(v);
      const read=p=>p==='.info/connected'?true:p.split('/').filter(Boolean).reduce((v,k)=>v?.[k],data);
      const snap=p=>({val:()=>clone(read(p)),exists:()=>read(p)!=null});
      const write=(p,value)=>{const parts=p.split('/').filter(Boolean);if(!parts.length){data=clone(value);return;}let node=data;for(const key of parts.slice(0,-1))node=node[key]??={};if(value==null)delete node[parts.at(-1)];else node[parts.at(-1)]=clone(value);};
      const emit=()=>{for(const [p,cbs]of listeners)for(const cb of cbs)if(!(p==='menu2'&&window.__pauseMenuListener))queueMicrotask(()=>cb(snap(p)));};
      export const initializeApp=()=>({}),getDatabase=()=>({}),ref=(db,p='')=>({path:p});
      const auth={currentUser:{email:'manager@1708.local',uid:'staff'}};
      export const getAuth=()=>auth,signInAnonymously=async()=>({user:{uid:'guest'}}),signInWithEmailAndPassword=async()=>({user:auth.currentUser});
      export function onAuthStateChanged(a,cb){queueMicrotask(()=>cb(a.currentUser));return ()=>{};}
      export const get=async r=>snap(r.path),push=r=>({key:'order_'+Date.now()+'_'+(++counter)}),serverTimestamp=()=>Date.now();
      export function onValue(r,cb){if(!listeners.has(r.path))listeners.set(r.path,new Set());listeners.get(r.path).add(cb);queueMicrotask(()=>cb(snap(r.path)));return ()=>listeners.get(r.path).delete(cb);}
      export async function update(r,values){
        if(window.__failCalls&&r.path==='waiterCalls'){window.__failCalls=false;throw new Error('PERMISSION_DENIED');}
        if(window.__failOrder&&/^orders\\/[^/]+$/.test(r.path)){window.__failOrder=false;throw new Error('Test rejected write');}
        for(const [key,value]of Object.entries(values))write([r.path,key].filter(Boolean).join('/'),value);
        await window.__syncDb(clone(data));emit();
      }
      export async function set(r,value){
        if(r.path==='menu2'){
          const validate=v=>{if(v===undefined)throw new Error('Firebase values cannot contain undefined');if(v&&typeof v==='object')Object.values(v).forEach(validate);};validate(value);
        }
        write(r.path,value);await window.__syncDb(clone(data));emit();
      }
      // database.rules.json grants staff writes at waiterCalls/$callId, not its parent.
      export async function remove(r){if(r.path==='waiterCalls')throw new Error('PERMISSION_DENIED');return set(r,null);}
      export async function runTransaction(r,fn){
        if(r.path==='menu2'&&window.__failMenu){window.__failMenu=false;throw new Error('Test menu write rejected');}
        let next=fn(clone(read(r.path)));
        if(r.path==='menu2'&&window.__menuRace){write('menu2',window.__menuRace);window.__menuRace=null;await window.__syncDb(clone(data));emit();next=fn(clone(read(r.path)));}
        if(next===undefined)return {committed:false,snapshot:snap(r.path)};await set(r,next);return {committed:true,snapshot:snap(r.path)};
      }
      window.__remoteSet=(p,v)=>set(ref(null,p),v);
    `});
    const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
    const type={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png'}[path.extname(file)]||'application/octet-stream';
    return route.fulfill({contentType:type,body:fs.readFileSync(file)});
  });
  return {data:()=>structuredClone(data),errors,external};
}
async function staff(page){await page.goto('https://bar.test/');await page.waitForFunction(()=>!!window.sw);await page.evaluate(()=>sw('new'));}
async function guest(page){await page.goto('https://bar.test/guest.html?table=1&token=test-token');await page.locator('[data-action=addItem]').first().waitFor();}
module.exports={setup,staff,guest};
