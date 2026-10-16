import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {createIdea,getIdea,listIdeas} from '../src/data/ideaRepo.ts';
import {createBackup,inspectBackup,restoreBackup} from '../src/services/backup.ts';
import {ideasDocument,renderMarkdown} from '../src/services/export/document.ts';
import {ideaScope} from '../src/services/aiTools/index.ts';
import {createItem,getItem,updateItem} from '../src/data/itemRepo.ts';
import {testContext} from './helpers/sqlite.ts';
const archive=(payload:unknown)=>zipSync({'manifest.json':strToU8(JSON.stringify(payload))});
test('idea management flags roundtrip without changing timestamps, export or AI material',async()=>{
 const source=await testContext(),target=await testContext();try{
  const first=await createIdea(source,{body:'归档正文',tags:[]});source.setDate('2026-10-13');
  const second=await createIdea(source,{body:'置顶正文',tags:['生活']});
  await source.db.run('UPDATE ideas SET archived=1 WHERE id=?',[first.id]);
  await source.db.run('UPDATE ideas SET pinned=1 WHERE id=?',[second.id]);
  const rows=await listIdeas(source.db);assert.equal(rows.length,2);
  const before=inspectBackup(await createBackup(source));await restoreBackup(target,before);
  assert.deepEqual(await listIdeas(target.db),rows);
  assert.equal((await getIdea(target.db,first.id))?.createdAt,first.createdAt);
  assert.equal((await getIdea(target.db,first.id))?.updatedAt,first.updatedAt);
  const md=renderMarkdown(ideasDocument(rows));assert.match(md,/归档正文/);assert.match(md,/置顶正文/);
  const scope=ideaScope(rows);assert.equal(scope.references.length,2);assert.ok(!scope.snapshot.includes('"pinned"'));assert.ok(!scope.snapshot.includes('"archived"'));
 }finally{source.close();target.close()}
});
test('schema 7 idea backups upgrade flags; invalid flags and conflicting states are rejected',async()=>{
 const source=await testContext(),target=await testContext();try{
  const row=await createIdea(source,{body:'旧备份',tags:[]});
  const payload=inspectBackup(await createBackup(source)).payload;
  const old=structuredClone(payload);old.schema=7;for(const item of old.tables.ideas){delete item.pinned;delete item.archived;}
  const checked=inspectBackup(archive(old));assert.equal(checked.payload.tables.ideas[0].pinned,0);assert.equal(checked.payload.tables.ideas[0].archived,0);
  await restoreBackup(target,checked);assert.deepEqual(await getIdea(target.db,row.id),row);
  for(const state of [{pinned:2,archived:0},{pinned:1,archived:1},{pinned:0,archived:'true'}]){
   const invalid=structuredClone(payload);Object.assign(invalid.tables.ideas[0],state);assert.throws(()=>inspectBackup(archive(invalid)));assert.deepEqual(await getIdea(target.db,row.id),row);
  }
 }finally{source.close();target.close()}
});

test('new backup preserves old item location and photo while app edits do not rewrite location',async()=>{
 const source=await testContext(),target=await testContext();try{
  await source.db.run('INSERT INTO categories(name,sort) VALUES(?,?)',['数码',0]);
  const input={name:'旧物品',category:'数码',purchaseDate:null,priceCents:0,location:null,brand:null,note:null};
  const item=await createItem(source,input,'memory://synthetic-photo');
  await source.db.run('UPDATE items SET location=? WHERE id=?',['旧抽屉',item.id]);
  source.photos.remove(item.photo!);await source.photos.write(item.photo!,Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')));
  const expectedPhoto=await source.photos.read(item.photo!);
  const backup=inspectBackup(await createBackup(source));await restoreBackup(target,backup);
  const restored=await getItem(target.db,item.id);assert.ok(restored);assert.equal(restored.location,'旧抽屉');
  assert.deepEqual(await target.photos.read(restored.photo!),expectedPhoto);
  const edited=await updateItem(target,item.id,{...input,name:'改名'}, {kind:'keep'});assert.equal(edited.location,'旧抽屉');
  assert.deepEqual(await target.photos.read(edited.photo!),expectedPhoto);
 }finally{source.close();target.close()}
});
