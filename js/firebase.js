import{guestApi}from'./guest-api.js';
import{initializeApp}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import{getDatabase,get,ref as databaseRef,push,update,set,remove,onValue,serverTimestamp,runTransaction,connectDatabaseEmulator}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import{getAuth,signInAnonymously,signInWithEmailAndPassword,onAuthStateChanged,connectAuthEmulator}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const isLocal=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
const fbApp=initializeApp({
  apiKey:'AIzaSyAdPAuuu7TRsJfI9jxyYkdscPvPObm-6h8',
  authDomain:'project-3061022303410047846.firebaseapp.com',
  databaseURL:'https://project-3061022303410047846-default-rtdb.firebaseio.com',
  projectId:'project-3061022303410047846',
  storageBucket:'project-3061022303410047846.firebasestorage.app',
  messagingSenderId:'21905205682',
  appId:'1:21905205682:web:c2d6935c9b9848a7291cab',
  ...(isLocal?{projectId:'demo-bar-1708',apiKey:'demo-api-key',authDomain:'demo-bar-1708.firebaseapp.com',databaseURL:'https://demo-bar-1708-default-rtdb.firebaseio.com'}:{})
},location.pathname.endsWith('/guest.html')?'bar-guest':undefined);

export const db=getDatabase(fbApp);
// All application data lives below /live. Connection status remains SDK metadata.
const ref=(database,path='')=>databaseRef(database,path.startsWith('.info/')?path:'live'+(path?'/'+path:''));
export const auth=getAuth(fbApp);
if(isLocal){
  connectDatabaseEmulator(db,'127.0.0.1',9000);
  connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
}
export const callService=guestApi(fbApp);
export{get,ref,push,update,set,remove,onValue,serverTimestamp,runTransaction,signInAnonymously,signInWithEmailAndPassword,onAuthStateChanged};

export function setConnStatus(ok){
  const dot=document.querySelector('.dot');
  if(dot){dot.style.background=ok?'var(--green)':'var(--red)';dot.style.boxShadow=ok?'0 0 5px var(--green)':'0 0 5px var(--red)';}
}

export async function fbUpdate(path,data){
  try{await update(ref(db,path),data);}
  catch(e){console.error('fbUpdate',e);setConnStatus(false);throw e;}
}
