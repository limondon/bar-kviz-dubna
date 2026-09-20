const fs=require('node:fs'),path=require('node:path');
const {transition,dateAt}=require('../functions/guest-service');
const {staffTransition}=require('../functions/staff-service');
const {maintenanceTransition}=require('../functions/maintenance-service');
const {summarizeOrders}=require('../functions/stats-service');
const rootDir=path.resolve(__dirname,'..');
const sdk=`
export const initializeApp=()=>({}),getDatabase=()=>({}),getFunctions=()=>({});
export const connectDatabaseEmulator=()=>{},connectAuthEmulator=()=>{},connectFunctionsEmulator=()=>{};
export const getAuth=()=>({currentUser:{email:'manager@1708.local',getIdTokenResult:async()=>({claims:{role:'admin'}})}});
export const signInAnonymously=async()=>({}),signInWithEmailAndPassword=async()=>({});
export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(a.currentUser),0);return()=>{}};
export const ref=(d,p='')=>p,serverTimestamp=()=>Date.now();
const read=p=>p==='.info/connected'?true:p.split('/').filter((part,index)=>part&&(index!==0||part!=='live')).reduce((a,k)=>a?.[k],window.fixture);
const snap=p=>({val:()=>structuredClone(read(p)??null)});
export const get=async p=>snap(p);
export const onValue=(p,cb)=>{setTimeout(()=>cb(snap(p)),0);const h=()=>cb(snap(p));window.addEventListener('fixture-change',h);return()=>window.removeEventListener('fixture-change',h)};
export const push=p=>({key:crypto.randomUUID()});
export const update=async()=>{},set=async()=>{},remove=async()=>{};
export const runTransaction=async(p,fn)=>{const v=fn(read(p));return{committed:v!==undefined,snapshot:{val:()=>v}}};
export const httpsCallable=(f,name)=>async data=>{
 let res;try{res=await fetch('/__api',{method:'POST',body:JSON.stringify({name,data})});}catch{throw Object.assign(new Error('Сеть недоступна'),{code:'functions/unavailable'})}
 const body=await res.json();if(body.error)throw Object.assign(new Error(body.error.message),{code:'functions/'+body.error.code});
 window.fixture=body.root;window.dispatchEvent(new Event('fixture-change'));return{data:body.result};
};
`;
async function setup(page){
  const date=dateAt(Date.now());
  let root={schemaVersion:2,menu2:[{cat:'Пиво',items:[{name:'Corona',price:300,stock:5,options:['С лаймом','Добавка +50']}]},{cat:'Листовой чай',items:[{name:'Сенча',price:400,stock:2}]},{cat:'Скрыто',hidden:true,items:[{name:'Служебный',price:1}]}],tables:{[date+'_1']:{date,tNum:'1',status:'open',sid:'s1',token:'token'}},orders:{},config:{},publicCounters:{orderNum:0}};
  let loseResponse=false,failBefore=false;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(r=>{
    window.fixture=r;localStorage.setItem('bar_role','admin');
    // Browser scenarios test the app; the worker itself has isolated VM tests.
    // A blocked WebKit registration can otherwise keep the Windows test process alive.
    try{Object.defineProperty(navigator,'serviceWorker',{value:undefined,configurable:true});}catch{}
  },root);
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='www.gstatic.com'&&url.pathname.includes('/firebasejs/'))return route.fulfill({contentType:'application/javascript',body:sdk});
    if(url.hostname!=='bar.test')return route.abort();
    if(url.pathname==='/__api'){
      if(failBefore){failBefore=false;return route.abort();}
      const {name,data}=JSON.parse(route.request().postData());
      try{
        if(name==='getStaffArchive'){
          const rows=(root.archiveTestRows||[]).filter(row=>row.order.date===data.date&&(!data.after||row.key>data.after));
          return route.fulfill({json:{root,result:{rows:rows.slice(0,100),next:rows.length>100?rows[99].key:null,tables:root.archiveTestTables||{}}}});
        }
        if(name==='getStaffStats')return route.fulfill({json:{root,result:summarizeOrders(root.orders||{},[{orders:Object.fromEntries((root.archiveTestRows||[]).map(row=>[row.key,row.order]))}],Date.now())}});
        if(name==='setMaintenanceMode'){
          const next=maintenanceTransition(root,data,{uid:'staff',token:{role:'admin'}},Date.now());root=next.root;return route.fulfill({json:next});
        }
        const next=name.includes('Staff')?staffTransition(root,name,data,{uid:'staff',token:{role:'admin'}},Date.now(),'session-1'):transition(root,name,data,'guest',Date.now(),'session-1');root=next.root;
        if(loseResponse){loseResponse=false;return route.abort();}
        return route.fulfill({json:next});
      }catch(e){return route.fulfill({json:{error:{code:e.code,message:e.message}}});}
    }
    const file=path.join(rootDir,url.pathname==='/'?'index.html':url.pathname);
    if(!file.startsWith(rootDir)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
    const type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html';
    const body=type==='text/html'?'<script>window.fixture='+JSON.stringify(root).replaceAll('<','\\u003c')+';</script>'+fs.readFileSync(file,'utf8'):fs.readFileSync(file);
    return route.fulfill({contentType:type,body});
  });
  return {root:()=>root,errors,lose:()=>loseResponse=true,fail:()=>failBefore=true};
}
const guest=page=>page.goto('https://bar.test/guest.html?table=1&token=token');


module.exports={setup,guest};
