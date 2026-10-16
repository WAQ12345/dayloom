import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { energy,assertToday,parseBackup,validateMeal,localDate } from '../src/domain/records.ts';
test('消耗只加一次，活动默认零且代谢缺失未知',()=>{assert.deepEqual(energy(1900,1599,701),{total:2300,difference:-400});assert.equal(energy(0,1599,0).total,1599);assert.equal(energy(1900,1599,null).total,1599)});
test('跨日写入拒绝',()=>{assert.throws(()=>assertToday('2026-10-09','2026-10-10'));assertToday('2026-10-10','2026-10-10')});
test('本地日期而非UTC日期',()=>assert.equal(localDate(new Date(2026,9,10,0,1)),'2026-10-10'));
test('热量输入校验',()=>{assert.equal(validateMeal('酸奶','0').kcal,0);for(const value of ['', '-1','NaN'])assert.throws(()=>validateMeal('酸奶',value))});
test('备份白名单与拒绝无效版本',()=>{const base={format:'daily-life-probe',version:1,apiKey:'must-not-survive',meals:[{id:'1',date:'2026-10-10',name:'酸奶',kcal:100,photoBase64:null}]};const result=parseBackup(JSON.stringify(base));assert.ok(!('apiKey' in result));assert.throws(()=>parseBackup(JSON.stringify({...base,version:99})));assert.throws(()=>parseBackup(JSON.stringify({...base,meals:[...base.meals,...base.meals]})))});
