import{db,ref,runTransaction}from'./firebase.js';

export async function nextOrderNum(){
  const res=await runTransaction(ref(db,'publicCounters/orderNum'),n=>(n||0)+1);
  if(!res.committed)throw new Error('order counter transaction aborted');
  return res.snapshot.val();
}
