'use strict';
const {createHash}=require('node:crypto');
const {OrderError}=require('./guest-service');
const fail=(code,message)=>{throw new OrderError(code,message);};
const enabled=root=>root?.maintenance?.enabled===true;

function maintenanceTransition(current,input,auth,now){
  if(auth?.token?.email!=='manager@1708.local'&&auth?.token?.role!=='admin')fail('permission-denied','Режим обслуживания доступен менеджеру');
  if(!input||typeof input.enabled!=='boolean'||typeof input.expectedEnabled!=='boolean'||!/^[-\w]{1,80}$/.test(input.requestId||''))fail('invalid-argument','Некорректная команда режима обслуживания');
  if(typeof input.reason!=='string'||input.reason.length>200)fail('invalid-argument','Причина должна быть не длиннее 200 символов');
  const root=structuredClone(current||{});
  if(root.schemaVersion!==2)fail('failed-precondition','Режим обслуживания доступен после переноса базы');
  const op=createHash('sha256').update(auth.uid+':'+input.requestId).digest('hex'),prior=root.staffOperations?.[op];
  if(prior){
    if(prior.action!=='setMaintenanceMode')fail('invalid-argument','Номер операции уже использован');
    return {root,result:prior.result};
  }
  if(root.archivePending)fail('failed-precondition','Дождитесь завершения переноса в архив');
  if(enabled(root)!==input.expectedEnabled)fail('aborted','Режим обслуживания уже изменён. Обновите страницу.');
  let result;
  if(input.enabled){
    const reason=input.reason.trim()||'Обновление системы';
    root.maintenance={enabled:true,enabledAt:now,enabledBy:auth.uid,reason};
    result={enabled:true,maintenance:structuredClone(root.maintenance)};
  }else{
    delete root.maintenance;
    result={enabled:false};
  }
  (root.staffOperations??={})[op]={action:'setMaintenanceMode',result,at:now};
  return {root,result};
}

module.exports={maintenanceTransition,maintenanceEnabled:enabled};
