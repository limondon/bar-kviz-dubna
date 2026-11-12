// Regenerate the shared Java/JS wire sample only when intentionally changing the protocol.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const context={crypto:webcrypto,TextEncoder};
vm.runInNewContext(fs.readFileSync(path.join(root,'js/cash-bill.js'),'utf8').replace(/export /g,'')+'; build=buildCashBill;',context);
(async()=>{
 const bill=await context.build({date:'2026-11-12',table:'PS1',sid:'visit-123',orders:[{id:'order-1',table:'PS1',sid:'visit-123',date:'2026-11-12',items:[
  {id:'line-1',name:'Чай «Облепиха» + лимон',qty:2,price:350},
  {id:'line-2',menuItemId:'water',name:'Вода',qty:1,price:100.25},
  {id:'cups',name:'2 кружки',qty:1}
 ]}],priceFor:()=>null});
 const {rows,total,estimated,...wire}=bill;
 const output=path.join(root,'integrations/evotor/fixtures/bill.json');fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify({...wire,state:'queued',createdAt:1794430800000},null,2)+'\n');
})().catch(e=>{console.error(e);process.exitCode=1;});
