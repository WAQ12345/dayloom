import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testContext} from './helpers/sqlite.ts';
import {createItem,getItem,listItems,updateItem} from '../src/data/itemRepo.ts';
import {getDraft,saveDraft} from '../src/data/draftRepo.ts';
import {validateItem,type ItemInput} from '../src/domain/validation.ts';

const input={name:'耳机',category:'其他',purchaseDate:null,priceCents:0,location:null,brand:'品牌_型号',note:'工作用'};

test('new items omit retired location even when resuming a legacy draft',async()=>{
 const ctx=await testContext();
 try{
  const draft:ItemInput={name:'旧草稿',category:'其他',purchaseDate:'',unknownDate:true,price:'',unknownPrice:true,location:'曾填写的位置',brand:'',note:''};
  await saveDraft(ctx,'item:editor',null,{id:null,input:draft});
  const resumed=(await getDraft<{id:null;input:ItemInput}>(ctx.db,'item:editor'))!.payload;
  const saved=await createItem(ctx,validateItem({...resumed.input,location:''},['其他']),null);
  assert.equal(saved.location,null);
  assert.equal((await getItem(ctx.db,saved.id))?.location,null);
  assert.equal((await createItem(ctx,{...input,location:'旧调用参数'},null)).location,null);
 }finally{ctx.close();}
});

test('editing historical items preserves stored location and ignores draft replacements',async()=>{
 const ctx=await testContext();
 try{
  const saved=await createItem(ctx,input,null);
  await ctx.db.run('UPDATE items SET location=? WHERE id=?',['历史抽屉',saved.id]);
  for(const location of [null,'','旧草稿另一处位置']){
   const edited=await updateItem(ctx,saved.id,{...input,name:'新名称',location},{kind:'keep'});
   assert.equal(edited.location,'历史抽屉');
   assert.equal((await getItem(ctx.db,saved.id))?.location,'历史抽屉');
   assert.equal(edited.name,'新名称');
  }
 }finally{ctx.close();}
});

test('item search excludes historical locations and keeps name, brand, note and literal filters',async()=>{
 const ctx=await testContext();
 try{
  const saved=await createItem(ctx,input,null);
  await ctx.db.run('UPDATE items SET location=? WHERE id=?',['唯一历史位置',saved.id]);
  assert.deepEqual(await listItems(ctx.db,'唯一历史位置'),[]);
  for(const query of ['耳机','品牌_','工作用'])assert.equal((await listItems(ctx.db,query,'其他'))[0]?.id,saved.id);
  assert.deepEqual(await listItems(ctx.db,'%'),[]);
  assert.deepEqual(await listItems(ctx.db,'耳机','不存在'),[]);
 }finally{ctx.close();}
});
