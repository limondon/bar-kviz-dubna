'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {prepare,restore}=require('../scripts/prepare-storage-v2.cjs');
const {verifyStorage}=require('../scripts/verify-storage-v2.cjs');
const {verifyRollback}=require('../scripts/verify-rollback.cjs');
const {buildPublic,verifyPublicBundle}=require('../scripts/build-public.cjs');
const {preflight}=require('../scripts/release-preflight.cjs');
const {verifyReleasePreflight}=require('../scripts/verify-release-preflight.cjs');
const root=path.resolve(__dirname,'..'),now=Date.parse('2026-09-20T12:00:00Z');
function sourceFixture(){return {menu2:{beer:{cat:'Пиво',items:{corona:{name:'Corona',price:300,stock:4,productId:'beer-1'}}}},orders:{order1:{id:'order1',date:'2026-09-20',table:'1',sid:'s1',num:1,status:'done',total:300,items:{line1:{id:'line1',name:'Corona',productId:'beer-1',qty:1,price:300,status:'done',stockConsumed:true}}}},tables:{'2026-09-20_1':{date:'2026-09-20',tNum:'1',sid:'s1',status:'closed',closedAt:now,closedSessions:[{sid:'s1',closedAt:now}]}},publicCounters:{orderNum:1}};}
test('storage verifier proves exact order preservation and rollback for a prepared export',()=>{
  const source=sourceFixture(),prepared=prepare(source,now),result=verifyStorage({source,migrated:prepared.output,migrationReport:prepared.report});
  assert.equal(result.ok,true,JSON.stringify(result.issues));assert.deepEqual(result.summary,{sourceOrders:1,liveOrders:0,archivedOrders:1,integrityIssues:0,auditIssues:0});
});
test('storage verifier blocks hash changes, duplicated orders and altered archived totals',()=>{
  const source=sourceFixture(),prepared=prepare(source,now),id='order1',day=prepared.output.archive.days['2026-09-20'];
  prepared.output.live.orders={order1:structuredClone(day.orders[id])};day.orders[id].total=1;
  const result=verifyStorage({source,migrated:prepared.output,migrationReport:prepared.report});assert.equal(result.ok,false);
  for(const code of ['output_hash_mismatch','invalid_archived_total','duplicate_order_id','rollback_failed'])assert.ok(result.counts[code],code);
});
test('storage verifier reruns the source audit and rejects a hand-edited audit report',()=>{
  const source=sourceFixture(),prepared=prepare(source,now);prepared.report.audit.readOnly=false;
  const result=verifyStorage({source,migrated:prepared.output,migrationReport:prepared.report});assert.equal(result.ok,false);assert.equal(result.counts.audit_report_mismatch,1);assert.equal(result.summary.auditIssues,0);
});
test('public build contains only allowlisted site assets and detects added files',()=>{
  const output=path.join(root,'dist'),built=buildPublic(root,output,{clean:true});assert.ok(built.files>10);assert.equal(fs.existsSync(path.join(output,'RELEASE.md')),false);assert.equal(fs.existsSync(path.join(output,'scripts')),false);
  assert.equal(verifyPublicBundle(root,output).files,built.files);fs.writeFileSync(path.join(output,'unexpected.txt'),'no');assert.throws(()=>verifyPublicBundle(root,output),/does not exactly match/);fs.rmSync(path.join(output,'unexpected.txt'));
});
test('release preflight requires two matching production project entries and reviewed audit count',()=>{
  const source=sourceFixture(),prepared=prepare(source,now);buildPublic(root,path.join(root,'dist'),{clean:true});
  const input={root,project:'bar-kviz-dubna-prod',confirmProject:'bar-kviz-dubna-prod',source,migrated:prepared.output,migrationReport:prepared.report,acceptedAuditIssues:0};
  const result=preflight(input);assert.equal(result.ok,true);assert.equal(result.storage.integrityIssues,0);assert.match(result.deployCommand,/--project bar-kviz-dubna-prod/);
  assert.throws(()=>preflight({...input,confirmProject:'another-project'}),/confirmation/);assert.throws(()=>preflight({...input,project:'demo-bar-1708',confirmProject:'demo-bar-1708'}),/non-demo/);assert.throws(()=>preflight({...input,acceptedAuditIssues:1}),/audit issue count/);
});
test('rollback verifier independently proves exact restoration and blocks changed orders',()=>{
  const prepared=prepare(sourceFixture(),now),restored=restore(prepared.output);
  const valid=verifyRollback({source:prepared.output,rollback:restored.output,rollbackReport:restored.report});
  assert.equal(valid.ok,true,JSON.stringify(valid.issues));assert.deepEqual(valid.summary,{sourceOrders:1,restoredOrders:1,integrityIssues:0});
  restored.output.orders.order1.total=1;
  const changed=verifyRollback({source:prepared.output,rollback:restored.output,rollbackReport:restored.report});
  assert.equal(changed.ok,false);for(const code of ['output_hash_mismatch','changed_restored_order','rollback_not_exact'])assert.ok(changed.counts[code],code);
});
test('sealed release report is rechecked against current data, site and server files',()=>{
  const source=sourceFixture(),prepared=prepare(source,now);buildPublic(root,path.join(root,'dist'),{clean:true});
  const input={root,project:'bar-kviz-dubna-prod',confirmProject:'bar-kviz-dubna-prod',source,migrated:prepared.output,migrationReport:prepared.report,acceptedAuditIssues:0};
  const sealed=preflight(input),verified=verifyReleasePreflight({...input,sealed});assert.equal(verified.ok,true);assert.equal(verified.deployCommand,sealed.deployCommand);
  const tampered=structuredClone(sealed);tampered.publicBundle.sha256='0'.repeat(64);
  assert.throws(()=>verifyReleasePreflight({...input,sealed:tampered}),/changed after preflight/);
  assert.throws(()=>verifyReleasePreflight({...input,sealed,project:'bar-kviz-other-prod',confirmProject:'bar-kviz-other-prod'}),/changed after preflight/);
});
