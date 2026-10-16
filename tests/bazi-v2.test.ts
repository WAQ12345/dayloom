import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateBazi, currentCycleIndex, formatBaziReport, BAZI_ALGORITHM_VERSION, type BaziInput } from '../src/domain/bazi/index.ts';
import { lunarToSolar, solarToLunar, lunarYearMonths } from '../src/domain/bazi/civil.ts';
import { pillarRelations } from '../src/domain/bazi/relations.ts';
import { SOLAR_TIME_NOTES } from '../src/domain/bazi/explanations.ts';
import { calculateBazi as legacy } from '../src/domain/bazi/legacy.ts';
const now=new Date('2100-12-31T04:00:00Z');
const base:BaziInput={calendar:'solar',date:'1990-06-15',time:{kind:'clock',value:'12:30'},sex:'男'};
const calc=(date:string,time='12:30',sex:'男'|'女'='男')=>calculateBazi({...base,date,time:{kind:'clock',value:time},sex},now);
const labels=(c:ReturnType<typeof calculateBazi>)=>Object.values(c.pillars).map(p=>p.label);

test('runtime pins lunar 1.8.6; comparator does not enter application dependencies',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
 assert.equal(pkg.dependencies['lunar-typescript'],'1.8.6');assert.equal(lock.packages['node_modules/lunar-typescript'].version,'1.8.6');
 assert.ok(!pkg.dependencies.tyme4ts&&!pkg.devDependencies.tyme4ts);assert.ok(!lock.packages['node_modules/tyme4ts']);
 assert.equal(calculateBazi(base,now).algorithmVersion,BAZI_ALGORITHM_VERSION);
});
test('independent HKO civil anchors, valid lunar day 30, leap month and range edges',()=>{
 // HKO civil-date tables, not a claim about second-level astronomical precision.
 for(const [solar,lunar] of [
  ['2023-03-22',{year:2023,month:2,day:1,leap:true}],
  ['2024-02-10',{year:2024,month:1,day:1,leap:false}],
  ['2033-12-22',{year:2033,month:11,day:1,leap:true}],
 ] as const){assert.deepEqual(solarToLunar(solar),lunar);assert.equal(lunarToSolar(`${lunar.year}-${String(lunar.month).padStart(2,'0')}-01`,lunar.leap),solar);}
 assert.equal(lunarToSolar('2023-02-30'),'2023-03-21');
 assert.throws(()=>lunarToSolar('2023-02-30',true));assert.throws(()=>lunarToSolar('2024-02-01',true));
 assert.equal(solarToLunar('1900-01-01').year,1899);assert.doesNotThrow(()=>calc('1900-01-01'));assert.doesNotThrow(()=>calc('2100-12-31'));
 assert.throws(()=>lunarToSolar('1899-12-01'));assert.throws(()=>lunarToSolar('2100-12-30'));assert.throws(()=>calc('2101-01-01'));
});
test('current civil calendar roundtrips real month ends across supported centuries',()=>{
 for(const year of [1900,1901,1950,1990,2000,2023,2024,2033,2050,2099,2100])for(const m of lunarYearMonths(year))for(const day of [1,m.days]){
  const date=`${year}-${String(m.month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  try{const solar=lunarToSolar(date,m.leap);assert.deepEqual(solarToLunar(solar),{year,month:m.month,day,leap:m.leap});}catch(e){if(year!==2100||m.month!==12)throw e;}
 }
 const a=calc('2023-03-22'),b=calculateBazi({...base,calendar:'lunar',date:'2023-02-01',leapMonth:true},now);
 assert.deepEqual(a.pillars,b.pillars);assert.deepEqual(a.professional,b.professional);assert.equal(a.startSolar,b.startSolar);
});
test('fixed year and month term boundaries use the birth minute, including year 2100',()=>{
 // Frozen lunar 1.8.6 fixtures. Separate development comparator checks both libraries.
 for(const [date,before,after] of [['1900-02-04','13:51','13:52'],['2000-02-04','20:40','20:41'],['2024-02-04','16:27','16:28'],['2100-02-04','03:00','03:01']]){
  const a=calc(date,before),b=calc(date,after);assert.notEqual(a.pillars.year.label,b.pillars.year.label);assert.notEqual(a.pillars.month.label,b.pillars.month.label);assert.equal(a.pillars.day.label,b.pillars.day.label);assert.ok(a.warnings.some(w=>w.includes('立春')));
 }
 const a=calc('2024-03-05','10:22'),b=calc('2024-03-05','10:23');assert.equal(a.pillars.month.label,'丙寅');assert.equal(b.pillars.month.label,'丁卯');assert.equal(a.pillars.year.label,b.pillars.year.label);
});
test('23:00 changes day and dependent ten gods; midnight preserves that day',()=>{
 const before=calc('2000-01-01','22:59'),night=calc('2000-01-01','23:00'),midnight=calc('2000-01-02','00:00');
 assert.notEqual(before.pillars.day.label,night.pillars.day.label);assert.equal(night.pillars.day.label,'己未');assert.equal(night.pillars.day.label,midnight.pillars.day.label);assert.equal(night.pillars.hour.label,'甲子');assert.equal(night.zishi,'夜子时');
 assert.notEqual(before.pillars.year.tenGod,night.pillars.year.tenGod);assert.equal(night.pillars.day.tenGod,'日主');
});
test('full professional fixture includes hidden ten gods, elements, nayin, growth and voids',()=>{
 const c=calculateBazi(base,now);assert.deepEqual(labels(c),['庚午','壬午','辛亥','甲午']);
 assert.deepEqual(c.professional,{taiyuan:{ganzhi:'癸酉',nayin:'剑锋金'},minggong:{ganzhi:'辛巳',nayin:'白蜡金'},shengong:{ganzhi:'己丑',nayin:'霹雳火'}});
 assert.deepEqual(c.details?.day,{wuxing:'金水',nayin:'钗钏金',growth:'沐浴',voids:'寅卯',hidden:[{gan:'壬',element:'水',tenGod:'伤官'},{gan:'甲',element:'木',tenGod:'正财'}]});
 assert.deepEqual(c.details?.year?.hidden,[{gan:'丁',element:'火',tenGod:'偏官'},{gan:'己',element:'土',tenGod:'偏印'}]);
 assert.equal(Object.values(c.elements!).reduce((a,b)=>a+b,0),8);
});
test('unknown hour withholds hour pillar, palace fields and hour-derived relations',()=>{
 const input:BaziInput={...base,time:{kind:'unknown'}},c=calculateBazi(input,now);
 assert.equal(c.pillars.hour.label,'未知');assert.equal(c.details?.hour,null);assert.equal(c.professional?.minggong,null);assert.equal(c.professional?.shengong,null);assert.ok(c.professional?.taiyuan);
 assert.equal(Object.values(c.elements!).reduce((a,b)=>a+b,0),6);assert.ok(c.warnings.some(w=>w.includes('12:00')&&w.includes('不推断')));
 assert.ok(c.relations?.every(r=>!r.positions.includes('时柱')));assert.ok(c.shensha.every(r=>!r.positions.some(p=>p.startsWith('时'))));
 const shichen=calculateBazi({...base,time:{kind:'shichen',value:'子'}},now);assert.match(shichen.timeLabel,/00:00/);assert.match(shichen.warnings.join(),/代表时刻/);
 input.date='2000-01-01';assert.equal(c.input.date,base.date);
});
test('minute-difference qiyun and precise handover include the birth year before an early start',()=>{
 const c=calculateBazi(base,now);assert.equal(c.qiyun.label,'7年4个月22天12小时');assert.equal(c.startSolar,'1997-11-07 00:30:00');
 // Known comparator difference: lunar ignores seconds in both endpoints;
 // tyme floors the elapsed seconds instead. The approved lunar rule stays frozen.
 assert.equal(calc('2000-01-01','23:00').startSolar,'2008-05-08 01:00:00');
 assert.equal(calc('1900-12-31','12:30').startSolar,'1902-12-07 10:30:00');
 assert.equal(calc('2024-12-31','12:30','女').startSolar,'2033-03-06 14:30:00');
 const early=calc('2024-02-04','16:26','女');assert.equal(early.cycles?.[0].step,'起运前');assert.deepEqual(early.cycles?.[0].annual,[{year:2024,ganzhi:'甲辰',age:1}]);
 assert.equal(currentCycleIndex(early,new Date('2024-02-04T10:25:59Z')),0);assert.equal(currentCycleIndex(early,new Date('2024-02-04T10:26:00Z')),1);
 const instant=calc('2024-02-04','16:27','女');assert.equal(instant.cycles?.[0].step,'1');assert.equal(currentCycleIndex(instant,new Date('2024-02-04T08:27:00Z')),0);
 assert.equal(currentCycleIndex(c,new Date('1980-01-01T00:00Z')),-1);assert.equal(currentCycleIndex(c,new Date('invalid')),-1);
 for(const cycle of c.cycles!){assert.equal(cycle.startAge,cycle.startYear-1990+1);assert.equal(cycle.endAge,cycle.endYear-1990+1);assert.equal(cycle.annual[0].year,cycle.startYear);assert.equal(cycle.annual.at(-1)?.year,Math.min(cycle.endYear,2100));}
 assert.equal(c.cycles![0].endDate,c.cycles![1].startDate);assert.equal(c.cycles![0].annual.at(-1)?.year,c.cycles![1].annual[0].year);
});
test('all full three-combinations and meetings match; partial combinations never become full',()=>{
 for(const [name,groups] of [['三合',['申子辰','亥卯未','寅午戌','巳酉丑']],['三会',['寅卯辰','巳午未','申酉戌','亥子丑']],['三刑',['寅巳申','丑戌未']]] as const)for(const group of groups){
  assert.equal(pillarRelations([null,null,null,null],[...group,null]).filter(r=>r.name===name).length,1);
  assert.equal(pillarRelations([null,null,null,null],[group[0],group[1],group[0],null]).filter(r=>r.name===name).length,0);
 }
 const rel=pillarRelations(['甲','己',null,null],['辰','辰','子',null]);assert.ok(rel.some(r=>r.name==='天干五合'));assert.deepEqual(rel.find(r=>r.name==='自刑')?.positions,['年柱','月柱']);
 assert.equal(pillarRelations([null,null,null,null],['辰','子',null,null]).filter(r=>r.name==='自刑').length,0);
 assert.ok(pillarRelations([null,null,null,null],['寅','巳',null,null]).some(r=>r.name==='相刑'));assert.ok(pillarRelations([null,null,null,null],['子','午','未',null]).some(r=>r.name==='地支六害'));
});
test('complete report contains every inline explanation; old reports remain byte-for-byte',()=>{
 const c=calculateBazi(base,now);for(const value of Object.values(SOLAR_TIME_NOTES))assert.ok(c.markdown.includes(value));
 for(const name of ['藏干','五行','纳音','十二长生','旬空','胎元','命宫','身宫','合冲刑害','神煞','虚岁'])assert.ok(c.markdown.includes(name));
 assert.ok(!c.markdown.includes('（小运）'));const old=legacy(base,now);assert.equal(formatBaziReport(old),old.markdown);
});
test('invalid and future input stays outside the calculation boundary',()=>{
 for(const date of ['1990-02-30','1899-12-31','2101-01-01'])assert.throws(()=>calc(date));
 assert.throws(()=>calculateBazi({...base,date:'2026-10-15'},new Date('2026-10-14T04:00Z')));assert.throws(()=>calculateBazi(base,new Date('invalid')));
 for(const time of [{kind:'clock',value:'24:00'},{kind:'shichen',value:'甲'},{kind:'wrong'}])assert.throws(()=>calculateBazi({...base,time} as BaziInput,now));
});
