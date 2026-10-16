import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { nodeDb } from './helpers/sqlite.ts';
import { saveProfile, createChart, createConversation, appendMessage } from '../src/data/aiRepo.ts';
import { migrate } from '../src/data/migrations.ts';
import type { DataContext, PhotoStore } from '../src/data/sql.ts';
import { createBackup, inspectBackup, restoreBackup } from '../src/services/backup.ts';

const png = new Uint8Array(readFileSync(new URL('../assets/favicon.png', import.meta.url)));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function diskPhotos(dir: string): PhotoStore {
  mkdirSync(dir,{recursive:true}); const file=(n:string)=>join(dir,n);
  return {importFromUri:async()=>{throw new Error('not used');},write:async(n,b)=>{writeFileSync(file(n),b,{flag:'wx'});},read:async n=>new Uint8Array(readFileSync(file(n))),exists:n=>existsSync(file(n)),remove:n=>unlinkSync(file(n)),list:()=>readdirSync(dir),uri:n=>`file://${file(n)}`,modifiedAt:n=>statSync(file(n)).mtimeMs};
}
async function open(dir:string) {
  mkdirSync(dir,{recursive:true});const db=nodeDb(join(dir,'records.sqlite'));await migrate(db);
  const ctx:DataContext={db,photos:diskPhotos(join(dir,'photos')),clock:{now:()=>new Date('2026-10-12T12:00:00')}};
  return {...ctx, close:()=>db.close()};
}
function canonical(backup:ReturnType<typeof inspectBackup>) {
  const table=JSON.parse(JSON.stringify(backup.payload.tables));
  const refs=new Map(Object.entries(backup.photos).map(([name,bytes])=>[name,hash(bytes)]));
  for (const key of ['meals','items']) for (const row of table[key]) if(row.photo) row.photo=refs.get(row.photo);
  for(const row of table.drafts) {
    let raw=row.payload;
    for(const [name,digest] of refs) raw=raw.split(name).join(digest);
    row.payload=raw;
  }
  for(const rows of Object.values(table) as unknown[][]) rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return table;
}
test('disk ZIP restore survives database close/reopen and preserves records + photo hashes',async()=>{
  const root=mkdtempSync(join(tmpdir(),'chaoxi-restore-'));
  let source:Awaited<ReturnType<typeof open>>|undefined, target:Awaited<ReturnType<typeof open>>|undefined;
  try {
    source=await open(join(root,'source'));target=await open(join(root,'target'));
    await source.photos.write('real.png',png);
    await source.db.run('INSERT INTO meals VALUES(?,?,?,?,?,?,?,?,?,?)',['m','2026-10-12','lunch','恢复用午餐',450,'12:00','长备注\n第二行','real.png',1,1]);
    await source.db.run('INSERT INTO water VALUES(?,?,?,?,?,?)',['w','2026-10-12','10:00',250,null,1]);
    await source.db.run('INSERT INTO day_energy VALUES(?,?,?,?)',['2026-10-12',1600,300,1]);
    await source.db.run('INSERT INTO items VALUES(?,?,?,?,?,?,?,?,?,?,?)',['i','免费物品','其他',null,0,'书桌','品牌','备注','real.png',1,1]);
    await source.db.run('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)',['t','2026-10-12','恢复计划','normal','日常','done',1,'内容',1,1,2]);
    await source.db.run('INSERT INTO shopping_items VALUES(?,?,?,?,?,?,?,?)',['s','购物',null,'done',1,1,2,2]);
    await source.db.run('INSERT INTO life_records VALUES(?,?,?,?,?,?,?,?,?)',['l','membership','会员','2026-10-01',null,null,1,1,1]);
    await source.db.run('INSERT INTO drafts VALUES(?,?,?,?)',['item:editor',null,JSON.stringify({id:null,input:{name:'草稿',category:'其他',purchaseDate:'',price:'',location:'',brand:'',note:'',unknownDate:true,unknownPrice:true},photo:source.photos.uri('real.png'),originalPhoto:'real.png',photoChanged:true}),1]);
    await source.db.run('INSERT INTO food_favorites VALUES(?,?,?,?,?)',['f','常用早餐',200,'breakfast',1]);
    await source.db.run('INSERT INTO food_settlements VALUES(?,?,?,?,?,?,?)',['2026-10-12',1,0,450,1900,null,1]);
    await source.db.run('INSERT INTO plan_settlements VALUES(?,?,?,?,?,?)',['2026-10-12','完成',1,1,0,1]);
    const profile=await saveProfile(source,{nickname:'恢复测试',input:{calendar:'solar',date:'2000-01-01',time:{kind:'unknown'},sex:'男'}});
    const chart=await createChart(source,{profileId:profile.id,input:profile.input,result:{pillars:[]},algorithmVersion:'test-v1'});
    const conversation=await createConversation(source,{tool:'bazi',profileId:profile.id,snapshot:JSON.stringify({chart:'命盘',algorithmVersion:'test-v1',referenceSummary:'摘要'}),refs:[{ref:'B1',recordId:chart.id,label:'命盘',summary:'命盘',kind:'bazi'}],promptVersion:'test-v1'});
    await appendMessage(source,{conversationId:conversation.id,role:'assistant',content:'测试解读',settings:{model:'test',thinking:'high'},status:'success'});
    await source.db.run('INSERT INTO settings VALUES(?,?)',['reminder',JSON.stringify({enabled:true,time:'21:30',notificationId:'old'})]);
    const before=inspectBackup(await createBackup(source));const archive=join(root,'backup.zip');writeFileSync(archive,await createBackup(source));if(process.env.CHAOXI_QA_FIXTURE)writeFileSync(process.env.CHAOXI_QA_FIXTURE,readFileSync(archive));source.close();source=undefined;
    await target.db.run("INSERT INTO categories VALUES('旧目标数据',99)");
    await restoreBackup(target,inspectBackup(new Uint8Array(readFileSync(archive))));target.close();target=await open(join(root,'target'));
    const after=inspectBackup(await createBackup(target));
    const reminder=after.payload.tables.settings.find(row=>row.key==='reminder');
    assert.deepEqual(JSON.parse(String(reminder?.value)),{enabled:false,time:'21:30',notificationId:null});
    before.payload.tables.settings.find(row=>row.key==='reminder')!.value=reminder!.value;
    assert.deepEqual(canonical(after),canonical(before));
    assert.deepEqual(Object.values(after.photos).map(hash),[hash(png)]);
    assert.equal(await target.db.first("SELECT name FROM categories WHERE name='旧目标数据'"),null);
    const stable=canonical(after);assert.throws(()=>inspectBackup(new Uint8Array(readFileSync(archive)).slice(0,40)));
    assert.deepEqual(canonical(inspectBackup(await createBackup(target))),stable);
  } finally {source?.close();target?.close();rmSync(root,{recursive:true,force:true});}
});

test('two years of disk records: indexed day reads, long inventory and complete ZIP restore',async(t)=>{
 const root=mkdtempSync(join(tmpdir(),'chaoxi-volume-'));const source=await open(join(root,'source')),target=await open(join(root,'target'));
 try {
  const start=performance.now();
  await source.db.transaction(async tx=>{
   for(let d=0;d<730;d++){
    const date=new Date(Date.UTC(2024,0,1+d)).toISOString().slice(0,10);
    for(let n=0;n<4;n++)await tx.run('INSERT INTO meals VALUES(?,?,?,?,?,?,?,?,?,?)',[`m${d}_${n}`,date,['breakfast','lunch','dinner','snack'][n],`餐食${n}`,400,'12:00',null,null,1,1]);
    for(let n=0;n<8;n++)await tx.run('INSERT INTO water VALUES(?,?,?,?,?,?)',[`w${d}_${n}`,date,'12:00',250,null,1]);
    for(let n=0;n<5;n++)await tx.run('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)',[`t${d}_${n}`,date,`任务${n}`,'normal','日常',n%2?'done':'todo',n+1,null,1,1,2]);
    await tx.run('INSERT INTO day_energy VALUES(?,?,?,?)',[date,1600,300,1]);
   }
   for(let n=0;n<2000;n++)await tx.run('INSERT INTO items VALUES(?,?,?,?,?,?,?,?,?,?,?)',[`i${n}`,`物品${n}`,'其他',null,n%2?null:0,'桌面',null,'连续操作测试',null,n+1,n+1]);
  });
  const seeded=performance.now();
  for(let n=0;n<100;n++)assert.equal((await source.db.all('SELECT * FROM meals WHERE date=?',['2024-02-29'])).length,4);
  const queried=performance.now();
  const bytes=await createBackup(source);if(process.env.CHAOXI_QA_VOLUME_FIXTURE)writeFileSync(process.env.CHAOXI_QA_VOLUME_FIXTURE,bytes);const backed=performance.now();await restoreBackup(target,inspectBackup(bytes));const restored=performance.now();
  assert.deepEqual(canonical(inspectBackup(await createBackup(target))),{...canonical(inspectBackup(bytes)),settings:[{key:'reminder',value:'{"enabled":false,"time":"21:30","notificationId":null}'}]});
  assert.equal((await target.db.first<{n:number}>('SELECT COUNT(*) n FROM items'))?.n,2000);
  t.diagnostic(JSON.stringify({records:15140,days:730,items:2000,seedMs:Math.round(seeded-start),dayReads100Ms:Math.round(queried-seeded),backupMs:Math.round(backed-queried),restoreMs:Math.round(restored-backed),zipBytes:bytes.length}));
 }finally{source.close();target.close();rmSync(root,{recursive:true,force:true});}
});

test('disk photo collection removes only unreferenced files older than seven days',async()=>{
 const {utimesSync}=await import('node:fs');
 const {collectOldPhotos}=await import('../src/data/photoCleanup.ts');
 const root=mkdtempSync(join(tmpdir(),'chaoxi-photo-age-'));const ctx=await open(root);
 try{
  const now=ctx.clock.now().getTime();
  for(const name of ['kept.png','orphan.png','recent.png']){await ctx.photos.write(name,png);const age=name==='recent.png'?6:8;utimesSync(join(root,'photos',name),new Date(now-age*86400000),new Date(now-age*86400000));}
  await ctx.db.run('INSERT INTO meals VALUES(?,?,?,?,?,?,?,?,?,?)',['m','2026-10-12','lunch','照片保留',0,null,null,'kept.png',1,1]);
  assert.deepEqual(await collectOldPhotos(ctx),{removed:1,skipped:false});
  assert.equal(existsSync(join(root,'photos','orphan.png')),false);
  assert.equal(hash(await ctx.photos.read('kept.png')),hash(png));
  assert.equal(hash(await ctx.photos.read('recent.png')),hash(png));
 }finally{ctx.close();rmSync(root,{recursive:true,force:true});}
});

test('restore photo write exhaustion cleans partial files and retains original disk data after reopen',async()=>{
 const root=mkdtempSync(join(tmpdir(),'zhaoxi-restore-full-'));
 const source=await open(join(root,'source'));let target=await open(join(root,'target'));
 try {
  for(const name of ['first.png','second.png'])await source.photos.write(name,png);
  for(const [id,photo] of [['one','first.png'],['two','second.png']])await source.db.run('INSERT INTO items VALUES(?,?,?,?,?,?,?,?,?,?,?)',[id,id,'其他',null,null,null,null,null,photo,1,1]);
  await target.photos.write('original.png',png);
  await target.db.run('INSERT INTO items VALUES(?,?,?,?,?,?,?,?,?,?,?)',['old','原有物品','其他',null,0,null,null,null,'original.png',1,1]);
  const before=canonical(inspectBackup(await createBackup(target)));
  const write=target.photos.write.bind(target.photos);let count=0;
  target.photos.write=async(name,bytes)=>{
   if(++count===2){await write(name,bytes.slice(0,12));throw Object.assign(new Error('ENOSPC: simulated photo write exhaustion'),{code:'ENOSPC'});}
   await write(name,bytes);
  };
  await assert.rejects(restoreBackup(target,inspectBackup(await createBackup(source))),/ENOSPC/);
  assert.equal(count,2);
  target.close();target=await open(join(root,'target'));
  assert.deepEqual(target.photos.list(),['original.png']);
  assert.deepEqual(canonical(inspectBackup(await createBackup(target))),before);
  assert.equal(hash(await target.photos.read('original.png')),hash(png));
 }finally{source.close();target.close();rmSync(root,{recursive:true,force:true});}
});
