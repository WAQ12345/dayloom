import test from 'node:test';
import assert from 'node:assert/strict';
import { testContext } from './helpers/sqlite.ts';
import { backupNow, restoreWithSafety, readableBackupDirectory, type BackupDestination, type BackupState } from '../src/services/backupFlow.ts';
import { createBackup, inspectBackup } from '../src/services/backup.ts';

function destination() {
  let state: BackupState = { directory: null, lastSavedAt: null, filename: null };
  const calls: string[] = [];
  const files: Uint8Array[] = [];
  const io: BackupDestination = {
    async readState() { return { ...state }; },
    async writeState(s) { state = s; calls.push('state'); },
    async accessible() { calls.push('access'); return true; },
    async choose() { calls.push('choose'); return 'content://chosen'; },
    async writeVerified(uri, bytes) { calls.push(uri); files.push(bytes); return `backup-${files.length}.zip`; },
  };
  return { io, calls, files };
}

test('backup first chooses a location; subsequent backup reuses it and validates ZIP', async () => {
  const ctx = await testContext(); const {io,calls,files} = destination();
  try {
    await backupNow(ctx,io); await backupNow(ctx,io);
    assert.equal(calls.filter(c=>c==='choose').length,1);
    assert.equal(files.length,2); assert.equal(inspectBackup(files[1]).summary.meals,0);
    assert.equal((await io.readState()).filename,'backup-2.zip');
  } finally {ctx.close();}
});
test('cancel after revoked permission and failed write preserve last successful metadata', async () => {
  const ctx = await testContext(); const {io} = destination();
  try {
    await backupNow(ctx,io); const old = await io.readState();
    io.accessible=async()=>false; io.choose=async()=>null;
    assert.equal(await backupNow(ctx,io),null); assert.deepEqual(await io.readState(),old);
    io.choose=async()=>'content://new';io.writeVerified=async()=>{throw new Error('disk full')};
    await assert.rejects(backupNow(ctx,io),/disk full/);assert.deepEqual(await io.readState(),old);
  } finally {ctx.close();}
});
test('revoked directory replaced only after verified save; metadata failure reports saved file honestly', async()=>{
  const ctx=await testContext();const {io}=destination();
  try {await backupNow(ctx,io);io.accessible=async()=>false;io.choose=async()=>'content://replacement';await backupNow(ctx,io);assert.equal((await io.readState()).directory,'content://replacement');io.writeState=async()=>{throw new Error('disk')};await assert.rejects(backupNow(ctx,io),/备份已保存为/);}finally{ctx.close();}
});
test('restore checkpoint failure prevents database mutation; successful checkpoint can restore old data', async()=>{
  const ctx=await testContext();const source=await testContext();
  try {
    await ctx.db.run("INSERT INTO categories(name,sort) VALUES('原有分类',99)");
    const incoming=inspectBackup(await createBackup(source));
    await assert.rejects(restoreWithSafety(ctx,incoming,async()=>{throw new Error('no space')}),/no space/);
    assert.ok(await ctx.db.first("SELECT * FROM categories WHERE name='原有分类'"));
    let checkpoint:Uint8Array|undefined;
    await restoreWithSafety(ctx,incoming,async bytes=>{checkpoint=bytes;assert.ok(await ctx.db.first("SELECT * FROM categories WHERE name='原有分类'"));});
    assert.equal(await ctx.db.first("SELECT * FROM categories WHERE name='原有分类'"),null);
    await restoreWithSafety(ctx,inspectBackup(checkpoint!),async()=>{});
    assert.ok(await ctx.db.first("SELECT * FROM categories WHERE name='原有分类'"));
  }finally{ctx.close();source.close();}
});

test('restore transaction failure retains current records and the completed safety snapshot', async()=>{
  const ctx=await testContext();const source=await testContext();
  try {
    await ctx.db.run("INSERT INTO categories(name,sort) VALUES('保留记录',99)");
    const incoming=inspectBackup(await createBackup(source));
    const original=ctx.db.transaction.bind(ctx.db);let transactions=0;
    ctx.db.transaction=async fn=>{if(++transactions===2)throw new Error('restore transaction failed');return original(fn)};
    let saved:Uint8Array|undefined;
    await assert.rejects(restoreWithSafety(ctx,incoming,async b=>{saved=b}),/restore transaction failed/);
    assert.ok(saved);assert.ok(inspectBackup(saved).payload.tables.categories.some(r=>r.name==='保留记录'));
    assert.ok(await ctx.db.first("SELECT * FROM categories WHERE name='保留记录'"));
  }finally{ctx.close();source.close();}
});


test('a missing Android tree returning an empty list must reopen the picker',()=>{
  assert.equal(readableBackupDirectory({exists:false,list:()=>[]}),false);
  assert.equal(readableBackupDirectory({exists:true,list:()=>[]}),true);
  assert.equal(readableBackupDirectory({exists:true,list:()=>{throw new Error('revoked')}}),false);
});
