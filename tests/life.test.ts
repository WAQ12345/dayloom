import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { testContext, nodeDb } from './helpers/sqlite.ts';
import { MIGRATIONS, migrate, SCHEMA_VERSION } from '../src/data/migrations.ts';
import { createShopping, listShopping, updateShopping, setShoppingStatus, deleteShopping } from '../src/data/shoppingRepo.ts';
import { createLifeRecord, listLifeRecords, updateLifeRecord, deleteLifeRecord } from '../src/data/lifeRepo.ts';
import { validateLifeRecord, validateShopping, LIMITS } from '../src/domain/validation.ts';
import { startedDays } from '../src/domain/dates.ts';
import { saveDraft, getDraft } from '../src/data/draftRepo.ts';
import { deleteModule } from '../src/data/maintenance.ts';
import { createBackup, inspectBackup, restoreBackup } from '../src/services/backup.ts';
import { createItem, listItems } from '../src/data/itemRepo.ts';
import { addWater, listWater } from '../src/data/waterRepo.ts';
import { DateViewCoordinator, WaterReadCoordinator } from '../src/domain/asyncView.ts';
const value={name:'健身卡',startDate:'2026-10-01',amountCents:null,note:null};
const item={name:'书',category:'图书',purchaseDate:null,priceCents:0,location:null,brand:null,note:null};
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};

test('shopping CRUD, stable same-time ordering, completion and undo across midnight',async()=>{
 const ctx=await testContext();try{
  const a=await createShopping(ctx,{name:'牛奶',note:null}),b=await createShopping(ctx,{name:'面包',note:'早餐'});
  assert.deepEqual((await listShopping(ctx.db,'pending')).map(r=>r.id),[b.id,a.id]);
  await setShoppingStatus(ctx,a.id,'done');await setShoppingStatus(ctx,b.id,'done');assert.deepEqual((await listShopping(ctx.db,'done')).map(r=>r.id),[b.id,a.id]);
  ctx.setDate('2026-10-13');await updateShopping(ctx,a.id,{name:'豆奶',note:null});await setShoppingStatus(ctx,a.id,'pending');assert.equal((await listShopping(ctx.db,'pending'))[0].completedAt,null);
  await setShoppingStatus(ctx,a.id,'done');assert.equal((await listShopping(ctx.db,'done'))[0].id,a.id);
  await deleteShopping(ctx,b.id);assert.equal((await listShopping(ctx.db,'done')).length,1);
  await assert.rejects(createShopping(ctx,{name:' ',note:null}));await assert.rejects(setShoppingStatus(ctx,a.id,'bad' as never));
 }finally{ctx.close();}
});
test('life records isolate kinds, sort dates/time/seq, retain null/zero and allow historical edits',async()=>{
 const ctx=await testContext();try{
  const a=await createLifeRecord(ctx,'membership',value),b=await createLifeRecord(ctx,'membership',{...value,name:'零元',amountCents:0});
  const old=await createLifeRecord(ctx,'membership',{...value,startDate:'2020-02-29'}),fixed=await createLifeRecord(ctx,'fixed',{...value,name:'房租',amountCents:12345});
  assert.deepEqual((await listLifeRecords(ctx.db,'membership')).map(r=>r.id),[b.id,a.id,old.id]);assert.equal((await listLifeRecords(ctx.db,'membership'))[0].amountCents,0);assert.equal((await listLifeRecords(ctx.db,'membership'))[1].amountCents,null);
  await assert.rejects(updateLifeRecord(ctx,a.id,'fixed',value));await deleteLifeRecord(ctx,a.id,'fixed');assert.equal((await listLifeRecords(ctx.db,'membership')).length,3);
  ctx.setDate('2026-10-13');await updateLifeRecord(ctx,a.id,'membership',{...value,startDate:'2026-10-12',name:'改名'});assert.equal((await listLifeRecords(ctx.db,'membership'))[0].id,a.id);
  await deleteLifeRecord(ctx,fixed.id,'fixed');assert.equal((await listLifeRecords(ctx.db,'fixed')).length,0);
  for(const amountCents of [-1,0.1,Infinity,NaN,LIMITS.priceYuan*100+1])await assert.rejects(createLifeRecord(ctx,'fixed',{...value,amountCents}));
 }finally{ctx.close();}
});
test('life validation: leap date, day zero, exact cents, blank, future and text boundaries',()=>{
 assert.equal(startedDays('2024-02-28','2024-03-01'),2);assert.equal(startedDays('2024-02-29','2024-02-29'),0);assert.equal(startedDays('0099-12-31','0100-01-01'),1);
 const valid={name:' 测试 ',startDate:'2024-02-29',amount:'',note:' '};assert.equal(validateLifeRecord(valid,'2026-10-12').amountCents,null);assert.equal(validateLifeRecord({...valid,amount:'0'},'2026-10-12').amountCents,0);assert.equal(validateLifeRecord({...valid,amount:'12.34'},'2026-10-12').amountCents,1234);
 for(const startDate of ['2023-02-29','2026-10-13',''])assert.throws(()=>validateLifeRecord({...valid,startDate},'2026-10-12'));
 for(const amount of ['-1','NaN','1.001','1e3'])assert.throws(()=>validateLifeRecord({...valid,amount},'2026-10-12'));
 assert.throws(()=>validateShopping({name:'x'.repeat(101),note:''}));assert.throws(()=>validateShopping({name:'x',note:'x'.repeat(501)}));
});
test('schema 2 migrates additively, preserving legacy item and drafts; migration is idempotent',async()=>{
 const db=nodeDb();try{await MIGRATIONS[0].up(db);await MIGRATIONS[1].up(db);await db.exec('PRAGMA user_version=2');await db.run('INSERT INTO items VALUES(?,?,?,?,?,?,?,?,?,?,?)',['old','老物品','其他',null,0,null,null,null,null,1,1]);await db.run('INSERT INTO drafts VALUES(?,?,?,?)',['item:new',null,'{"name":"旧草稿"}',1]);assert.equal(await migrate(db),SCHEMA_VERSION);assert.equal((await listItems(db))[0].name,'老物品');assert.equal((await getDraft<{name:string}>(db,'item:new'))?.payload.name,'旧草稿');assert.deepEqual(await listShopping(db,'pending'),[]);assert.deepEqual(await listLifeRecords(db,'membership'),[]);assert.equal(await migrate(db),SCHEMA_VERSION);}finally{db.close();}
});
test('new drafts persist across days; each settings deletion removes only its own records and draft',async()=>{
 const ctx=await testContext();try{
  await createItem(ctx,item,null);await createShopping(ctx,{name:'买书',note:null});await createLifeRecord(ctx,'membership',value);await createLifeRecord(ctx,'fixed',value);
  for(const kind of ['shopping','membership','fixed'])await saveDraft(ctx,`${kind}:editor`,null,{id:null,input:kind==='shopping'?{name:'draft',note:''}:{name:'draft',startDate:'',amount:'',note:''}});
  ctx.setDate('2026-10-13');assert.equal((await getDraft<{input:{name:string}}>(ctx.db,'shopping:editor'))?.payload.input.name,'draft');
  await deleteModule(ctx,'items');assert.equal((await listShopping(ctx.db,'pending')).length,1);assert.equal((await listLifeRecords(ctx.db,'membership')).length,1);assert.ok(await getDraft(ctx.db,'fixed:editor'));
  await deleteModule(ctx,'membership');assert.equal((await listLifeRecords(ctx.db,'membership')).length,0);assert.equal(await getDraft(ctx.db,'membership:editor'),null);assert.equal((await listLifeRecords(ctx.db,'fixed')).length,1);
  await deleteModule(ctx,'shopping');assert.equal((await listShopping(ctx.db,'pending')).length,0);assert.equal(await getDraft(ctx.db,'shopping:editor'),null);assert.ok(await getDraft(ctx.db,'fixed:editor'));
  await deleteModule(ctx,'fixed');assert.equal((await listLifeRecords(ctx.db,'fixed')).length,0);assert.equal(await getDraft(ctx.db,'fixed:editor'),null);
 }finally{ctx.close();}
});
test('schema3 ZIP roundtrip keeps all new records, stable order, partial drafts and null/zero',async()=>{
 const source=await testContext(),target=await testContext();try{
  await createShopping(source,{name:'牛奶',note:null});await createShopping(source,{name:'面包',note:'早餐'});await createLifeRecord(source,'membership',value);await createLifeRecord(source,'fixed',{...value,amountCents:0});
  for(const kind of ['shopping','membership','fixed'])await saveDraft(source,`${kind}:editor`,null,{id:null,input:kind==='shopping'?{name:'草稿',note:''}:{name:'草稿',startDate:'2026-',amount:'1.',note:''}});
  const checked=inspectBackup(await createBackup(source));assert.equal(checked.payload.schema,SCHEMA_VERSION);assert.equal(checked.summary.shopping,2);assert.equal(checked.summary.memberships,1);assert.equal(checked.summary.fixed,1);assert.equal(checked.summary.drafts,3);
  await restoreBackup(target,checked);assert.deepEqual(await listShopping(target.db,'pending'),await listShopping(source.db,'pending'));assert.equal((await listLifeRecords(target.db,'fixed'))[0].amountCents,0);assert.equal((await listLifeRecords(target.db,'membership'))[0].amountCents,null);assert.deepEqual((await getDraft(target.db,'fixed:editor'))?.payload,(await getDraft(source.db,'fixed:editor'))?.payload);
 }finally{source.close();target.close();}
});
test('real schema1/2 ZIP shapes migrate to empty life tables; malformed schema3 cannot replace old data',async()=>{
 const ctx=await testContext();try{
  await createItem(ctx,item,null);const base=inspectBackup(await createBackup(ctx)).payload;
  const archive=(p:unknown)=>zipSync({'manifest.json':strToU8(JSON.stringify(p))});
  for(const schema of [1,2]){const legacy=structuredClone(base);legacy.schema=schema;delete legacy.tables.shopping_items;delete legacy.tables.life_records;for(const key of ['bazi_profiles','bazi_charts','ai_conversations','ai_messages','ideas','task_templates','collections'])delete legacy.tables[key];const checked=inspectBackup(archive(legacy));assert.deepEqual(checked.payload.tables.shopping_items,[]);await restoreBackup(ctx,checked);assert.equal((await listItems(ctx.db)).length,1);}
  await createShopping(ctx,{name:'保留',note:null});
  for(const mutate of [(p:typeof base)=>{delete p.tables.shopping_items;},(p:typeof base)=>{p.tables.life_records=[{id:'bad',kind:'membership',name:'x',start_date:'2099-01-01',amount_cents:0,note:null,seq:1,created_at:1,updated_at:1}];},(p:typeof base)=>{p.tables.shopping_items=[{id:'bad',name:'x',note:null,status:'done',seq:1,created_at:1,completed_at:null,updated_at:1}];},(p:typeof base)=>{p.tables.drafts=[{key:'fixed:editor',date:null,payload:JSON.stringify({id:null,input:{name:'x',amount:123,startDate:'',note:''}}),updated_at:1}];}]){const invalid=structuredClone(base);mutate(invalid);assert.throws(()=>inspectBackup(archive(invalid)),/无效/);assert.equal((await listShopping(ctx.db,'pending'))[0].name,'保留');}
 }finally{ctx.close();}
});
test('restore write failure rolls back life replacements and preserves existing drafts',async()=>{
 const source=await testContext(),target=await testContext();try{await createShopping(source,{name:'新',note:null});await createLifeRecord(source,'fixed',value);await createShopping(target,{name:'旧',note:null});await saveDraft(target,'shopping:editor',null,{id:null,input:{name:'输入',note:''}});const backup=inspectBackup(await createBackup(source)),transaction=target.db.transaction.bind(target.db);target.db.transaction=fn=>transaction(tx=>fn({...tx,run:async(sql,args)=>{if(sql.startsWith('INSERT INTO life_records'))throw new Error('disk full');return tx.run(sql,args);}}));await assert.rejects(restoreBackup(target,backup),/disk full/);assert.equal((await listShopping(target.db,'pending'))[0].name,'旧');assert.ok(await getDraft(target.db,'shopping:editor'));}finally{source.close();target.close();}
});

test('latest date wins out-of-order reads; same-date intent invalidates old request and can retry',async()=>{
 const view=new DateViewCoordinator('2026-10-12'),first=deferred<string>(),second=deferred<string>();let shown='initial';
 view.select('2026-10-11');const old=view.begin();const a=first.promise.then(data=>{if(view.accept(old))shown=data;});view.select('2026-10-10');const latest=view.begin();const b=second.promise.then(data=>{if(view.accept(latest))shown=data;});second.resolve('10th');await b;first.resolve('11th');await a;assert.equal(shown,'10th');assert.equal(view.displayed,'2026-10-10');
 view.select('2026-10-10');const retry=view.begin();assert.ok(view.accept(retry));assert.ok(!view.accept(latest));
});
test('failed date restores arrows, ignores stale errors, blocks repeated next and follows today at midnight',()=>{
 const view=new DateViewCoordinator('2026-10-12');view.step(-1);const old=view.begin();view.step(-1);const failure=view.begin();assert.equal(view.fail(old),false);assert.ok(view.fail(failure));assert.equal(view.target,'2026-10-12');assert.equal(view.step(1),'2026-10-12');assert.equal(view.step(1),'2026-10-12');assert.throws(()=>view.select('2026-10-13'));
 assert.ok(view.rollover('2026-10-13'));assert.equal(view.target,'2026-10-13');view.accept(view.begin());view.step(-1);view.accept(view.begin());assert.equal(view.rollover('2026-10-14'),false);assert.equal(view.target,'2026-10-12');
 const token=view.begin();view.step(-1);view.step(1);assert.equal(view.target,'2026-10-12');assert.equal(view.accept(token),false);assert.ok(view.accept(view.begin()));
});
test('water reader retries a captured stale SQLite result after mutation without rereading meals',async()=>{
 const ctx=await testContext();try{
  const water=new WaterReadCoordinator(),gate=deferred<void>();let reads=0;
  const pending=water.read('2026-10-12',async()=>{reads++;const rows=await listWater(ctx.db,'2026-10-12');if(reads===1)await gate.promise;return rows;});
  await Promise.resolve();water.changed('2026-10-12');await addWater(ctx,'2026-10-12',250,'12:00');water.changed('2026-10-12');gate.resolve();assert.equal((await pending)[0].amountMl,250);assert.equal(reads,2);
  const v=water.version('2026-10-11');water.changed('2026-10-12');assert.ok(water.current('2026-10-11',v));
 }finally{ctx.close();}
});
