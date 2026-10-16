import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testContext,nodeDb} from './helpers/sqlite.ts';
import {migrate,schemaVersion,MIGRATIONS,SCHEMA_VERSION} from '../src/data/migrations.ts';
import {saveProfile,getSetting} from '../src/data/settingsRepo.ts';
import {createMeal,deleteMeal,getDayEnergy,getFoodSettlement,setExpenditure,saveFoodSettlement,loadEnergyData} from '../src/data/foodRepo.ts';
import {dailyEnergy,monthEnergy} from '../src/domain/energy.ts';
import {createTask,listTasks,updateTask,deleteTask,setTaskStatus,savePlanSettlement,getPlanSettlement} from '../src/data/taskRepo.ts';
import {addWater,listWater,undoLastWater} from '../src/data/waterRepo.ts';
import {createItem,listItems,renameCategory,deleteCategory} from '../src/data/itemRepo.ts';
import {saveDraft,getDraft} from '../src/data/draftRepo.ts';
import {deleteModule} from '../src/data/maintenance.ts';
const date='2026-10-12';
const profile={sex:'male' as const,age:30,heightCm:170,weightKg:65,metabolism:1599,mode:'manual' as const};
const meal={name:'午餐',kcal:1900,mealType:'lunch' as const,time:null,note:null};
const task={name:'阅读',order:1,priority:'normal' as const,project:'生活',note:null};

test('SQLite migration idempotence, future-version rejection, transaction rollback',async()=>{const ctx=await testContext();try{assert.equal(await migrate(ctx.db),SCHEMA_VERSION);assert.equal(await schemaVersion(ctx.db),SCHEMA_VERSION);await assert.rejects(ctx.db.transaction(async tx=>{await tx.run("INSERT INTO settings VALUES('x','1')");throw new Error('fault');}));assert.equal(await ctx.db.first("SELECT * FROM settings WHERE key='x'"),null);await ctx.db.exec('PRAGMA user_version=999');await assert.rejects(migrate(ctx.db));}finally{ctx.close();}});
test('energy updates immediately regardless of legacy settlement and preserves history snapshot',async()=>{const ctx=await testContext();try{await saveProfile(ctx,date,profile);await createMeal(ctx,date,meal,null);await setExpenditure(ctx,date,701);await saveFoodSettlement(ctx,date,true,null);let data=await loadEnergyData(ctx.db,date,date);assert.equal(dailyEnergy(data,date,date).net,-400);assert.equal(monthEnergy(data,'2026-10',date).net,-400);await setExpenditure(ctx,date,0);assert.equal((await getFoodSettlement(ctx.db,date))?.stale,true);assert.equal(monthEnergy(await loadEnergyData(ctx.db,date,date),'2026-10',date).net,301);await setExpenditure(ctx,date,701);await saveFoodSettlement(ctx,date,true,null);ctx.setDate('2026-10-13');await saveProfile(ctx,'2026-10-13',{...profile,metabolism:1700});data=await loadEnergyData(ctx.db,date,'2026-10-13');assert.equal(dailyEnergy(data,date,'2026-10-13').net,-400);assert.equal((await getDayEnergy(ctx.db,date))?.metabolism,1599);assert.equal((await getSetting(ctx.db,'profile'))?.metabolism,1700);}finally{ctx.close();}});
test('old draft cannot be silently created today; midnight transaction rejects deletion/profile',async()=>{const ctx=await testContext();try{const record=await createMeal(ctx,date,meal,null);ctx.setDate('2026-10-13');await assert.rejects(createMeal(ctx,date,meal,null));ctx.setDate(date);const original=ctx.db.transaction.bind(ctx.db);ctx.db.transaction=fn=>{ctx.setDate('2026-10-13');return original(fn);};await assert.rejects(deleteMeal(ctx,record.id));assert.ok(await ctx.db.first('SELECT id FROM meals WHERE id=?',[record.id]));ctx.setDate(date);await assert.rejects(saveProfile(ctx,date,profile));assert.equal(await getSetting(ctx.db,'profile'),null);}finally{ctx.close();}});
test('expenditure invalid inputs never mutate, explicit zero vs null remain distinct',async()=>{const ctx=await testContext();try{await saveProfile(ctx,date,profile);await setExpenditure(ctx,date,100);for(const n of [-1,NaN,Infinity,100001])await assert.rejects(setExpenditure(ctx,date,n));assert.equal((await getDayEnergy(ctx.db,date))?.expenditure,100);await setExpenditure(ctx,date,0);assert.equal((await getDayEnergy(ctx.db,date))?.expenditure,0);await setExpenditure(ctx,date,null);assert.equal((await getDayEnergy(ctx.db,date))?.expenditure,null);}finally{ctx.close();}});
test('task levels are independent from stable order and historical updates rejected',async()=>{const ctx=await testContext();try{
 const a=await createTask(ctx,date,task);const b=await createTask(ctx,date,{...task,name:'散步',orderLevel:1});const c=await createTask(ctx,date,{...task,name:'整理',orderLevel:1});
 assert.deepEqual((await listTasks(ctx.db,date)).map(t=>t.id),[b.id,c.id,a.id]);assert.equal(a.orderLevel,2);
 await updateTask(ctx,a.id,{...task,orderLevel:1});assert.deepEqual((await listTasks(ctx.db,date)).map(t=>t.id),[b.id,c.id,a.id]);
 await setTaskStatus(ctx,a.id,'done');await savePlanSettlement(ctx,date,'完成阅读');await setTaskStatus(ctx,b.id,'cancelled');assert.equal((await getPlanSettlement(ctx.db,date))?.stale,true);
 await deleteTask(ctx,b.id);assert.deepEqual((await listTasks(ctx.db,date)).map(t=>t.sortOrder),[3,4]);
 for(const orderLevel of [0,4,1.5,'1',null])await assert.rejects(createTask(ctx,date,{...task,orderLevel:orderLevel as never}));
 ctx.setDate('2026-10-13');await assert.rejects(setTaskStatus(ctx,a.id,'todo'));await assert.rejects(updateTask(ctx,a.id,{...task,orderLevel:3}));
 }finally{ctx.close();}});
test('schema 1 tasks migrate to level 2 preserving old priority and order',async()=>{const db=nodeDb();try{
 await MIGRATIONS[0].up(db);await db.exec('PRAGMA user_version=1');
 await db.run('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)',['old','2026-10-11','旧任务','important','日常','done',7,null,1,1]);
 await migrate(db);const tasks=await listTasks(db,'2026-10-11');assert.equal(tasks[0].orderLevel,2);assert.equal(tasks[0].sortOrder,7);assert.equal(tasks[0].priority,'important');assert.equal(await migrate(db),SCHEMA_VERSION);
 }finally{db.close();}});

test('water increments and undo, historical guard, item unknown vs zero and categories',async()=>{const ctx=await testContext();try{await addWater(ctx,date,250,'08:00');await addWater(ctx,date,500,'08:01');assert.equal((await listWater(ctx.db,date)).reduce((s,r)=>s+r.amountMl,0),750);await undoLastWater(ctx,date);assert.equal((await listWater(ctx.db,date)).length,1);assert.equal((await listWater(ctx.db,date))[0].amountMl,250);ctx.setDate('2026-10-13');await assert.rejects(addWater(ctx,date,250,'09:00'));const base={name:'耳机',category:'电子设备',purchaseDate:null,priceCents:null,location:null,brand:null,note:null};await createItem(ctx,base,null);await createItem(ctx,{...base,name:'赠品',priceCents:0},null);assert.deepEqual((await listItems(ctx.db)).map(i=>i.priceCents).sort(),[0,null]);await assert.rejects(deleteCategory(ctx,'电子设备'));await renameCategory(ctx,'电子设备','数码');assert.equal((await listItems(ctx.db,'耳机','数码')).length,1);}finally{ctx.close();}});
test('draft captured date immutable and module deletion isolated',async()=>{const ctx=await testContext();try{await saveDraft(ctx,'meal:new',date,{name:'草稿'});ctx.setDate('2026-10-13');await assert.rejects(saveDraft(ctx,'meal:new','2026-10-13',{}));assert.equal((await getDraft(ctx.db,'meal:new'))?.date,date);await createTask(ctx,'2026-10-13',task);await deleteModule(ctx,'food');assert.equal(await getDraft(ctx.db,'meal:new'),null);assert.equal((await listTasks(ctx.db,'2026-10-13')).length,1);}finally{ctx.close();}});


test('photo import crossing midnight rolls back and removes imported blob',async()=>{const ctx=await testContext();try{const importer=ctx.photos.importFromUri.bind(ctx.photos);ctx.photos.importFromUri=async uri=>{const name=await importer(uri);ctx.setDate('2026-10-13');return name;};await assert.rejects(createMeal(ctx,date,meal,'photo'));assert.deepEqual(ctx.photos.list(),[]);assert.equal((await ctx.db.all('SELECT * FROM meals')).length,0);}finally{ctx.close();}});
test('failure after meal insert rolls back meal and snapshot plus cleans new photo',async()=>{const ctx=await testContext();try{const transaction=ctx.db.transaction.bind(ctx.db);ctx.db.transaction=fn=>transaction(tx=>fn({...tx,run:async(sql,args)=>{if(sql.includes('INSERT INTO day_energy'))throw new Error('disk full');return tx.run(sql,args);}}));await assert.rejects(createMeal(ctx,date,meal,'photo'));assert.equal((await ctx.db.all('SELECT * FROM meals')).length,0);assert.equal(await getDayEnergy(ctx.db,date),null);assert.deepEqual(ctx.photos.list(),[]);}finally{ctx.close();}});

test('draft deletion waits for pending save transaction and cannot be resurrected',async()=>{const ctx=await testContext();try{const save=saveDraft(ctx,'meal:new',date,{name:'last keystroke'});const remove=import('../src/data/draftRepo.ts').then(({deleteDraft})=>deleteDraft(ctx,'meal:new'));await Promise.all([save,remove]);assert.equal(await getDraft(ctx.db,'meal:new'),null);}finally{ctx.close();}});
