const {test}=require('node:test'),assert=require('node:assert/strict');
const {auditLegacy}=require('../scripts/audit-legacy.cjs');
const fixture=()=>({menu2:[{items:[{name:'Corona',productId:'p1'}]}],orders:{o:{id:'o',date:'2026-09-17',table:'1',sid:'s1',total:0,items:{i:{id:'i',name:'Corona',productId:'p1',qty:1,price:0,status:'done'}}}}});
test('legacy audit accepts a saved zero price and never modifies input',()=>{
  const root=fixture(),before=structuredClone(root);assert.equal(auditLegacy(root).summary.issues,0);assert.deepEqual(root,before);
});
test('legacy text is flagged without inventing historical prices',()=>{
  const root=fixture();root.orders.o.items='2 Corona';const report=auditLegacy(root);
  assert.equal(report.counts.legacy_text_requires_review,1);assert.equal(report.counts.missing_price_snapshots,1);assert.equal(root.orders.o.items,'2 Corona');
});
test('product identity survives renaming and a missing ID does not fall back to a reused name',()=>{
  const root=fixture();root.menu2[0].items[0].name='Renamed';root.menu2[0].items.push({name:'Corona',productId:'p2'});
  assert.equal(auditLegacy(root).counts.product_not_found,undefined);root.orders.o.items.i.productId='removed';assert.equal(auditLegacy(root).counts.product_not_found,1);
});
test('ambiguous legacy names are reported rather than assigned to the first product',()=>{
  const root=fixture();delete root.orders.o.items.i.productId;root.menu2[0].items.push({name:'Corona — Special',productId:'p2'});
  assert.equal(auditLegacy(root).counts.ambiguous_product,1);assert.equal(auditLegacy(root).counts.missing_product_id,1);
});
test('damaged rows, invalid prices and inconsistent totals are reported independently',()=>{
  const root=fixture();root.orders.o.total=500;root.orders.o.items.i.price=300;assert.equal(auditLegacy(root).counts.total_mismatch,1);
  root.orders.o.items.broken=null;root.orders.o.items.i.price=-1;root.orders.o.items.i.qty=0;root.orders.o.date='2026-02-31';root.orders.bad=7;
  const counts=auditLegacy(root).counts;for(const code of ['invalid_item','invalid_price','invalid_quantity','invalid_date','invalid_order'])assert.equal(counts[code],1);assert.equal(counts.total_mismatch,undefined);
});
test('unfinished lines from superseded sessions and duplicate catalog IDs are reported',()=>{
  const root=fixture();root.tables={'2026-09-17_1':{sid:'next',status:'open'}};root.orders.o.items.i.status='new';root.menu2[0].items.push({name:'Other',productId:'p1'});
  const counts=auditLegacy(root).counts;assert.equal(counts.unfinished_order_outside_open_session,1);assert.equal(counts.duplicate_catalog_product_id,1);assert.equal(counts.ambiguous_product,1);
});
test('audit CLI writes a separate report and refuses overwriting its input or an existing report',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bar-data-audit-')),input=path.join(dir,'export.json'),output=path.join(dir,'report.json');
  const source=JSON.stringify(fixture());fs.writeFileSync(input,source);
  const run=(target)=>spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/audit-legacy.cjs'),'--input',input,'--output',target],{encoding:'utf8'});
  assert.equal(run(output).status,0);assert.equal(JSON.parse(fs.readFileSync(output)).readOnly,true);
  assert.equal(run(output).status,1);assert.equal(run(input).status,1);assert.equal(fs.readFileSync(input,'utf8'),source);
  fs.unlinkSync(output);fs.unlinkSync(input);fs.rmdirSync(dir);
});
