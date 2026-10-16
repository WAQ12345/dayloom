import test from 'node:test';
import assert from 'node:assert/strict';
import { testContext } from './helpers/sqlite.ts';
import { collectOldPhotos } from '../src/data/photoCleanup.ts';

test('startup photo collection preserves records, draft references and recent/unknown files', async () => {
  const ctx = await testContext();
  try {
    for (const name of ['meal.jpg','draft.jpg','original.jpg','recent.jpg','unknown.jpg','old.jpg']) await ctx.photos.write(name, new Uint8Array([1]));
    await ctx.db.run('INSERT INTO meals VALUES(?,?,?,?,?,?,?,?,?,?)', ['m','2026-10-12','lunch','午餐',0,null,null,'meal.jpg',1,1]);
    await ctx.db.run('INSERT INTO drafts VALUES(?,?,?,?)', ['item:editor',null,JSON.stringify({photo:ctx.photos.uri('draft.jpg'),originalPhoto:'original.jpg'}),1]);
    ctx.photos.modifiedAt = name => name === 'unknown.jpg' ? null : name === 'recent.jpg' ? ctx.clock.now().getTime() : 1;
    assert.deepEqual(await collectOldPhotos(ctx), {removed:1,skipped:false});
    assert.deepEqual(ctx.photos.list().sort(), ['draft.jpg','meal.jpg','original.jpg','recent.jpg','unknown.jpg']);
  } finally { ctx.close(); }
});
test('malformed draft fails closed; removal error is nonfatal', async () => {
  const ctx = await testContext();
  try {
    await ctx.photos.write('old.jpg',new Uint8Array([1]));ctx.photos.modifiedAt = () => 1;
    await ctx.db.run('INSERT INTO drafts VALUES(?,?,?,?)',['item:editor',null,'{broken',1]);
    assert.deepEqual(await collectOldPhotos(ctx),{removed:0,skipped:true});assert.ok(ctx.photos.exists('old.jpg'));
    await ctx.db.run('DELETE FROM drafts');ctx.photos.remove = () => {throw new Error('filesystem unavailable');};
    assert.deepEqual(await collectOldPhotos(ctx),{removed:0,skipped:false});assert.ok(ctx.photos.exists('old.jpg'));
  } finally {ctx.close();}
});
