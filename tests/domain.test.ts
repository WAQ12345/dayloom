import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyEnergy,monthEnergy,netLabel,signedKcal,type EnergyData } from '../src/domain/energy.ts';
import { artworkId,artworkIndex } from '../src/domain/artwork.ts';
import { localDate,assertToday,shiftDate,monthDates,isValidDate } from '../src/domain/dates.ts';
import { validateMeal,parsePriceCents } from '../src/domain/validation.ts';
const today='2026-10-12';
function fixture():EnergyData{return{currentMetabolism:1599,days:{'2026-10-01':{metabolism:1599,expenditure:701},'2026-10-02':{metabolism:1599,expenditure:401},'2026-10-03':{metabolism:1599,expenditure:401}},meals:[{date:'2026-10-01',kcal:1900},{date:'2026-10-02',kcal:2200},{date:'2026-10-03',kcal:2000}],settlements:Object.fromEntries([1,2,3].map(d=>[`2026-10-0${d}`,{confirmed:true,stale:false}]))};}
test('month signed offset -400 +200 zero, counts zero',()=>{const m=monthEnergy(fixture(),'2026-10',today);assert.equal(m.net,-200);assert.equal(m.included,3);assert.equal(m.days[0].net,-400);assert.equal(m.days[1].net,200);assert.equal(m.days[2].net,0);});
test('complete inputs automatically count even without legacy confirmation',()=>{const d=fixture();d.settlements={...d.settlements,'2026-10-01':{confirmed:true,stale:true},'2026-10-02':{confirmed:false,stale:false}};d.days={...d.days,'2026-10-03':{metabolism:1599,expenditure:null}};const m=monthEnergy(d,'2026-10',today);assert.equal(m.net,201);assert.equal(m.included,3);assert.equal(m.pending,0);assert.equal(m.incomplete,0);assert.equal(m.days[12].status,'future');});
test('zero intake retained but no meals missing; profile cannot rewrite snapshot',()=>{const d=fixture();d.currentMetabolism=9000;assert.equal(dailyEnergy(d,'2026-10-01',today).net,-400);d.meals=[{date:'2026-10-01',kcal:0}];assert.equal(dailyEnergy(d,'2026-10-01',today).net,-2300);d.meals=[];assert.equal(dailyEnergy(d,'2026-10-01',today).intake,null);});
test('local date, leap years, year transitions, history/future guards',()=>{assert.equal(localDate(new Date(2026,9,12,0,1)),today);assert.equal(monthDates('2024-02').length,29);assert.equal(monthDates('2025-02').length,28);assert.equal(isValidDate('2025-02-29'),false);assert.equal(shiftDate('2026-12-31',1),'2027-01-01');assert.throws(()=>assertToday('2026-10-11',today));assert.throws(()=>assertToday('2026-10-13',today));});
test('14 distinct artworks, week cycle, cross-month/year/DST calendar days',()=>{const ids=new Set<string>();for(const module of ['food','plans'] as const){for(let i=0;i<7;i++)ids.add(artworkId(module,shiftDate('2026-10-10',i))!);assert.equal(artworkId(module,'2026-10-10'),artworkId(module,'2026-10-17'));}assert.equal(ids.size,14);for(const[a,b]of[['2026-10-31','2026-11-01'],['2026-12-31','2027-01-01'],['2026-03-08','2026-03-09']])assert.equal((artworkIndex(a)!+1)%7,artworkIndex(b));assert.equal(artworkIndex('2026-10-09'),6);});
test('simple kcal inputs, exact price cents and invalid values',()=>{const meal={name:'酸奶',kcal:'0',mealType:'snack' as const,time:'',note:''};assert.equal(validateMeal(meal).kcal,0);for(const kcal of['','-1','NaN','Infinity'])assert.throws(()=>validateMeal({...meal,kcal}));assert.equal(parsePriceCents('price','0'),0);assert.equal(parsePriceCents('price','12.34'),1234);assert.throws(()=>parsePriceCents('price','1.234'));});

test('no settlement required, missing values excluded, edits recalculate immediately',()=>{
 const d=fixture();d.settlements={};
 assert.equal(monthEnergy(d,'2026-10',today).net,-200);
 d.days={...d.days,'2026-10-01':{metabolism:1599,expenditure:0}};
 assert.equal(monthEnergy(d,'2026-10',today).net,501);
 d.meals=[];assert.equal(monthEnergy(d,'2026-10',today).net,null);
 assert.equal(dailyEnergy(d,'2026-10-01',today).eligible,false);
});

test('net labels and signs use consumption negative and intake positive',()=>{
 assert.equal(netLabel(-400),'净消耗');assert.equal(signedKcal(-400),'−400');
 assert.equal(netLabel(200),'净摄入');assert.equal(signedKcal(200),'+200');
 assert.equal(netLabel(0),'收支平衡');assert.equal(signedKcal(0),'0');
});
