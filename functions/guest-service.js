'use strict';
const {createHash}=require('node:crypto');
class OrderError extends Error {
  constructor(code,message){super(message);this.code=code;}
}
const fail=(code,message)=>{throw new OrderError(code,message);};
const dateAt=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const validKey=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(x);
function isCurrentCall(root,call,now){
  const meta=root.tables?.[call?.date+'_'+call?.table];
  return !!meta&&call.date===dateAt(now)&&meta.status!=='closed'&&(meta.sid||'default')===(call.sid||'default');
}
function cancelStaleCalls(root,now){
  for(const call of Object.values(root.waiterCalls||{}))if(call?.status==='pending'&&!isCurrentCall(root,call,now)){call.status='cancelled';call.cancelledAt=now;}
}
function session(root,input,now,{open=false,sid}={}){
  const table=String(input.table||'').trim().toUpperCase();
  if(!/^[A-ZА-ЯЁ0-9 -]{1,30}$/.test(table)||!validKey(input.token))fail('invalid-argument','Некорректная ссылка стола');
  const date=dateAt(now),key=date+'_'+table;
  let meta=root.tables?.[key];
  const qt=root.quiz_tokens?.[input.token];
  const quizValid=qt&&String(qt.table)===table&&Number(qt.createdAt)<=now&&now<Math.min(Number(qt.expiresAt)||0,Number(qt.createdAt)+18*60*60*1000);
  if(meta?.status==='closed')fail('failed-precondition','Стол закрыт. Попросите официанта открыть новую сессию.');
  // autoOpened tokens originate from a quiz and must remain revocable.
  const regularValid=meta&&!meta.autoOpened&&meta.token===input.token;
  if(!regularValid&&!quizValid)fail('permission-denied','QR недействителен. Попросите актуальный код у официанта.');
  if(!meta){
    if(!open)fail('failed-precondition','Откройте меню заново');
    meta={date,tNum:table,status:'open',openedAt:now,sid,autoOpened:true,token:input.token};
    (root.tables??={})[key]=meta;
  }
  if(input.sid&&input.sid!==(meta.sid||'default'))fail('failed-precondition','Сессия стола изменилась. Откройте меню заново.');
  return {table,date,sid:meta.sid||'default',key};
}
const summary=o=>({id:o.id,num:o.num,total:o.total,table:o.table,sid:o.sid,date:o.date});
function optionInfo(value){
  const m=String(value||'').match(/^(.+?)\s*(?:\+|=|:)\s*(\d+)\s*₽?$/);
  return m?{label:m[1].trim(),price:Number(m[2])}:{label:String(value||''),price:0};
}
function takeRate(root,key,now,limit){
  const rates=root.guestRateLimits??={};const prev=rates[key];
  const r=prev&&now-prev.start<60000?prev:{start:now,count:0};
  if(r.count>=limit)fail('resource-exhausted','Слишком много запросов. Подождите минуту.');
  rates[key]={start:r.start,count:r.count+1};
}
// Pure transition: callers commit this entire result in one RTDB transaction.
// Never mutate the snapshot supplied by Firebase: callbacks may be retried.
function transition(current,action,input,uid,now,nonce){
  if(!uid)fail('unauthenticated','Войдите в меню заново');
  if(!input||typeof input!=='object')fail('invalid-argument','Некорректный запрос');
  const root=structuredClone(current||{});
  if(action==='openGuestSession'){
    const s=session(root,input,now,{open:true,sid:nonce});return {root,result:s};
  }
  if(!validKey(input.requestId))fail('invalid-argument','Не указан номер операции');
  const op=createHash('sha256').update(uid+':'+input.requestId).digest('hex');
  const prior=root.guestOperations?.[op];
  if(prior){
    if(prior.action!==action)fail('invalid-argument','Номер операции уже использован');
    return {root,result:prior.result};
  }
  const s=session(root,input,now);
  takeRate(root,'u_'+createHash('sha256').update(uid).digest('hex'),now,20);
  takeRate(root,'t_'+s.key,now,120);
  let result;
  if(action==='guestCallWaiter'){
    cancelStaleCalls(root,now);
    const existing=Object.entries(root.waiterCalls||{}).find(([,c])=>c.date===s.date&&String(c.table)===s.table&&(c.sid||'default')===s.sid&&c.status==='pending');
    const id=existing?.[0]||'g_'+op;
    if(!existing)(root.waiterCalls??={})[id]={table:s.table,date:s.date,sid:s.sid,status:'pending',calledAt:now};
    result={id};
  }else if(action==='placeGuestOrder'){
    if(!Array.isArray(input.items)||input.items.length<1||input.items.length>50)fail('invalid-argument','Выберите от 1 до 50 позиций');
    if(typeof input.note!=='string'||input.note.length>1000)fail('invalid-argument','Примечание должно быть не длиннее 1000 символов');
    const items={};let total=0;
    input.items.forEach((line,i)=>{
      if(!line||!validKey(String(line.category))||!validKey(String(line.item)))fail('invalid-argument','Некорректная позиция');
      const cat=root.menu2?.[line.category],item=cat?.items?.[line.item];
      if(!cat||cat.hidden||!item||item.name!==line.name)fail('failed-precondition','Меню изменилось. Вернитесь в меню и выберите товар заново.');
      if((item.productId||null)!==(line.productId||null))fail('failed-precondition','Товар в меню изменился. Выберите его заново.');
      if(!Number.isInteger(line.qty)||line.qty<1||line.qty>99)fail('invalid-argument','Количество должно быть от 1 до 99');
      if(!Number.isFinite(item.price)||item.price<0)fail('failed-precondition','У товара не задана корректная цена');
      const addons=line.addons||[];
      if(!Array.isArray(addons)||new Set(addons).size!==addons.length||addons.some(a=>!['Чабрец','Лимон','Мята'].includes(a))||(addons.length&&!String(cat.cat).toLowerCase().includes('лист')))fail('invalid-argument','Некорректные добавки');
      if(line.option!=null&&!(item.options||[]).includes(line.option))fail('failed-precondition','Опция больше недоступна');
      const opt=optionInfo(line.option),price=item.price+addons.length*50+opt.price;
      if(item.stock!==undefined&&item.stock!==null&&item.stock!==''){
        const stock=Number(item.stock);
        if(!Number.isInteger(stock)||stock<line.qty)fail('failed-precondition','Недостаточно остатков: '+item.name);
        item.stock=stock-line.qty;
      }
      const name=item.name+(addons.length?' + '+addons.map(a=>a.toLowerCase()).join(', '):'')+(line.option?' — '+line.option:'');
      const id='i'+i;items[id]={id,name,qty:line.qty,price,status:'new',productName:item.name,categoryKey:String(line.category),itemKey:String(line.item),addons,option:line.option||null};total+=price*line.qty;
      if(item.productId)items[id].productId=item.productId;
    });
    const cups=input.cups||0;
    if(!Number.isInteger(cups)||cups<0||cups>50)fail('invalid-argument','Некорректное количество кружек');
    if(cups)items.cups={id:'cups',name:'Кружки',qty:cups,price:0,status:'new'};
    if(input.expectedTotal!==total)fail('failed-precondition','Цены изменились. Вернитесь в меню и проверьте итог.');
    const num=Number(root.publicCounters?.orderNum||0)+1;
    if(!Number.isSafeInteger(num))fail('failed-precondition','Не удалось получить номер заказа');
    (root.publicCounters??={}).orderNum=num;
    const id='g_'+op;const order={id,num,total,table:s.table,date:s.date,sid:s.sid,items,note:input.note,priority:'normal',status:'new',createdAt:now,source:'guest',version:1};
    (root.orders??={})[id]=order;result=summary(order);
  }else fail('invalid-argument','Неизвестная операция');
  (root.guestOperations??={})[op]={action,result,at:now};
  return {root,result};
}
module.exports={transition,session,dateAt,OrderError,isCurrentCall,cancelStaleCalls};
