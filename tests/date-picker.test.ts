import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePickerDate, pickerMonths, pickerYears } from '../src/domain/datePicker.ts';
import { lunarToSolar } from '../src/domain/bazi/calendar.ts';

test('Gregorian day clamps when changing month/year, and limits available dates',()=>{
 assert.deepEqual(normalizePickerDate({value:'2024-02-31',leap:false},'solar','1900-01-01','2026-10-13'),{value:'2024-02-29',leap:false});
 assert.equal(normalizePickerDate({value:'2023-02-29',leap:false},'solar','1900-01-01','2026-10-13').value,'2023-02-28');
 const options=pickerMonths(2026,'solar','2026-09-28','2026-10-13');
 assert.deepEqual(options.map(m=>m.month),[9,10]);
 assert.deepEqual(options[0].days,[28,29,30]);
 assert.equal(options[1].days.at(-1),13);
 assert.equal(normalizePickerDate({value:'2027-12-31',leap:false},'solar','1900-01-01','2026-10-13').value,'2026-10-13');
});
test('Lunar picker offers real leap months and clamps to actual lunar month length',()=>{
 const months=pickerMonths(2023,'lunar','1900-01-01','2026-10-13');
 assert.deepEqual(months.filter(m=>m.leap).map(m=>m.month),[2]);
 assert.equal(lunarToSolar('2023-02-01',true),'2023-03-22');
 const short=months.find(m=>m.days.length===29)!;
 const normalized=normalizePickerDate({value:`2023-${String(short.month).padStart(2,'0')}-30`,leap:short.leap},'lunar','1900-01-01','2026-10-13');
 assert.equal(normalized.value.slice(-2),'29');
 assert.equal(normalizePickerDate({value:'2024-02-10',leap:true},'lunar','1900-01-01','2026-10-13').leap,false);
});
test('Lunar future bound compares converted solar day, including year boundary',()=>{
 assert.equal(pickerYears('lunar','1900-01-01','2024-01-01').at(-1),2023);
 const months=pickerMonths(2026,'lunar','1900-01-01','2026-10-13');
 for(const month of months) for(const day of month.days){
  const value=`2026-${String(month.month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  assert.ok(lunarToSolar(value,month.leap)<='2026-10-13');
 }
});
