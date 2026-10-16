import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync,strToU8 } from 'fflate';
import { testContext } from './helpers/sqlite.ts';
import {SCHEMA_VERSION} from '../src/data/migrations.ts';
import {createBackup,inspectBackup,restoreBackup} from '../src/services/backup.ts';
import {createAiPreview,requestAnalysis,validateCitations} from '../src/services/ai.ts';
import type {Meal} from '../src/domain/types.ts';
const meal:Meal={id:'m1',date:'2026-10-12',mealType:'lunch',name:'午餐',kcal:400,time:'12:00',note:'private note',photo:null,createdAt:1,updatedAt:1};
const preview=()=>createAiPreview({question:'总结',includeFood:true,meals:[meal],water:[],selectedIds:['m1'],from:'2026-10-12',to:'2026-10-12'});
test('AI default authorization excludes records; snapshot frozen and range enforced',()=>{
 const p=createAiPreview({question:'总结',includeFood:false,meals:[meal],water:[],selectedIds:['m1'],from:'2026-10-12',to:'2026-10-12'});
 assert.equal(p.references.length,0);assert.ok(!p.snapshot.includes('午餐'));
 const q=preview();assert.ok(!q.snapshot.includes('private note'));assert.ok(Object.isFrozen(q));assert.ok(Object.isFrozen(q.references));
 assert.equal(createAiPreview({question:'总结',includeFood:true,meals:[meal],water:[],selectedIds:['m1'],from:'2026-10-11',to:'2026-10-11'}).references.length,0);
 assert.deepEqual(validateCitations('[R1] [R99]',q.references).map(c=>c.valid),[true,false]);
});
test('AI only sends frozen preview to official endpoint; no automatic retry and safe errors',async()=>{
 let calls=0;
 const result=await requestAnalysis(preview(),{key:'test',model:'deepseek-chat',timeoutSeconds:5,fetcher:async(url,init)=>{calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');const body=JSON.parse(String(init?.body));assert.equal(body.messages[1].content,preview().snapshot);return new Response(JSON.stringify({choices:[{message:{content:'午餐 400 kcal [R1]，未知引用 [R88]'}}]}),{status:200});}});
 assert.equal(calls,1);assert.equal(result.citations[1].valid,false);
 await assert.rejects(requestAnalysis(preview(),{key:'test',model:'deepseek-chat',timeoutSeconds:5,fetcher:async()=>{calls++;return new Response('secret upstream details',{status:401});}}),/Key 无效/);assert.equal(calls,2);
 await assert.rejects(requestAnalysis(preview(),{key:'test',model:'deepseek-chat',timeoutSeconds:5,fetcher:async()=>new Response('{}')}),/模型返回内容无效/);
});
test('AI cancellation and timeout never retry',async()=>{
 const controller=new AbortController();let calls=0;
 const fetcher:typeof fetch=async(_url,init)=>{calls++;return new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('abort')));});};
 const request=requestAnalysis(preview(),{key:'test',model:'deepseek-chat',timeoutSeconds:5,signal:controller.signal,fetcher});controller.abort();await assert.rejects(request,/已取消/);
 await assert.rejects(requestAnalysis(preview(),{key:'test',model:'deepseek-chat',timeoutSeconds:1,fetcher}),/超时/);assert.equal(calls,2);
});
async function seed(){const ctx=await testContext();await ctx.db.run('INSERT INTO meals VALUES(?,?,?,?,?,?,?,?,?,?)',['m1','2026-10-12','lunch','午餐',400,'12:00',null,'photo.jpg',1,1]);await ctx.photos.write('photo.jpg',new Uint8Array([255,216,255,0,0,0,0,0,0,0,0,0,0,0]));return ctx;}
test('ZIP roundtrip preserves null vs zero, photos and records; reminders disabled',async()=>{
 const source=await seed();const target=await testContext();
 await source.db.run('INSERT OR REPLACE INTO items(id,name,category,purchase_date,price_cents,location,brand,note,photo,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',['i','免费物品','其他',null,0,null,null,null,null,1,1]);
 await source.db.run('INSERT INTO settings VALUES(?,?)',['reminder',JSON.stringify({enabled:true,time:'21:00',notificationId:'old'})]);
 const bytes=await createBackup(source);const checked=inspectBackup(bytes);assert.equal(checked.summary.photos,1);await restoreBackup(target,checked);
 const rows=await target.db.all<{photo:string}>('SELECT * FROM meals');assert.equal(rows.length,1);assert.notEqual(rows[0].photo,'photo.jpg');assert.ok(target.photos.exists(rows[0].photo));
 const item=await target.db.first<{price_cents:number;purchase_date:null}>('SELECT * FROM items');assert.equal(item?.price_cents,0);assert.equal(item?.purchase_date,null);
 const setting=await target.db.first<{value:string}>("SELECT value FROM settings WHERE key='reminder'");assert.equal(JSON.parse(setting!.value).enabled,false);source.close();target.close();
});
test('corrupt, foreign JSON, traversal ZIP rejected; restore database failure rolls back old data and photos',async()=>{
 assert.throws(()=>inspectBackup(strToU8('{"records":[]}')),/不兼容/);
 assert.throws(()=>inspectBackup(zipSync({'../outside':strToU8('bad')})),/无效/);
 const source=await seed(),target=await testContext();const bytes=await createBackup(source);assert.throws(()=>inspectBackup(bytes.slice(0,50)),/无效/);
 const corrupt=bytes.slice();for(let i=0;i<corrupt.length-46;i++)if(corrupt[i]===80&&corrupt[i+1]===75&&corrupt[i+2]===1&&corrupt[i+3]===2){corrupt[i+16]^=1;break;}assert.throws(()=>inspectBackup(corrupt),/无效/);
 await target.db.run("INSERT INTO categories(name,sort) VALUES('old-preserve',99)");
 const originalTx=target.db.transaction.bind(target.db);
 target.db.transaction=fn=>originalTx(async tx=>{await fn(tx);throw new Error('disk full');});
 await assert.rejects(restoreBackup(target,inspectBackup(bytes)),/disk full/);
 assert.ok(await target.db.first("SELECT name FROM categories WHERE name='old-preserve'"));assert.equal(target.photos.list().length,0);assert.equal((await target.db.all('SELECT * FROM meals')).length,0);source.close();target.close();
});
test('backup rejects noneditable values, missing categories and broken task order; strips unknown setting fields',async()=>{
 const ctx=await testContext();const checked=inspectBackup(await createBackup(ctx));
 function archive(change:(p:typeof checked.payload)=>void){const p=JSON.parse(JSON.stringify(checked.payload));change(p);return zipSync({'manifest.json':strToU8(JSON.stringify(p))});}
 assert.throws(()=>inspectBackup(archive(p=>{p.tables.categories=[];})),/无效/);
 assert.throws(()=>inspectBackup(archive(p=>{p.tables.items=[{id:'i',name:'item',category:'missing',purchase_date:null,price_cents:0,location:null,brand:null,note:null,photo:null,created_at:1,updated_at:1}];})),/无效/);
 for(const amount of [0,5001])assert.throws(()=>inspectBackup(archive(p=>{p.tables.water=[{id:'w',date:'2026-10-12',time:'12:00',amount_ml:amount,note:null,created_at:1}];})),/无效/);
 for(const order of [0,-1])assert.throws(()=>inspectBackup(archive(p=>{p.tables.tasks=[{id:'t',date:'2026-10-12',name:'t',priority:'normal',project:'日常',status:'todo',order_level:2,sort_order:order,note:null,created_at:1,updated_at:1}];})),/无效/);
 for(const amount of [100001])assert.throws(()=>inspectBackup(archive(p=>{p.tables.meals=[{id:'m',date:'2026-10-12',meal_type:'lunch',name:'m',kcal:amount,time:null,note:null,photo:null,created_at:1,updated_at:1}];})),/无效/);
 const clean=inspectBackup(archive(p=>{p.tables.settings=[{key:'aiModel',value:JSON.stringify({model:'deepseek-chat',timeoutSeconds:60,apiKey:'should-not-restore'})}];}));
 assert.ok(!JSON.stringify(clean.payload).includes('should-not-restore'));await restoreBackup(ctx,clean);const row=await ctx.db.first<{value:string}>("SELECT value FROM settings WHERE key='aiModel'");assert.ok(!row!.value.includes('apiKey'));ctx.close();
});
test('backup draft photos are portable and restored to new private references',async()=>{
 const source=await seed(),target=await testContext();await source.db.run('INSERT INTO drafts VALUES(?,?,?,?)',['item:editor',null,JSON.stringify({id:null,input:{name:'草稿',category:'其他',purchaseDate:'',price:'',location:'',brand:'',note:'',unknownDate:true,unknownPrice:true},photo:source.photos.uri('photo.jpg'),originalPhoto:'photo.jpg',photoChanged:true}),1]);
 const backup=inspectBackup(await createBackup(source));assert.ok(!backup.payload.tables.drafts[0].payload?.toString().includes('memory://'));
 await restoreBackup(target,backup);const row=await target.db.first<{payload:string}>('SELECT payload FROM drafts');const d=JSON.parse(row!.payload);assert.equal(d.photo,target.photos.uri(d.originalPhoto));assert.ok(target.photos.exists(d.originalPhoto));source.close();target.close();
});
test('archive export limits match import limits even for highly compressible data',async()=>{
 const {assertArchiveBudget,BACKUP_LIMITS}=await import('../src/services/backup.ts');
 assert.throws(()=>assertArchiveBudget([{name:'manifest.json',size:BACKUP_LIMITS.manifest+1}]),/容量/);
 assert.throws(()=>assertArchiveBudget(Array.from({length:11},(_,i)=>({name:`photos/${i}.jpg`,size:BACKUP_LIMITS.photo}))),/容量/);
 assert.throws(()=>assertArchiveBudget(Array.from({length:BACKUP_LIMITS.entries+1},(_,i)=>({name:`photos/${i}.jpg`,size:1}))),/容量/);
});
test('cancelled request cannot accept a response from a transport ignoring abort',async()=>{
 const c=new AbortController();const fetcher:typeof fetch=async()=>{c.abort();return new Response(JSON.stringify({choices:[{message:{content:'must not accept'}}]}));};
 await assert.rejects(requestAnalysis(preview(),{key:'test',model:'deepseek-chat',timeoutSeconds:2,signal:c.signal,fetcher}),/取消/);
});

test('malformed editor drafts cannot enter the database through a ZIP',async()=>{
 const ctx=await testContext();const base=inspectBackup(await createBackup(ctx)).payload;
 const cases=[{key:'meal:editor',date:'2026-10-12',data:{}},{key:'meal:editor',date:'2026-10-12',data:{date:'2026-10-11',id:null,input:{name:'',kcal:'',time:'',note:'',mealType:'lunch'},photo:null,photoChanged:false}},{key:'task:editor',date:'2026-10-12',data:{id:null,input:'bad'}},{key:'unknown:editor',date:null,data:{id:null,input:{}}}];
 for(const c of cases){const p=JSON.parse(JSON.stringify(base));p.tables.drafts=[{key:c.key,date:c.date,payload:JSON.stringify(c.data),updated_at:1}];assert.throws(()=>inspectBackup(zipSync({'manifest.json':strToU8(JSON.stringify(p))})),/无效/);}
 ctx.close();
});

test('task level ZIP roundtrip and schema 1 compatibility preserve stable gaps and draft level',async()=>{
 const source=await testContext(),target=await testContext();try{
 const base=inspectBackup(await createBackup(source)).payload;
 const task={id:'legacy',date:'2026-10-11',name:'旧任务',priority:'important',project:'日常',status:'done',sort_order:7,note:null,created_at:1,updated_at:1};
 const legacy:typeof base={...base,schema:1,tables:{...base.tables,tasks:[task],drafts:[{key:'task:editor',date:'2026-10-12',payload:JSON.stringify({id:null,input:{name:'草稿',order:'5',priority:'important',project:'日常',note:''}}),updated_at:1}]}};
 const archive=(value:unknown)=>zipSync({'manifest.json':strToU8(JSON.stringify(value))});
 delete legacy.tables.shopping_items;delete legacy.tables.life_records;for(const key of ['bazi_profiles','bazi_charts','ai_conversations','ai_messages','ideas','task_templates','collections'])delete legacy.tables[key];
 const old=inspectBackup(archive(legacy));assert.equal(old.payload.schema,SCHEMA_VERSION);assert.equal(old.payload.tables.tasks[0].order_level,2);await restoreBackup(target,old);
 const upgraded=inspectBackup(await createBackup(target));assert.equal(upgraded.payload.tables.tasks[0].sort_order,7);assert.equal(upgraded.payload.tables.tasks[0].priority,'important');
 const current={...base,tables:{...base.tables,tasks:[{...task,order_level:3}],drafts:[{key:'task:editor',date:'2026-10-12',payload:JSON.stringify({id:null,input:{name:'新草稿',orderLevel:1,project:'日常',note:''}}),updated_at:1}]}};
 await restoreBackup(target,inspectBackup(archive(current)));assert.equal((await target.db.first<{order_level:number}>('SELECT order_level FROM tasks'))?.order_level,3);
 assert.equal(inspectBackup(await createBackup(target)).payload.tables.tasks[0].order_level,3);
 for(const level of [0,4,'1',null])assert.throws(()=>inspectBackup(archive({...current,tables:{...current.tables,tasks:[{...task,order_level:level}]}})),/无效/);
 assert.throws(()=>inspectBackup(archive({...current,schema:SCHEMA_VERSION+1})),/无效/);
 assert.throws(()=>inspectBackup(archive({...current,tables:{...current.tables,tasks:[{...task,order_level:1},{...task,id:'duplicate-order',order_level:2}]}})),/无效/);
 }finally{source.close();target.close();}
});
