import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdea, deleteIdea, getIdea, getIdeasByIds, listIdeas, setIdeaArchived, setIdeaPinned, updateIdea } from '../src/data/ideaRepo.ts';
import { createConversation, getConversation, listMessages, appendMessage } from '../src/data/aiRepo.ts';
import { MIGRATIONS, migrate } from '../src/data/migrations.ts';
import { ideaScope } from '../src/services/aiTools/index.ts';
import { nodeDb, testContext } from './helpers/sqlite.ts';

test('v7 migration defaults management state without changing old content, dates or AI history',async()=>{
 const db=nodeDb();try{
  for(const migration of MIGRATIONS.filter(m=>m.version<=7))await migration.up(db);
  await db.exec('PRAGMA user_version=7');
  await db.run('INSERT INTO ideas VALUES(?,?,?,?,?)',['old',' 原始正文\n','["旧标签"]',1,2]);
  await db.run('INSERT INTO ai_conversations VALUES(?,?,?,?,?,?,?)',['chat','ideas',null,'{"historical":true}','[]','ideas-v1',1]);
  const before=await db.all('SELECT * FROM ai_conversations');
  assert.equal(await migrate(db),8);
  assert.deepEqual(await getIdea(db,'old'),{id:'old',body:' 原始正文\n',tags:['旧标签'],createdAt:1,updatedAt:2,pinned:false,archived:false});
  assert.deepEqual(await db.all('SELECT * FROM ai_conversations'),before);
  assert.equal(await migrate(db),8);
  await assert.rejects(db.run('UPDATE ideas SET pinned=2 WHERE id=?',['old']));
 }finally{db.close();}
});

test('management ordering filters before pagination; legacy AI/export listing includes archives in writing order',async()=>{
 const ctx=await testContext();try{
  const first=await createIdea(ctx,{body:'相同检索词 第一条',tags:['共同']});ctx.setDate('2026-10-13');
  const second=await createIdea(ctx,{body:'相同检索词 第二条',tags:['共同']});ctx.setDate('2026-10-14');
  const third=await createIdea(ctx,{body:'相同检索词 第三条',tags:['共同']});ctx.setDate('2026-10-15');
  const fourth=await createIdea(ctx,{body:'相同检索词 第四条',tags:['共同']});
  await setIdeaPinned(ctx,first.id,true);await setIdeaPinned(ctx,second.id,true);await setIdeaArchived(ctx,third.id,true);
  assert.deepEqual((await listIdeas(ctx.db,{archived:false,sort:'pinned'})).map(i=>i.id),[second.id,first.id,fourth.id]);
  assert.deepEqual((await listIdeas(ctx.db,{archived:false,sort:'pinned',limit:1,offset:1})).map(i=>i.id),[first.id]);
  assert.deepEqual((await listIdeas(ctx.db,{archived:true,query:'相同检索词',tag:'共同',sort:'pinned'})).map(i=>i.id),[third.id]);
  assert.deepEqual((await listIdeas(ctx.db,{query:'相同检索词'})).map(i=>i.id),[fourth.id,third.id,second.id,first.id]);
  assert.deepEqual((await getIdeasByIds(ctx.db,[third.id,first.id])).map(i=>i.id),[third.id,first.id]);
  await assert.rejects(listIdeas(ctx.db,{archived:1 as unknown as boolean}));
  await assert.rejects(listIdeas(ctx.db,{sort:'invalid' as 'created'}));
 }finally{ctx.close();}
});

test('pin, archive and restore preserve content timestamps, clear pin on archive, allow archived edits and deletion',async()=>{
 const ctx=await testContext();try{
  const initial=await createIdea(ctx,{body:'原正文',tags:['保留']});ctx.setDate('2026-10-15');
  const pinned=await setIdeaPinned(ctx,initial.id,true);assert.deepEqual(pinned,{...initial,pinned:true});
  assert.deepEqual(await setIdeaPinned(ctx,initial.id,false),initial);
  await setIdeaPinned(ctx,initial.id,true);
  const archived=await setIdeaArchived(ctx,initial.id,true);assert.deepEqual(archived,{...initial,archived:true});
  assert.deepEqual(await setIdeaArchived(ctx,initial.id,true),archived);
  await assert.rejects(setIdeaPinned(ctx,initial.id,true),/先恢复/);
  const edited=await updateIdea(ctx,initial.id,{body:'归档中编辑',tags:['保留']});assert.equal(edited.archived,true);assert.equal(edited.createdAt,initial.createdAt);assert.ok(edited.updatedAt>initial.updatedAt);
  const restored=await setIdeaArchived(ctx,initial.id,false);assert.deepEqual(restored,{...edited,archived:false});assert.equal(restored.pinned,false);
  assert.deepEqual(await setIdeaArchived(ctx,initial.id,false),restored);
  await setIdeaArchived(ctx,initial.id,true);await deleteIdea(ctx,initial.id);assert.equal(await getIdea(ctx.db,initial.id),null);
  await assert.rejects(setIdeaArchived(ctx,initial.id,false),/不存在/);await assert.rejects(setIdeaPinned(ctx,initial.id,true),/不存在/);
 }finally{ctx.close();}
});

test('management state never enters AI reference/snapshot and historical AI survives archive, edit and deletion',async()=>{
 const ctx=await testContext();try{
  const initial=await createIdea(ctx,{body:'授权正文',tags:[]});const scope=ideaScope([initial]);
  const saved=await createConversation(ctx,{tool:scope.tool,snapshot:scope.snapshot,refs:scope.references,promptVersion:scope.promptVersion});
  await appendMessage(ctx,{conversationId:saved.id,role:'assistant',content:'历史回答 [I1]',settings:{model:'test'},status:'success'});
  const pinned=await setIdeaPinned(ctx,initial.id,true);assert.deepEqual(ideaScope([pinned]),scope);
  const archived=await setIdeaArchived(ctx,initial.id,true);assert.deepEqual(ideaScope([archived]),scope);
  assert.deepEqual(Object.keys(JSON.parse(scope.snapshot).ideas[0]).sort(),['body','createdAt','id','tags','updatedAt']);
  const another=await createConversation(ctx,{tool:scope.tool,snapshot:scope.snapshot,refs:scope.references,promptVersion:scope.promptVersion});assert.ok(another.id);
  ctx.setDate('2026-10-15');await updateIdea(ctx,initial.id,{body:'新正文',tags:[]});await deleteIdea(ctx,initial.id);
  assert.equal((await getConversation(ctx.db,saved.id))?.snapshot,scope.snapshot);assert.deepEqual((await getConversation(ctx.db,saved.id))?.refs,scope.references);
  assert.equal((await listMessages(ctx.db,saved.id))[0].content,'历史回答 [I1]');
 }finally{ctx.close();}
});
