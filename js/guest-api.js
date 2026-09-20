import{getFunctions,httpsCallable,connectFunctionsEmulator}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
export function guestApi(app){
  const functions=getFunctions(app,'us-central1');
  if(['localhost','127.0.0.1','[::1]'].includes(location.hostname))connectFunctionsEmulator(functions,'127.0.0.1',5001);
  return async(name,data)=>(await httpsCallable(functions,name,{timeout:30000})(data)).data;
}
