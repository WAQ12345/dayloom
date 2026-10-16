/** Optional development comparison. tyme4ts is never an application dependency.
 * Install only into the ignored comparator directory described in bazi/README.md.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { calculateBazi } from '../src/domain/bazi/index.ts';
import { Solar } from 'lunar-typescript';
import { calculateBazi as calculateLegacy } from '../src/domain/bazi/legacy.ts';
import { solarTermBeijing } from '../src/domain/bazi/calendar.ts';
const require=createRequire(import.meta.url);
const {SolarTime,ChildLimit,LunarSect2ChildLimitProvider,SolarTerm}=require('../artifacts/bazi-118/comparator/node_modules/tyme4ts');
const {version}=require('../artifacts/bazi-118/comparator/node_modules/tyme4ts/package.json');
if(version!=='1.5.3')throw new Error(`Expected comparator tyme4ts1.5.3, got ${version}`);
ChildLimit.provider=new LunarSect2ChildLimitProvider();
const pad=n=>String(n).padStart(2,'0');
const stamp=t=>`${t.getYear()}-${pad(t.getMonth())}-${pad(t.getDay())} ${pad(t.getHour())}:${pad(t.getMinute())}:${pad(t.getSecond())}`;
const samples=[];
for(const year of [1900,1950,1990,2000,2024,2033,2050,2100])for(const date of [`${year}-01-01`,`${year}-06-15`,`${year}-12-31`])for(const time of ['00:00','12:30','22:59','23:00'])for(const sex of ['男','女'])samples.push({date,time,sex});
for(const [date,time] of [['1900-02-04','13:51'],['1900-02-04','13:52'],['2000-02-04','20:40'],['2000-02-04','20:41'],['2024-02-04','16:27'],['2024-02-04','16:28'],['2024-03-05','10:22'],['2024-03-05','10:23'],['2100-02-04','03:00'],['2100-02-04','03:01']])for(const sex of ['男','女'])samples.push({date,time,sex});
const rows=samples.map(({date,time,sex})=>{
 const input={calendar:'solar',date,time:{kind:'clock',value:time},sex};
 const c=calculateBazi(input,new Date('2101-01-01T00:00:00Z')),s=SolarTime.fromYmdHms(...date.split('-').map(Number),...time.split(':').map(Number),0),hour=s.getLunarHour(),e=hour.getEightChar(),cl=ChildLimit.fromSolarTime(s,sex==='男'?1:0);
 const lunar={pillars:Object.values(c.pillars).map(p=>p.label),professional:Object.values(c.professional).map(v=>v.ganzhi),lunarDate:c.lunarDate,startSolar:c.startSolar,forward:c.forward};
 const tyme={pillars:[e.getYear(),e.getMonth(),e.getDay(),e.getHour()].map(p=>p.getName()),professional:[e.getFetalOrigin(),e.getOwnSign(),e.getBodySign()].map(p=>p.getName()),lunarDate:{year:hour.getYear(),month:Math.abs(hour.getMonth()),day:hour.getDay(),leap:hour.getMonth()<0},startSolar:stamp(cl.getEndTime()),forward:cl.isForward()};
 return{date,time,sex,differences:Object.keys(lunar).filter(key=>JSON.stringify(lunar[key])!==JSON.stringify(tyme[key])),lunar,tyme};
});
const terms=[1900,2000,2024,2100].flatMap(year=>['立春','惊蛰'].map(name=>({year,name,lunar:Solar.fromYmd(year,7,1).getLunar().getJieQiTable()[name].toYmdHms(),tyme:stamp(SolarTerm.fromName(year,name).getJulianDay().getSolarTime())})));
const summary={samples:rows.length,pillarsMismatch:rows.filter(r=>r.differences.includes('pillars')).length,professionalMismatch:rows.filter(r=>r.differences.includes('professional')).length,civilMismatch:rows.filter(r=>r.differences.includes('lunarDate')).length,forwardMismatch:rows.filter(r=>r.differences.includes('forward')).length,qiyunMismatch:rows.filter(r=>r.differences.includes('startSolar')).length};
const originalFixtures=JSON.parse(/const fixtures = (\[[\s\S]*?\n\]);/.exec(readFileSync(new URL('../tests/bazi.test.ts',import.meta.url),'utf8'))[1]);
const legacySamples=originalFixtures.map(f=>({date:f.date,time:f.clock,sex:f.sex}));
const fixedOldBoundary=['02:56','02:57','02:58','02:59','03:00','03:01','03:02','03:03'].map(time=>({date:'2100-02-04',time,sex:'女'}));
const legacyRows=[...legacySamples,...fixedOldBoundary].map(({date,time,sex},i)=>{
 const input={calendar:'solar',date,time:time?{kind:'clock',value:time}:{kind:'unknown'},sex},now=new Date('2101-01-01T00:00:00Z');
 const a=calculateLegacy(input,now),b=calculateBazi(input,now);
 const old={pillars:Object.values(a.pillars).map(p=>p.label),qiyun:a.qiyun,dayun:a.dayun.slice(0,2),dayGod:a.pillars.day.tenGod};
 const current={pillars:Object.values(b.pillars).map(p=>p.label),qiyun:b.qiyun,startSolar:b.startSolar,dayun:b.dayun.slice(0,2),dayGod:b.pillars.day.tenGod};
 return{date,time,sex,source:i<originalFixtures.length?'original-fixture':'fixed-boundary',pillarDifferences:old.pillars.flatMap((v,k)=>v===current.pillars[k]?[]:[['year','month','day','hour'][k]]),old,current};
});
const oldComparison={fixtureCount:originalFixtures.length,fixturePillarsMismatch:legacyRows.filter(r=>r.source==='original-fixture'&&r.pillarDifferences.length).length,boundaryCount:fixedOldBoundary.length,boundaryPillarsMismatch:legacyRows.filter(r=>r.source==='fixed-boundary'&&r.pillarDifferences.length).length,oldLichun2100:new Date(solarTermBeijing(2100,315)+8*3600000).toISOString().replace('T',' ').replace('Z',''),newLichun2100:terms.find(t=>t.year===2100&&t.name==='立春').lunar,rows:legacyRows};
mkdirSync('artifacts/bazi-118',{recursive:true});writeFileSync('artifacts/bazi-118/comparison.json',JSON.stringify({versions:{lunar:'1.8.6',tyme:version},summary,terms,rows,oldComparison},null,2)+'\n');console.log(JSON.stringify({summary,oldComparison:{...oldComparison,rows:undefined}}));
if(summary.pillarsMismatch||summary.professionalMismatch||summary.civilMismatch||summary.forwardMismatch)process.exitCode=1;
