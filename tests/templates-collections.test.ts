import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync,strToU8 } from 'fflate';
import { validateTemplate } from '../src/domain/templates.ts';
import { validateCollection } from '../src/domain/collections.ts';
import { createTemplate,updateTemplate,deleteTemplate,getTemplate,listTemplates,addTemplatesToToday } from '../src/data/templateRepo.ts';
import { createCollection,updateCollection,deleteCollection,getCollection,listCollections } from '../src/data/collectionRepo.ts';
import { createTask,listTasks,savePlanSettlement,getPlanSettlement } from '../src/data/taskRepo.ts';
import { createIdea,getIdea } from '../src/data/ideaRepo.ts';
import { ideaScope } from '../src/services/aiTools/index.ts';
import { createConversation,appendMessage,listMessages } from '../src/data/aiRepo.ts';
import { saveDraft,getDraft } from '../src/data/draftRepo.ts';
import { createBackup,inspectBackup,restoreBackup } from '../src/services/backup.ts';
import { deleteModule } from '../src/data/maintenance.ts';
import { MIGRATIONS,migrate,SCHEMA_VERSION } from '../src/data/migrations.ts';
import { testContext,nodeDb } from './helpers/sqlite.ts';
const date='2026-10-12';
const template={name:'阅读',note:'  原始备注\n',orderLevel:2 as const};
const collection={kind:'text' as const,account:'',password:'',name:'',body:'  原样正文\n末尾  ',url:'',source:'书摘'};
const archive=(value:unknown)=>zipSync({'manifest.json':strToU8(JSON.stringify(value))});
test('formal template boundaries stay task-compatible; collection names optional and bodies preserved',()=>{
 assert.equal(validateTemplate(template).note,template.note);assert.equal(validateTemplate({...template,name:'字'.repeat(100),note:'字'.repeat(500)}).name.length,100);
 for(const value of [{...template,name:''},{...template,name:'字'.repeat(101)},{...template,note:'字'.repeat(501)},{...template,orderLevel:4}])assert.throws(()=>validateTemplate(value));
 assert.equal(validateCollection(collection).body,collection.body);assert.equal(validateCollection(collection).name,'');assert.equal(validateCollection({...collection,kind:'link',body:'',url:'https://example.com/path?q=1#中文'}).body,'');
 assert.equal(validateCollection({...collection,body:'😀'.repeat(20000),name:'😀'.repeat(100),source:'😀'.repeat(200)}).body.length,40000);
 for(const value of [{...collection,body:' ',url:''},{...collection,body:'😀'.repeat(20001)},{...collection,name:'字'.repeat(101)},{...collection,source:'字'.repeat(201)}])assert.throws(()=>validateCollection(value));
 for(const url of ['javascript:alert(1)','file:///tmp/a','ftp://example.com','https://','https://exa mple.com','https://example.com/\npath','https://user:pass@example.com','https://example.com/'+ 'a'.repeat(4096)])assert.throws(()=>validateCollection({...collection,kind:'link',url}));
});
test('CRUD timestamps/order/search/pagination stay stable across edits and clock rollback',async()=>{
 const ctx=await testContext();try{
  const t=await createTemplate(ctx,template),c=await createCollection(ctx,collection);ctx.setDate('2026-10-13');const t2=await createTemplate(ctx,{...template,name:'后模板'}),c2=await createCollection(ctx,{...collection,name:'后收藏',body:'百分比100%_'});
  assert.deepEqual((await listTemplates(ctx.db)).map(r=>r.id),[t2.id,t.id]);assert.deepEqual((await listCollections(ctx.db)).map(r=>r.id),[c2.id,c.id]);assert.equal((await listTemplates(ctx.db,{limit:1,offset:1}))[0].id,t.id);assert.equal((await listCollections(ctx.db,{query:'100%_'}))[0].id,c2.id);
  assert.deepEqual(await updateTemplate(ctx,t.id,template),t);assert.deepEqual(await updateCollection(ctx,c.id,collection),c);ctx.setDate('2026-10-11');const edited=await updateTemplate(ctx,t.id,{...template,name:'改名'}),editedC=await updateCollection(ctx,c.id,{...collection,kind:'link',url:'https://example.com'});assert.equal(edited.createdAt,t.createdAt);assert.equal(edited.updatedAt,t.updatedAt+1);assert.equal(editedC.createdAt,c.createdAt);assert.equal(editedC.updatedAt,c.updatedAt+1);
  await deleteTemplate(ctx,t2.id);await deleteCollection(ctx,c2.id);assert.equal(await getTemplate(ctx.db,t2.id),null);assert.equal(await getCollection(ctx.db,c2.id),null);
  await assert.rejects(listTemplates(ctx.db,{limit:0}));await assert.rejects(listCollections(ctx.db,{offset:-1}));await assert.rejects(updateTemplate(ctx,'gone',template));await assert.rejects(updateCollection(ctx,'gone',collection));
 }finally{ctx.close()}
});
test('batch template insertion is library ordered, appends within levels and explicitly repeats as independent tasks',async()=>{
 const ctx=await testContext();try{
  const older=await createTemplate(ctx,{...template,name:'较早',orderLevel:1});ctx.setDate('2026-10-13');const newer=await createTemplate(ctx,{...template,name:'较晚',orderLevel:3});ctx.setDate(date);
  const existing=await createTask(ctx,date,{name:'已有',note:null,orderLevel:1,project:''});const added=await addTemplatesToToday(ctx,[older.id,newer.id],date);assert.deepEqual(added.map(r=>r.name),['较晚','较早']);assert.deepEqual(added.map(r=>r.orderLevel),[3,1]);assert.ok(added.every(r=>r.status==='todo'&&r.priority==='normal'&&r.project===''));assert.ok(added.every(r=>r.sortOrder>existing.sortOrder));
  const repeated=await addTemplatesToToday(ctx,[older.id,newer.id],date);assert.equal(new Set([...added,...repeated].map(r=>r.id)).size,4);
  await updateTemplate(ctx,older.id,{...template,name:'新模板正文',orderLevel:2});await deleteTemplate(ctx,newer.id);assert.equal((await listTasks(ctx.db,date)).find(r=>r.id===added[1].id)?.name,'较早');assert.equal((await listTasks(ctx.db,date)).find(r=>r.id===added[0].id)?.name,'较晚');
  const tasks=await listTasks(ctx.db,date);await assert.rejects(addTemplatesToToday(ctx,[older.id,older.id],date));await assert.rejects(addTemplatesToToday(ctx,[older.id,'missing'],date));assert.deepEqual(await listTasks(ctx.db,date),tasks);const backup=await createBackup(ctx);assert.doesNotThrow(()=>inspectBackup(backup));
 }finally{ctx.close()}
});
test('batch task insertion fault or midnight rolls back every task and settlement staleness',async()=>{
 const ctx=await testContext();try{
  const a=await createTemplate(ctx,template),b=await createTemplate(ctx,{...template,name:'第二条'});await savePlanSettlement(ctx,date,'保持');const before=await getPlanSettlement(ctx.db,date);const transaction=ctx.db.transaction.bind(ctx.db);
  let writes=0;ctx.db.transaction=fn=>transaction(tx=>fn({...tx,run:async(sql,args)=>{if(sql.startsWith('INSERT INTO tasks')&&++writes===2)throw new Error('disk fault');return tx.run(sql,args)}}));await assert.rejects(addTemplatesToToday(ctx,[a.id,b.id],date),/disk fault/);assert.equal((await listTasks(ctx.db,date)).length,0);assert.deepEqual(await getPlanSettlement(ctx.db,date),before);
  ctx.db.transaction=fn=>transaction(tx=>fn({...tx,run:async(sql,args)=>{const result=await tx.run(sql,args);if(sql.startsWith('INSERT INTO tasks'))ctx.setDate('2026-10-13');return result}}));await assert.rejects(addTemplatesToToday(ctx,[a.id,b.id],date),/今天|历史/);assert.equal((await listTasks(ctx.db,date)).length,0);assert.deepEqual(await getPlanSettlement(ctx.db,date),before);
  ctx.db.transaction=transaction;await assert.rejects(addTemplatesToToday(ctx,[a.id],date),/今天|历史/);
 }finally{ctx.close()}
});
test('template and collection save atomically consumes own drafts, including no-op, with failure rollback',async()=>{
 const ctx=await testContext();try{
  const td={id:null,input:template},cd={id:null,input:collection};await saveDraft(ctx,'template:editor',null,td);await saveDraft(ctx,'collection:editor',null,cd);await assert.rejects(saveDraft(ctx,'template:editor',date,td));await assert.rejects(saveDraft(ctx,'collection:editor',date,cd));
  const transaction=ctx.db.transaction.bind(ctx.db);ctx.db.transaction=fn=>transaction(tx=>fn({...tx,run:async(sql,args)=>{if(sql.startsWith('DELETE FROM drafts'))throw new Error('fault');return tx.run(sql,args)}}));
  await assert.rejects(createTemplate(ctx,template,{consumeDraft:true}),/fault/);await assert.rejects(createCollection(ctx,collection,{consumeDraft:true}),/fault/);assert.equal((await listTemplates(ctx.db)).length,0);assert.equal((await listCollections(ctx.db)).length,0);assert.deepEqual((await getDraft(ctx.db,'template:editor'))?.payload,td);assert.deepEqual((await getDraft(ctx.db,'collection:editor'))?.payload,cd);
  ctx.db.transaction=transaction;const t=await createTemplate(ctx,template,{consumeDraft:true});assert.equal(await getDraft(ctx.db,'template:editor'),null);assert.ok(await getDraft(ctx.db,'collection:editor'));const c=await createCollection(ctx,collection,{consumeDraft:true});assert.equal(await getDraft(ctx.db,'collection:editor'),null);
  await saveDraft(ctx,'template:editor',null,{...td,id:t.id});await saveDraft(ctx,'collection:editor',null,{...cd,id:c.id});assert.deepEqual(await updateTemplate(ctx,t.id,template,{consumeDraft:true}),t);assert.deepEqual(await updateCollection(ctx,c.id,collection,{consumeDraft:true}),c);assert.equal(await getDraft(ctx.db,'template:editor'),null);assert.equal(await getDraft(ctx.db,'collection:editor'),null);
 }finally{ctx.close()}
});
test('schema6 migration is additive and preserves v5 idea AI messages, tasks and drafts',async()=>{
 const db=nodeDb();try{
  await db.exec('PRAGMA foreign_keys=ON');for(const migration of MIGRATIONS.slice(0,5))await migration.up(db);await db.exec('PRAGMA user_version=5');
  await db.run('INSERT INTO ideas VALUES(?,?,?,?,?)',['old-idea','旧正文','[]',1,1]);await db.run('INSERT INTO ai_conversations VALUES(?,?,?,?,?,?,?)',['old-chat','ideas',null,'{}','[]','ideas-1',1]);await db.run('INSERT INTO ai_messages VALUES(?,?,?,?,?,?,?,?,?,?)',['old-msg','old-chat','assistant','旧回答','{}',null,'success',null,1,1]);await db.run('INSERT INTO drafts VALUES(?,?,?,?)',['idea:editor',null,'{}',1]);
  const before=await db.all('SELECT * FROM ai_messages');assert.equal(await migrate(db),SCHEMA_VERSION);assert.deepEqual(await db.all('SELECT * FROM ai_messages'),before);assert.equal((await db.all('SELECT * FROM ideas')).length,1);assert.equal((await db.all('SELECT * FROM drafts')).length,1);assert.deepEqual(await listTemplates(db),[]);assert.deepEqual(await listCollections(db),[]);assert.deepEqual(await db.all('PRAGMA foreign_key_check'),[]);assert.equal(await migrate(db),SCHEMA_VERSION);
 }finally{db.close()}
});
test('backup roundtrip includes both modules and unfinished oversized drafts; corruption cannot replace originals',async()=>{
 const source=await testContext(),target=await testContext();try{
  const t=await createTemplate(source,template),c=await createCollection(source,collection);await addTemplatesToToday(source,[t.id],date);
  const td={id:null,input:{name:'',note:'x'.repeat(501),orderLevel:2}},cd={id:null,input:{kind:'link',account:'',password:'',name:'',body:'😀'.repeat(20001),url:'https://',source:''}};await saveDraft(source,'template:editor',null,td);await saveDraft(source,'collection:editor',null,cd);
  const backup=inspectBackup(await createBackup(source));assert.equal(backup.summary.templates,1);assert.equal(backup.summary.collections,1);await restoreBackup(target,backup);assert.deepEqual(await getTemplate(target.db,t.id),t);assert.deepEqual(await getCollection(target.db,c.id),c);assert.deepEqual((await getDraft(target.db,'collection:editor'))?.payload,cd);assert.deepEqual((await getDraft(target.db,'template:editor'))?.payload,td);
  for(const mutate of [(payload:typeof backup.payload)=>{payload.tables.task_templates[0].order_level=4},(payload:typeof backup.payload)=>{payload.tables.collections[0].url='javascript:alert(1)'},(payload:typeof backup.payload)=>{payload.tables.collections[0].updated_at=0}]){const bad=structuredClone(backup);mutate(bad.payload);await assert.rejects(restoreBackup(target,bad));assert.deepEqual(await getTemplate(target.db,t.id),t);assert.deepEqual(await getCollection(target.db,c.id),c);}
  await deleteModule(target,'templates');await deleteModule(target,'collections');assert.equal((await listTasks(target.db,date)).length,1);assert.equal((await listTemplates(target.db)).length,0);assert.equal((await listCollections(target.db)).length,0);assert.equal(await getDraft(target.db,'template:editor'),null);assert.equal(await getDraft(target.db,'collection:editor'),null);
 }finally{source.close();target.close()}
});
test('genuine schema5 ZIP keeps ideas and AI, initializes new tables empty and rejects future schemas',async()=>{
 const source=await testContext(),target=await testContext();try{
  const idea=await createIdea(source,{body:'v5旧想法',tags:[]}),scope=ideaScope([idea]);const conversation=await createConversation(source,{tool:'ideas',snapshot:scope.snapshot,refs:scope.references,promptVersion:scope.promptVersion});await appendMessage(source,{conversationId:conversation.id,role:'user',content:'整理',settings:{model:'test'},status:'success'});
  const old=inspectBackup(await createBackup(source)).payload;old.schema=5;for(const row of old.tables.ideas){delete row.pinned;delete row.archived;}delete old.tables.task_templates;delete old.tables.collections;const checked=inspectBackup(archive(old));assert.deepEqual(checked.payload.tables.task_templates,[]);assert.deepEqual(checked.payload.tables.collections,[]);await restoreBackup(target,checked);assert.deepEqual(await getIdea(target.db,idea.id),idea);assert.equal((await listMessages(target.db,conversation.id))[0].content,'整理');assert.throws(()=>inspectBackup(archive({...old,schema:SCHEMA_VERSION+1})));
 }finally{source.close();target.close()}
});

test('deleting template or collection clears only its matching editor draft atomically',async()=>{
 const ctx=await testContext();try{
  const t=await createTemplate(ctx,template),otherT=await createTemplate(ctx,template),c=await createCollection(ctx,collection),otherC=await createCollection(ctx,collection);
  await saveDraft(ctx,'template:editor',null,{id:null,input:template});await saveDraft(ctx,'collection:editor',null,{id:otherC.id,input:collection});await deleteTemplate(ctx,otherT.id);assert.ok(await getDraft(ctx.db,'template:editor'));await deleteCollection(ctx,c.id);assert.equal((await getDraft<{id:string}>(ctx.db,'collection:editor'))?.payload.id,otherC.id);
  await saveDraft(ctx,'template:editor',null,{id:t.id,input:template});const transaction=ctx.db.transaction.bind(ctx.db);ctx.db.transaction=fn=>transaction(tx=>fn({...tx,run:async(sql,args)=>{if(sql.startsWith('DELETE FROM drafts'))throw new Error('draft fault');return tx.run(sql,args)}}));await assert.rejects(deleteTemplate(ctx,t.id),/draft fault/);assert.ok(await getTemplate(ctx.db,t.id));assert.ok(await getDraft(ctx.db,'template:editor'));await assert.rejects(deleteCollection(ctx,otherC.id),/draft fault/);assert.ok(await getCollection(ctx.db,otherC.id));assert.ok(await getDraft(ctx.db,'collection:editor'));
  ctx.db.transaction=transaction;await deleteTemplate(ctx,t.id);await deleteCollection(ctx,otherC.id);assert.equal(await getDraft(ctx.db,'template:editor'),null);assert.equal(await getDraft(ctx.db,'collection:editor'),null);
 }finally{ctx.close()}
});
