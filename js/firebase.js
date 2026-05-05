import{initializeApp}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import{getDatabase,ref,push,update,set,remove,onValue,serverTimestamp}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import{getAuth,signInAnonymously,onAuthStateChanged}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const fbApp=initializeApp({
  apiKey:'AIzaSyAdPAuuu7TRsJfI9jxyYkdscPvPObm-6h8',
  authDomain:'project-3061022303410047846.firebaseapp.com',
  databaseURL:'https://project-3061022303410047846-default-rtdb.firebaseio.com',
  projectId:'project-3061022303410047846',
  storageBucket:'project-3061022303410047846.firebasestorage.app',
  messagingSenderId:'21905205682',
  appId:'1:21905205682:web:c2d6935c9b9848a7291cab'
});

export const db=getDatabase(fbApp);
export const auth=getAuth(fbApp);
export{ref,push,update,set,remove,onValue,serverTimestamp,signInAnonymously,onAuthStateChanged};

export function setConnStatus(ok){
  const dot=document.querySelector('.dot');
  if(dot){dot.style.background=ok?'var(--green)':'var(--red)';dot.style.boxShadow=ok?'0 0 5px var(--green)':'0 0 5px var(--red)';}
}

export async function fbUpdate(path,data){
  try{await update(ref(db,path),data);}
  catch(e){console.error('fbUpdate',e);setConnStatus(false);}
}
