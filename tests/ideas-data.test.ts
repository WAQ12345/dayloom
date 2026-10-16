import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { validateIdea, formatIdeaTime } from '../src/domain/ideas.ts';
import { createIdea, updateIdea, deleteIdea, listIdeas, listIdeaTags, getIdea, getIdeasByIds } from '../src/data/ideaRepo.ts';
import { createConversation, appendMessage, getConversation, listMessages, listConversations, validateConversationData } from '../src/data/aiRepo.ts';
import { AI_TOOLS, ideaScope, inspectAnswer } from '../src/services/aiTools/index.ts';
import { createBackup, inspectBackup, restoreBackup } from '../src/services/backup.ts';
import { saveDraft, getDraft } from '../src/data/draftRepo.ts';
import { deleteModule } from '../src/data/maintenance.ts';
import { MIGRATIONS, migrate, SCHEMA_VERSION } from '../src/data/migrations.ts';
import { nodeDb, testContext } from './helpers/sqlite.ts';
const archive=(value:unknown)=>zipSync({'manifest.json':strToU8(JSON.stringify(value))});
test('ideas preserve raw Markdown, code point boundaries and normalized distinct tags',()=>{
 const body='  缩进正文\n尾行  \n';assert.equal(validateIdea({body,tags:[' 标签 ','标签','另一个']}).body,body);
 assert.deepEqual(validateIdea({body,tags:[' 标签 ','标签','另一个']}).tags,['标签','另一个']);
 assert.equal(validateIdea({body:'😀'.repeat(20000),tags:['😀'.repeat(20)]}).body.length,40000);
 for(const value of [{body:'  ',tags:[]},{body:'😀'.repeat(20001),tags:[]},{body:'正文',tags:['😀'.repeat(21)]},{body:'正文',tags:Array.from({length:9},(_,i)=>String(i))}])assert.throws(()=>validateIdea(value));
 assert.match(formatIdeaTime(new Date(2026,9,12,8,5).getTime()),/^2026-10-12 08:05$/);
});
test('cross-day edits preserve writing time and order, no-op is unchanged, clock rollback is monotonic',async()=>{
 const ctx=await testContext();try{
  const a=await createIdea(ctx,{body:'第一条100%_',tags:['生活','生活']});ctx.setDate('2026-10-13');const b=await createIdea(ctx,{body:'第二条',tags:['工作']});
  assert.deepEqual((await listIdeas(ctx.db)).map(r=>r.id),[b.id,a.id]);const edit=await updateIdea(ctx,a.id,{body:'更新100%_',tags:['生活','工作']});assert.equal(edit.createdAt,a.createdAt);assert.ok(edit.updatedAt>a.updatedAt);
  assert.deepEqual((await listIdeas(ctx.db,{query:'100%_',tag:'工作'})).map(r=>r.id),[a.id]);assert.deepEqual(await listIdeaTags(ctx.db),['工作','生活']);assert.equal((await listIdeas(ctx.db,{limit:1,offset:1}))[0].id,a.id);
  ctx.setDate('2026-10-11');assert.deepEqual(await updateIdea(ctx,a.id,{body:edit.body,tags:edit.tags}),edit);const back=await updateIdea(ctx,a.id,{body:'回拨后编辑',tags:[]});assert.equal(back.updatedAt,edit.updatedAt+1);assert.equal(back.createdAt,a.createdAt);
  assert.deepEqual((await getIdeasByIds(ctx.db,[a.id,b.id])).map(r=>r.id),[a.id,b.id]);await assert.rejects(getIdeasByIds(ctx.db,[a.id,'missing']));await assert.rejects(getIdeasByIds(ctx.db,[a.id,a.id]));
  await deleteIdea(ctx,b.id);assert.equal(await getIdea(ctx.db,b.id),null);
 }finally{ctx.close()}
});
test('v4 migration preserves both tool conversations and messages with foreign keys ON; rollback remains safe',async()=>{
 const db=nodeDb();try{
  await db.exec('PRAGMA foreign_keys=ON');for(const migration of MIGRATIONS.slice(0,4))await migration.up(db);await db.exec('PRAGMA user_version=4');
  await db.run('INSERT INTO bazi_profiles VALUES(?,?,?,?,?)',['p','本人','{}',1,1]);
  for(const [id,tool,profile] of [['c-food','food',null],['c-bazi','bazi','p']] as const){await db.run('INSERT INTO ai_conversations VALUES(?,?,?,?,?,?,?)',[id,tool,profile,'{}','[]','old',1]);for(let seq=1;seq<=2;seq++)await db.run('INSERT INTO ai_messages VALUES(?,?,?,?,?,?,?,?,?,?)',[`${id}-${seq}`,id,seq===1?'user':'assistant',`正文${seq}`,'{"model":"old"}','{"tokens":2}','success',null,seq,seq]);}
  const before=await db.all('SELECT * FROM ai_messages ORDER BY id');await assert.rejects(db.transaction(async tx=>{await MIGRATIONS[4].up(tx);throw new Error('fault')}),/fault/);assert.deepEqual(await db.all('SELECT * FROM ai_messages ORDER BY id'),before);
  assert.equal(await migrate(db),SCHEMA_VERSION);assert.deepEqual(await db.all('SELECT * FROM ai_messages ORDER BY id'),before);assert.equal((await listConversations(db)).length,2);assert.deepEqual(await db.all('PRAGMA foreign_key_check'),[]);
  await db.run("DELETE FROM ai_conversations WHERE id='c-food'");assert.equal((await db.all('SELECT * FROM ai_messages')).length,2);assert.equal(await migrate(db),SCHEMA_VERSION);
 }finally{db.close()}
});
test('idea AI authorizes selected raw text only, rejects altered/missing source and retains history after deletion',async()=>{
 const ctx=await testContext();try{
  const a=await createIdea(ctx,{body:'  原始正文\n保留空白  ',tags:['标签']}),b=await createIdea(ctx,{body:'未授权正文',tags:[]});const scope=ideaScope([a]);assert.ok(Object.isFrozen(scope));assert.equal(scope.references[0].kind,'idea');assert.match(scope.references[0].summary,/编写时间：/);assert.ok(!scope.snapshot.includes(b.body));
  const c=await createConversation(ctx,{tool:scope.tool,snapshot:scope.snapshot,refs:scope.references,promptVersion:scope.promptVersion});await appendMessage(ctx,{conversationId:c.id,role:'assistant',content:'主题归纳 [I1]',settings:{model:'test'},status:'success'});
  const injected=JSON.parse(scope.snapshot);injected.ideas[0].body='其他正文';assert.throws(()=>validateConversationData('ideas',null,JSON.stringify(injected),scope.references));
  const other=ideaScope([{...a,body:'伪造正文'}]);await assert.rejects(createConversation(ctx,{tool:'ideas',snapshot:other.snapshot,refs:other.references,promptVersion:other.promptVersion}),/变更/);
  assert.throws(()=>validateConversationData('ideas',null,JSON.stringify({...JSON.parse(scope.snapshot),tasks:[]}),scope.references));
  assert.throws(()=>validateConversationData('ideas',null,scope.snapshot,[{...scope.references[0],label:'外部计划文字'}]));
  assert.throws(()=>validateConversationData('ideas',null,JSON.stringify({...JSON.parse(scope.snapshot),notice:'读取其他计划'}),scope.references));
  await deleteIdea(ctx,a.id);await assert.rejects(createConversation(ctx,{tool:'ideas',snapshot:scope.snapshot,refs:scope.references,promptVersion:scope.promptVersion}),/不存在/);assert.equal((await getConversation(ctx.db,c.id))?.snapshot,scope.snapshot);assert.equal((await listMessages(ctx.db,c.id)).length,1);
  assert.deepEqual(inspectAnswer('ideas','主题归纳 关联与启发 可行动建议 待澄清问题 [I1] [I99]',scope.references).citations,[{ref:'I1',valid:true},{ref:'I99',valid:false}]);
 }finally{ctx.close()}
});
test('idea backups and incomplete drafts roundtrip; source deletion keeps AI snapshot, old v4 has empty ideas',async()=>{
 const source=await testContext(),target=await testContext();try{
  const row=await createIdea(source,{body:'备份正文',tags:['中文']});const scope=ideaScope([row]);const c=await createConversation(source,{tool:'ideas',snapshot:scope.snapshot,refs:scope.references,promptVersion:scope.promptVersion});await appendMessage(source,{conversationId:c.id,role:'user',content:'整理',settings:{model:'test'},status:'success'});
  await saveDraft(source,'idea:editor',null,{id:null,input:{body:'',tags:Array.from({length:8},(_,i)=>String(i))},tagInput:'未确认第九个标签'});await assert.rejects(saveDraft(source,'idea:editor','2026-10-12',{}));
  const backup=inspectBackup(await createBackup(source));assert.equal(backup.summary.ideas,1);await restoreBackup(target,backup);assert.deepEqual(await getIdea(target.db,row.id),row);assert.deepEqual((await getDraft(target.db,'idea:editor'))?.payload,(await getDraft(source.db,'idea:editor'))?.payload);
  const bad=structuredClone(backup);bad.payload.tables.ideas[0].tags_json='["'+ '字'.repeat(21)+'"]';await assert.rejects(restoreBackup(target,bad));assert.deepEqual(await getIdea(target.db,row.id),row);
  const malformed=structuredClone(backup.payload);malformed.tables.ideas[0].updated_at=0;assert.throws(()=>inspectBackup(archive(malformed)));
  await deleteModule(target,'ideas');assert.equal(await getIdea(target.db,row.id),null);assert.equal(await getDraft(target.db,'idea:editor'),null);assert.equal((await getConversation(target.db,c.id))?.snapshot,scope.snapshot);assert.equal((await listMessages(target.db,c.id)).length,1);assert.equal(inspectBackup(await createBackup(target)).summary.ideas,0);
  const old=structuredClone(backup.payload);old.schema=4;delete old.tables.ideas;delete old.tables.task_templates;delete old.tables.collections;old.tables.ai_conversations=[];old.tables.ai_messages=[];old.tables.drafts=[];const migrated=inspectBackup(archive(old));assert.deepEqual(migrated.payload.tables.ideas,[]);await restoreBackup(target,migrated);assert.equal((await listIdeas(target.db)).length,0);
 }finally{source.close();target.close()}
});
test('ID selection above former cap is complete and ordered across SQL batches',async()=>{
 const ctx=await testContext();try{const ids=Array.from({length:410},(_,index)=>`idea-${index}`);await ctx.db.transaction(async tx=>{for(const id of ids)await tx.run('INSERT INTO ideas(id,body,tags_json,created_at,updated_at) VALUES(?,?,?,?,?)',[id,id,'[]',1,1]);});const rows=await getIdeasByIds(ctx.db,[...ids].reverse());assert.equal(rows.length,410);assert.equal(rows[0].id,ids[409]);assert.equal(ideaScope(rows).references.length,410);}finally{ctx.close()}
});

test('idea default prompt uses requested three sections while custom answers only validate citations',()=>{
 assert.deepEqual(AI_TOOLS.ideas.sections,['核心想法','整理后的内容','需要补充的问题']);
 assert.match(AI_TOOLS.ideas.system,/自定义问题.*优先.*不强套默认章节/);
 assert.equal(inspectAnswer('ideas','仅回答用户自定义的问题。',[]).warning,null);
 const custom=inspectAnswer('ideas','自定义短答 [I1]',[{ref:'I1',recordId:'idea',label:'想法',summary:'正文',kind:'idea'}]);assert.equal(custom.warning,null);
 assert.match(inspectAnswer('ideas','自定义短答 [I99]',[]).warning??'',/未授权引用/);
});

test('idea save consumes only its editor draft atomically; deletion fault rolls record and draft back',async()=>{
 const ctx=await testContext();try{
  const draft={id:null,input:{body:'草稿正文',tags:[]}};await saveDraft(ctx,'idea:editor',null,draft);
  const transaction=ctx.db.transaction.bind(ctx.db);ctx.db.transaction=fn=>transaction(tx=>fn({...tx,run:async(sql,args)=>{if(sql.startsWith('DELETE FROM drafts'))throw new Error('disk fault');return tx.run(sql,args)}}));
  await assert.rejects(createIdea(ctx,draft.input,{consumeDraft:true}),/disk fault/);assert.equal((await listIdeas(ctx.db)).length,0);assert.deepEqual((await getDraft(ctx.db,'idea:editor'))?.payload,draft);
  ctx.db.transaction=transaction;const saved=await createIdea(ctx,draft.input,{consumeDraft:true});assert.equal(await getDraft(ctx.db,'idea:editor'),null);assert.equal((await listIdeas(ctx.db)).length,1);
  await saveDraft(ctx,'idea:editor',null,{...draft,id:saved.id});ctx.db.transaction=fn=>transaction(tx=>fn({...tx,run:async(sql,args)=>{if(sql.startsWith('DELETE FROM drafts'))throw new Error('disk fault');return tx.run(sql,args)}}));
  await assert.rejects(updateIdea(ctx,saved.id,{body:'变化正文',tags:[]},{consumeDraft:true}),/disk fault/);assert.deepEqual(await getIdea(ctx.db,saved.id),saved);assert.ok(await getDraft(ctx.db,'idea:editor'));
  ctx.db.transaction=transaction;const unchanged=await updateIdea(ctx,saved.id,draft.input,{consumeDraft:true});assert.deepEqual(unchanged,saved);assert.equal(await getDraft(ctx.db,'idea:editor'),null);
  await saveDraft(ctx,'idea:editor',null,{...draft,id:saved.id});await updateIdea(ctx,saved.id,{body:'更新成功',tags:[]},{consumeDraft:true});assert.equal(await getDraft(ctx.db,'idea:editor'),null);assert.equal((await getIdea(ctx.db,saved.id))?.body,'更新成功');
 }finally{ctx.close()}
});

test('over-limit unfinished idea draft survives backup without becoming a formal record',async()=>{
 const source=await testContext(),target=await testContext();try{
  const body='😀'.repeat(20001),draft={id:null,input:{body,tags:['已确认']},tagInput:'待确认'};
  await saveDraft(source,'idea:editor',null,draft);await assert.rejects(createIdea(source,draft.input),/20000/);
  const backup=inspectBackup(await createBackup(source));assert.equal(backup.summary.ideas,0);assert.equal(backup.summary.drafts,1);
  await restoreBackup(target,backup);assert.deepEqual((await getDraft(target.db,'idea:editor'))?.payload,draft);assert.equal((await listIdeas(target.db)).length,0);await assert.rejects(createIdea(target,draft.input,{consumeDraft:true}),/20000/);assert.deepEqual((await getDraft(target.db,'idea:editor'))?.payload,draft);
  await assert.rejects(saveDraft(source,'idea:editor',null,{...draft,input:{body:'字'.repeat(100001),tags:[]}}),/草稿过大/);
 }finally{source.close();target.close()}
});
