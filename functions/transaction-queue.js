'use strict';
// Avoid repeated rebases of overlapping root transactions in the same runtime.
// Other instances still use RTDB's atomic transaction conflict checks.
function createTransactionQueue(){
  let tail=Promise.resolve();
  return task=>{
    const next=tail.then(task);
    tail=next.catch(()=>{});
    return next;
  };
}
module.exports={createTransactionQueue};
