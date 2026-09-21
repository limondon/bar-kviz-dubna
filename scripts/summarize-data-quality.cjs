'use strict';

const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

function arg(name){const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];}
function inside(root,file){const resolved=path.resolve(root,file);if(resolved!==root&&!resolved.startsWith(root+path.sep))throw new Error(`${file} must be inside the project`);return resolved;}
function entries(value){return Array.isArray(value)?value.map((item,index)=>[String(index),item]):Object.entries(value||{});}
function itemFor(order,itemKey){
  const rows=entries(order?.items);
  return rows.find(([key,item])=>key===String(itemKey)||String(item?.id||'')===String(itemKey)||String(item?._fbKey||'')===String(itemKey))?.[1];
}
function increment(target,key,amount=1){target[key]=(target[key]||0)+amount;}
function sortedObject(value){return Object.fromEntries(Object.entries(value).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ru')));}

try{
  const root=path.resolve(__dirname,'..');
  const input=inside(root,arg('--input')||'.release/production-export-prelock-20260920-154015.json');
  const auditFile=inside(root,arg('--audit')||'.release/production--20260920-154015audit.json');
  const migrationReportFile=inside(root,arg('--migration-report')||'.release/production--20260920-154015migration-report.json');
  const output=inside(root,arg('--output')||'.release/data-quality-summary.json');
  const source=JSON.parse(fs.readFileSync(input,'utf8')),audit=JSON.parse(fs.readFileSync(auditFile,'utf8')),migrationReport=JSON.parse(fs.readFileSync(migrationReportFile,'utf8'));
  const orders=source.orders||{},tables=source.tables||{},issuesByOrder=new Map();
  for(const issue of audit.issues||[]){
    if(!issuesByOrder.has(issue.orderKey))issuesByOrder.set(issue.orderKey,[]);
    issuesByOrder.get(issue.orderKey).push(issue);
  }
  const statusCounts={},itemStatusCounts={},dateCounts={},issueScopes={all:{},nonDoneItems:{},openSession:{},closedSession:{},unmatchedSession:{}},missingNames={};
  let ordersWithNonDoneItems=0,allItemsDone=0,openSession=0,openSessionWithIssues=0,closedSession=0,unmatchedSession=0,ordersWithIssues=0;
  const dates=[];
  for(const [orderKey,order] of Object.entries(orders)){
    increment(statusCounts,String(order?.status||'missing'));
    if(typeof order?.date==='string')dates.push(order.date),increment(dateCounts,order.date);
    const orderItems=entries(order?.items).map(([,item])=>item);
    for(const item of orderItems)increment(itemStatusCounts,String(item?.status||'missing'));
    const hasNonDoneItems=orderItems.some(item=>item?.status!=='done');
    if(hasNonDoneItems)ordersWithNonDoneItems++;else allItemsDone++;
    const table=tables[`${order?.date}_${order?.table}`];
    const isOpenSession=Boolean(table&&table.status==='open'&&String(table.sid||'')===String(order?.sid||''));
    const isClosedSession=Boolean(table&&(table.status==='closed'&&String(table.sid||'')===String(order?.sid||'')||(Array.isArray(table.closedSessions)?table.closedSessions:[]).some(session=>String(session?.sid||'')===String(order?.sid||''))));
    const isUnmatchedSession=!isOpenSession&&!isClosedSession;
    if(isOpenSession)openSession++;
    if(isClosedSession)closedSession++;
    if(isUnmatchedSession)unmatchedSession++;
    const orderIssues=issuesByOrder.get(orderKey)||[];
    if(orderIssues.length)ordersWithIssues++;
    if(isOpenSession&&orderIssues.length)openSessionWithIssues++;
    for(const issue of orderIssues){
      increment(issueScopes.all,issue.code);
      if(hasNonDoneItems)increment(issueScopes.nonDoneItems,issue.code);
      if(isOpenSession)increment(issueScopes.openSession,issue.code);
      if(isClosedSession)increment(issueScopes.closedSession,issue.code);
      if(isUnmatchedSession)increment(issueScopes.unmatchedSession,issue.code);
      if(issue.code==='product_not_found'){
        const name=String(itemFor(order,issue.itemKey)?.name||'(название отсутствует)').trim().toLocaleLowerCase('ru');
        increment(missingNames,name);
      }
    }
  }
  const tableStatuses={};for(const table of Object.values(tables))increment(tableStatuses,String(table?.status||'missing'));
  const archiveEligible=Number(migrationReport.archivedOrders)||0;
  const summary={
    readOnly:true,
    source:{file:path.relative(root,input).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),fileModifiedAt:fs.statSync(input).mtime.toISOString()},
    totals:{orders:Object.keys(orders).length,tables:Object.keys(tables).length,allItemsDone,ordersWithNonDoneItems,openSession,closedSession,unmatchedSession,archiveEligible,remainLiveAfterInitialArchive:Object.keys(orders).length-archiveEligible,ordersWithIssues,openSessionWithIssues,issues:(audit.issues||[]).length},
    dateRange:{first:dates.sort()[0]||null,last:dates.sort().at(-1)||null,byDate:sortedObject(dateCounts)},
    orderStatuses:sortedObject(statusCounts),itemStatuses:sortedObject(itemStatusCounts),tableStatuses:sortedObject(tableStatuses),
    issues:{all:sortedObject(issueScopes.all),nonDoneItems:sortedObject(issueScopes.nonDoneItems),openSession:sortedObject(issueScopes.openSession),closedSession:sortedObject(issueScopes.closedSession),unmatchedSession:sortedObject(issueScopes.unmatchedSession)},
    productNotFoundNames:sortedObject(missingNames)
  };
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify({ok:true,output:path.relative(root,output).replaceAll('\\','/'),totals:summary.totals,issues:summary.issues}));
}catch(error){console.error(error.stack||error.message);process.exitCode=1;}
