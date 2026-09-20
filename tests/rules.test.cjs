// Static expression checks. These do NOT replace Firebase Emulator Suite tests.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const rules=require('../database.rules.json').rules;
function allowed(path,permission,auth){
  let node=rules.live;
  const check=n=>n?.[permission]!==undefined&&vm.runInNewContext(String(n[permission]),{auth});
  if(check(node))return true;
  for(const part of path.split('/')){node=node?.[part]||node?.[Object.keys(node||{}).find(k=>k.startsWith('$'))];if(!node)return false;if(check(node))return true;}
  return false;
}
test('anonymous guests cannot write orders, stock, calls, tables or counter directly',()=>{
  for(const path of ['orders/fake','menu2/0/items/0/stock','waiterCalls/fake','tables/2026-09-13_1','publicCounters/orderNum'])assert.equal(allowed(path,'.write',{uid:'g',token:{}}),false,path);
});
test('guests cannot enumerate tokens, tables, push endpoints or private receipts',()=>{
  for(const path of ['tables','quiz_tokens','config/quizSession','orders','guestOperations','staffOperations','maintenance','pushSubscriptions'])assert.equal(allowed(path,'.read',{uid:'g',token:{}}),false,path);
  assert.equal(allowed('menu2','.read',{uid:'g',token:{}}),true);
  assert.equal(allowed('menu2','.read',null),false);
});
test('existing shared staff account can still read orders and use server-mediated writes',()=>{
  const auth={uid:'staff',token:{email:'manager@1708.local'}};
  assert.equal(allowed('config/quizSession','.read',auth),true);assert.equal(allowed('orders','.read',auth),true);assert.equal(allowed('maintenance','.read',auth),true);assert.equal(allowed('maintenance','.write',auth),false);assert.equal(allowed('pushSubscriptions','.read',auth),false);assert.equal(allowed('pushSubscriptions','.write',auth),false);assert.equal(allowed('menu2','.write',auth),false);
});
