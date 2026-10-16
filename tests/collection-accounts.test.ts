import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync,strToU8 } from 'fflate';
import { validateCollection } from '../src/domain/collections.ts';
import { createCollection,getCollection,listCollections,updateCollection } from '../src/data/collectionRepo.ts';
import { saveDraft,getDraft } from '../src/data/draftRepo.ts';
import { createBackup,inspectBackup,restoreBackup } from '../src/services/backup.ts';
import { MIGRATIONS,migrate,SCHEMA_VERSION } from '../src/data/migrations.ts';
import { nodeDb,testContext } from './helpers/sqlite.ts';
const account={kind:'account' as const,name:'QA合成平台',body:'合成备注',url:'https://example.com/login',source:'QA合成',account:'qa-user@example.invalid',password:'  QA-only dummy 密码 😀 \n'};
const archive=(value:unknown)=>zipSync({'manifest.json':strToU8(JSON.stringify(value))});
test('collection kinds have explicit required fields, passwords preserve raw values and hidden credentials are discarded',()=>{
 assert.equal(validateCollection(account).password,account.password);assert.equal(validateCollection({...account,account:'',password:' '}).password,' ');assert.equal(validateCollection({...account,password:''}).password,'');
 assert.throws(()=>validateCollection({...account,account:' ',password:''}));assert.throws(()=>validateCollection({...account,kind:'text',body:' '}));assert.throws(()=>validateCollection({...account,kind:'link',url:''}));assert.throws(()=>validateCollection({...account,kind:'bad'}));
 assert.equal(validateCollection({...account,account:'😀'.repeat(500),password:'😀'.repeat(2000)}).password.length,4000);
 assert.throws(()=>validateCollection({...account,account:'😀'.repeat(501)}));
 for(const login of ['qa\u0000user','qa\nuser','qa\tuser','qa\u007fuser'])assert.throws(()=>validateCollection({...account,account:login}));
 assert.throws(()=>validateCollection({...account,password:'qa\u0000password'}));
 assert.equal(validateCollection({...account,password:'  QA-only\n\t password  '}).password,'  QA-only\n\t password  ');assert.throws(()=>validateCollection({...account,password:'😀'.repeat(2001)}));
 const text=validateCollection({...account,kind:'text'});assert.equal(text.account,'');assert.equal(text.password,'');assert.equal(text.url,'');
 const link=validateCollection({...account,kind:'link'});assert.equal(link.account,'');assert.equal(link.password,'');assert.equal(link.body,account.body);
});
test('account list never selects or returns password and password-only text cannot match search',async()=>{
 const ctx=await testContext();try{
  const created=await createCollection(ctx,account);assert.equal((await getCollection(ctx.db,created.id))?.password,account.password);
  const all=await listCollections(ctx.db);assert.equal(all.length,1);assert.ok(!('password' in all[0]));assert.ok(!JSON.stringify(all).includes(account.password));assert.equal((await listCollections(ctx.db,{query:'QA-only dummy'})).length,0);assert.equal((await listCollections(ctx.db,{query:'qa-user@example.invalid'})).length,1);
  const reader={...ctx.db,all:async<T>(sql:string,args:readonly(string|number|null)[]=[]):Promise<T[]>=>{assert.ok(!/SELECT \*/.test(sql));assert.ok(!sql.includes('password'));return ctx.db.all<T>(sql,args)}};assert.equal((await listCollections(reader)).length,1);
  assert.deepEqual(await updateCollection(ctx,created.id,account),created);const changed=await updateCollection(ctx,created.id,{...account,kind:'text'});assert.equal(changed.password,'');assert.equal(changed.account,'');assert.equal(changed.url,'');assert.equal((await getCollection(ctx.db,created.id))?.password,'');
  const relinked=await updateCollection(ctx,created.id,{...account,kind:'link'});assert.equal(relinked.password,'');assert.equal(relinked.account,'');
 }finally{ctx.close()}
});
test('schema7 additive migration infers old link/text and retains untouched bodies/timestamps',async()=>{
 const db=nodeDb();try{
  for(const migration of MIGRATIONS.slice(0,6))await migration.up(db);await db.exec('PRAGMA user_version=6');
  const oldColumns=await db.all<{name:string}>('PRAGMA table_info(collections)');assert.deepEqual(oldColumns.map(column=>column.name),['id','name','body','url','source','created_at','updated_at']);
  await db.run('INSERT INTO collections VALUES(?,?,?,?,?,?,?)',['text','', '  原文\n尾  ','','书摘',1,2]);await db.run('INSERT INTO collections VALUES(?,?,?,?,?,?,?)',['link','旧链接','','https://example.com','',3,4]);
  assert.equal(await migrate(db),SCHEMA_VERSION);const text=await getCollection(db,'text'),link=await getCollection(db,'link');assert.equal(text?.kind,'text');assert.equal(link?.kind,'link');assert.equal(text?.body,'  原文\n尾  ');assert.equal(link?.createdAt,3);assert.equal(link?.updatedAt,4);assert.equal(text?.password,'');assert.equal(link?.account,'');assert.deepEqual(await db.all('PRAGMA foreign_key_check'),[]);assert.equal(await migrate(db),SCHEMA_VERSION);
 }finally{db.close()}
});
test('ordinary ZIP includes exact local plaintext password, restores it unchanged and validates credentials without mutating originals',async()=>{
 const source=await testContext(),target=await testContext();try{
  const created=await createCollection(source,account);await saveDraft(source,'collection:editor',null,{id:created.id,input:{...account,password:'未完成合成密码'.repeat(300)}});
  const checked=inspectBackup(await createBackup(source));assert.equal(checked.payload.tables.collections[0].password,account.password);assert.equal(checked.payload.tables.collections[0].kind,'account');await restoreBackup(target,checked);assert.deepEqual(await getCollection(target.db,created.id),created);assert.deepEqual((await getDraft(target.db,'collection:editor'))?.payload,(await getDraft(source.db,'collection:editor'))?.payload);
  for(const mutate of [(payload:typeof checked.payload)=>{payload.tables.collections[0].kind='bad'},(payload:typeof checked.payload)=>{payload.tables.collections[0].password='x'.repeat(2001)},(payload:typeof checked.payload)=>{payload.tables.collections[0].account='';payload.tables.collections[0].password=''},(payload:typeof checked.payload)=>{payload.tables.collections[0].kind='text'}]){const bad=structuredClone(checked);mutate(bad.payload);await assert.rejects(restoreBackup(target,bad));assert.deepEqual(await getCollection(target.db,created.id),created);}
 }finally{source.close();target.close()}
});
test('genuine v6 ZIP and unfinished old draft gain kind/account/password while old content remains intact',async()=>{
 const source=await testContext(),target=await testContext();try{
  const text=await createCollection(source,{...account,kind:'text'}),link=await createCollection(source,{...account,kind:'link'});const old=inspectBackup(await createBackup(source)).payload;old.schema=6;
  for(const row of old.tables.collections){delete row.kind;delete row.account;delete row.password;}
  old.tables.drafts=[{key:'collection:editor',date:null,payload:JSON.stringify({id:null,input:{name:'',body:'',url:'https://',source:''}}),updated_at:1}];
  const checked=inspectBackup(archive(old));await restoreBackup(target,checked);assert.equal((await getCollection(target.db,text.id))?.kind,'text');assert.equal((await getCollection(target.db,link.id))?.kind,'link');assert.equal((await getCollection(target.db,link.id))?.password,'');
  const draft=await getDraft<{id:null;input:{kind:string;password:string;account:string;url:string}}>(target.db,'collection:editor');assert.equal(draft?.payload.input.kind,'link');assert.equal(draft?.payload.input.password,'');assert.equal(draft?.payload.input.account,'');assert.equal(draft?.payload.input.url,'https://');const backup=await createBackup(target);assert.doesNotThrow(()=>inspectBackup(backup));
 }finally{source.close();target.close()}
});
