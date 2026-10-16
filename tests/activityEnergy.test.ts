import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyEnergy, monthEnergy, totalConsumption, type EnergyData } from '../src/domain/energy.ts';
import { testContext } from './helpers/sqlite.ts';
import { saveProfile } from '../src/data/settingsRepo.ts';
import { createMeal, getDayEnergy, loadEnergyData, saveFoodSettlement } from '../src/data/foodRepo.ts';
import { createBackup, inspectBackup } from '../src/services/backup.ts';
import { foodDocument, renderMarkdown } from '../src/services/export/document.ts';
const date='2026-10-12';
const profile={sex:'male' as const,age:30,heightCm:170,weightKg:65,metabolism:1500,mode:'manual' as const};
const data=():EnergyData=>({meals:[],days:{},settlements:{},currentMetabolism:1500});
test('activity alone defaults to zero; missing meals/metabolism remain unknown and empty month is not populated',()=>{
 const input=data();const today=dailyEnergy(input,date,date);
 assert.equal(today.expenditure,0);assert.equal(today.total,1500);assert.equal(today.intake,null);assert.equal(today.net,null);
 const month=monthEnergy(input,'2026-10',date);assert.equal(month.included,0);assert.equal(month.incomplete,0);assert.equal(month.net,null);assert.equal(month.days[0].status,'missing');assert.equal(month.days[0].metabolism,null);assert.equal(month.days[0].total,null);
 input.meals=[{date,kcal:0}];assert.equal(dailyEnergy(input,date,date).net,-1500);
 input.currentMetabolism=null;assert.equal(dailyEnergy(input,date,date).total,null);
 assert.equal(totalConsumption(1500,null),1500);assert.equal(totalConsumption(1500,undefined),1500);assert.equal(totalConsumption(null,0),null);
});
test('invalid activity never becomes zero and historical metabolism is never filled from current profile',()=>{
 for(const value of [-1,NaN,Infinity]){assert.equal(totalConsumption(1500,value),null);const input=data();input.days={[date]:{metabolism:1500,expenditure:value}};input.meals=[{date,kcal:2000}];assert.equal(dailyEnergy(input,date,date).total,null);assert.equal(dailyEnergy(input,date,date).eligible,false)}
 const input=data();input.meals=[{date:'2026-10-11',kcal:2000}];input.days={'2026-10-11':{metabolism:1200,expenditure:null}};assert.equal(dailyEnergy(input,'2026-10-11',date).net,800);
 input.days={'2026-10-11':{metabolism:null,expenditure:null}};assert.equal(dailyEnergy(input,'2026-10-11',date).total,null);
});
test('default activity computes immediately, survives backup confirmation and never backfills historic storage',async()=>{
 const ctx=await testContext(date);try{
  await saveProfile(ctx,date,profile);
  let input=await loadEnergyData(ctx.db,date,date);assert.equal(dailyEnergy(input,date,date).total,1500);assert.equal((await getDayEnergy(ctx.db,date))?.expenditure,null);
  const meal=await createMeal(ctx,date,{name:'午餐',kcal:1900,mealType:'lunch',time:null,note:null},null);
  await saveProfile(ctx,date,{...profile,metabolism:1600});input=await loadEnergyData(ctx.db,date,date);const day=dailyEnergy(input,date,date);assert.equal(day.total,1600);assert.equal(day.net,300);
  const md=renderMarkdown(foodDocument(date,[meal],[],day,null,new Date()));assert.match(md,/活动消耗 \| 0 kcal/);assert.match(md,/总消耗 \| 1600 kcal/);assert.ok(!md.includes('手填消耗'));
  await saveFoodSettlement(ctx,date,true,null);const backup=await createBackup(ctx);assert.doesNotThrow(()=>inspectBackup(backup));
  const before=await getDayEnergy(ctx.db,date);ctx.setDate('2026-10-13');await saveProfile(ctx,'2026-10-13',{...profile,metabolism:2000});
  input=await loadEnergyData(ctx.db,date,'2026-10-13');assert.equal(dailyEnergy(input,date,'2026-10-13').total,1600);assert.deepEqual(await getDayEnergy(ctx.db,date),before);assert.equal(before?.expenditure,null);
 }finally{ctx.close()}
});
