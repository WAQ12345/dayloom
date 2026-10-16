/** Offline Beijing-time port of bazi-skill. Copyright 2025 jinchenma94, MIT. */
import { jdn,mod } from './astronomy.ts';
import { bjMs,bjParts,dateString,parseDate,jieEvents,solarTermBeijing,solarToLunar,lunarToSolar,type LunarDate } from './calendar.ts';
import { GAN,ZHI,CANGGAN,SHISHEN_SAME,SHISHEN_DIFF,LUNAR_MONTH_NAMES,LUNAR_DAY_NAMES } from './tables.ts';
import { computeShensha,type Shensha } from './shensha.ts';
export { BAZI_REFERENCE_SUMMARY,BAZI_REFERENCE_SOURCES } from './references.ts';
export { lunarToSolar,solarToLunar } from './calendar.ts';
export const BAZI_ALGORITHM_VERSION='bazi-skill-meeus-ts-1.1.0-civil-lunar';
export interface BaziInput {
 calendar:'solar'|'lunar';date:string;leapMonth?:boolean;
 time:{kind:'clock';value:string}|{kind:'shichen';value:string}|{kind:'unknown'};
 sex:'男'|'女';place?:string;timeBasis?:import('./birthTime.ts').TimeBasis;location?:import('./birthTime.ts').BirthLocation;dst?:import('./birthTime.ts').DstChoice;
}
export interface BaziPillar {gan:string;zhi:string;tenGod:string;hiddenStems:string;label:string}
export interface BaziChart {
 algorithmVersion:string;input:BaziInput;solarDate:string;lunarDate:LunarDate;lunarLabel:string;
 timeLabel:string;zishi:string;solarYear:number;yearNumber:number;jieName:string;hourUnknown:boolean;
 pillars:Record<'year'|'month'|'day'|'hour',BaziPillar>;
 forward:boolean;qiyun:{years:number;months:number;label:string};
 dayun:{step:string;age:string;ganzhi:string}[];
 annual:{year:number;ganzhi:string}[];currentYear:number;currentGanzhi:string;
 shensha:Shensha[];warnings:string[];calculationNotes:string;markdown:string;
}
const DAY=86400000;
const gz=(i:number):[string,string]=>[GAN[mod(i,10)],ZHI[mod(i,12)]];
const annualGz=(y:number)=>gz(mod(y-4,60)).join('');
function tenGod(day:number,other:number):string{const rel=mod(Math.floor(other/2)-Math.floor(day/2),5);return(day%2===other%2?SHISHEN_SAME:SHISHEN_DIFF)[rel];}
function pillar(g:string,z:string,dg:string,day=false):BaziPillar{return{gan:g,zhi:z,tenGod:day?'—':tenGod(GAN.indexOf(dg),GAN.indexOf(g)),hiddenStems:CANGGAN[z].map(([s,w])=>s+w).join('、'),label:g+z};}
function pythonRound(n:number):number{const floor=Math.floor(n);return n-floor===0.5?(floor%2===0?floor:floor+1):Math.round(n);}
/** now is injectable for reproducible tests and birth-date validation. It is viewed in UTC+8. */
export function calculateBazi(input:BaziInput,now:Date=new Date()):BaziChart {
 if(!input||!['solar','lunar'].includes(input.calendar))throw new Error('请选择公历或农历');
 if(!['男','女'].includes(input.sex))throw new Error('请选择排盘性别');
 if(!Number.isFinite(now.getTime()))throw new Error('当前时间无效');
 if(input.place!==undefined&&(typeof input.place!=='string'||input.place.length>200))throw new Error('出生地不能超过 200 字');
 if(!input.time||!['clock','shichen','unknown'].includes(input.time.kind))throw new Error('请选择时间方式');
 if(input.leapMonth!==undefined&&typeof input.leapMonth!=='boolean')throw new Error('闰月标记无效');
 const solar=input.calendar==='lunar'?lunarToSolar(input.date,!!input.leapMonth):input.date;
 const[y,m,d]=parseDate(solar);if(y<1900||y>2100)throw new Error('支持的公历范围为 1900—2100 年');
 if(solar>dateString(now.getTime()))throw new Error('出生日期不能晚于今天');
 let hour=12,minute=0,shichen:string|null=null;const warnings:string[]=[];
 if(input.time.kind==='clock'){
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time.value))throw new Error('时间格式应为 HH:MM');
  [hour,minute]=input.time.value.split(':').map(Number);shichen=ZHI[Math.floor((hour+1)/2)%12];
 }else if(input.time.kind==='shichen'){
  if(input.time.value.length!==1||!ZHI.includes(input.time.value))throw new Error('时辰无效');
  shichen=input.time.value;hour=ZHI.indexOf(shichen)*2;
 }else warnings.push('时辰未知；节气与起运以当日 12:00 暂算，时柱不推断');
 const birth=bjMs(y,m,d,hour,minute),lichun=solarTermBeijing(y,315),yearNumber=birth>=lichun?y:y-1;
 const[yg,yz]=gz(yearNumber-4),events=jieEvents(y),nextIndex=events.findIndex(e=>e.time>birth);
 if(nextIndex<1)throw new Error('无法定位出生节气');
 const prev=events[nextIndex-1],next=events[nextIndex];
 const mz=ZHI[prev.zhi],mg=GAN[mod((GAN.indexOf(yg)%5)*2+2+mod(prev.zhi-2,12),10)];
 let dayUsed=bjMs(y,m,d),zishi='无';
 if(input.time.kind==='clock'&&hour>=23){dayUsed+=DAY;zishi='夜子时';}
 else if(input.time.kind==='clock'&&hour===0)zishi='早子时';
 else if(input.time.kind==='shichen'&&shichen==='子'){zishi='早子时';warnings.push('未提供具体时刻，子时按早子时（当日日柱）处理');}
 const[dy,dm,dd]=bjParts(dayUsed),[dg,dz]=gz(jdn(dy,dm,dd)+49);
 const hz=shichen,hg=hz?GAN[mod((GAN.indexOf(dg)%5)*2+ZHI.indexOf(hz),10)]:null;
 const pillars={year:pillar(yg,yz,dg),month:pillar(mg,mz,dg),day:pillar(dg,dz,dg,true),hour:hg&&hz?pillar(hg,hz,dg):{gan:'未知',zhi:'未知',tenGod:'未知',hiddenStems:'未知',label:'未知'}};
 const forward=(GAN.indexOf(yg)%2===0)===(input.sex==='男');
 const days=Math.abs((forward?next.time:prev.time)-birth)/DAY,whole=Math.floor(days);
 let years=Math.floor(whole/3),months=(whole%3)*4+pythonRound((days-whole)*4);years+=Math.floor(months/12);months%=12;
 const qiyun={years,months,label:`${years}岁${months?`${months}个月`:''}`};
 const dayun:BaziChart['dayun']=[];if(years||months)dayun.push({step:'起运前',age:`0岁-${qiyun.label}`,ganzhi:mg+mz+'（小运）'});
 for(let n=1;n<=8;n++){const delta=(forward?1:-1)*n;dayun.push({step:String(n),age:`${years+(n-1)*10}-${years+(n-1)*10+9}岁`,ganzhi:GAN[mod(GAN.indexOf(mg)+delta,10)]+ZHI[mod(ZHI.indexOf(mz)+delta,12)]});}
 if(Math.abs(birth-next.time)<=DAY||Math.abs(birth-prev.time)<=DAY)warnings.push('节气交界：采用本地近似节气时刻，边界附近请核对精确出生时间');
 if(Math.abs(birth-lichun)<=DAY)warnings.push('立春前后');
 if(input.place&&input.time.kind==='clock'&&Array.from({length:12},(_,i)=>60+120*i).some(t=>Math.abs(hour*60+minute-t)<=15))warnings.push('校正后可能跨时辰；本次未进行真太阳时校正');
 const lunarDate=solarToLunar(solar),lunarLabel=`${lunarDate.year}年${lunarDate.leap?'闰':''}${LUNAR_MONTH_NAMES[lunarDate.month]}${LUNAR_DAY_NAMES[lunarDate.day]}`;
 const currentYear=bjParts(now.getTime())[0],annual=Array.from({length:currentYear-y+1},(_,i)=>({year:y+i,ganzhi:annualGz(y+i)}));
 const chart:BaziChart={algorithmVersion:BAZI_ALGORITHM_VERSION,input:JSON.parse(JSON.stringify(input)),solarDate:solar,lunarDate,lunarLabel,
 timeLabel:input.time.kind==='clock'?`${shichen} / ${input.time.value}`:shichen??'未知',zishi,solarYear:y,yearNumber,jieName:prev.name,hourUnknown:shichen===null,pillars,forward,qiyun,dayun,annual,currentYear,currentGanzhi:annualGz(currentYear),
 shensha:computeShensha([yg,mg,dg,hg],[yz,mz,dz,hz],input.sex),warnings,
 calculationNotes:'北京时间 UTC+8；23:00 起用次日日柱；时辰采用中点。沿用原项目 Meeus 近似算法，节气可有十余分钟偏差，不是权威历书；未作夏令时或真太阳时校正。传统文化参考，不是科学预测。',markdown:''};
 chart.markdown=formatBaziReport(chart);return chart;
}
const safe=(s:string)=>s.replace(/[|\r\n]/g,' ');
export function formatBaziReport(c:BaziChart):string {
 const p=[c.pillars.year,c.pillars.month,c.pillars.day,c.pillars.hour];
 return['## 输入',`- 阳历：${c.solarDate}`,`- 农历：${c.lunarLabel}`,`- 时辰：${c.timeLabel}`,`- 性别：${c.input.sex}`,...(c.input.place?[`- 出生地：${safe(c.input.place)}`]:[]),`- 子时：${c.zishi}`,'','## 四柱','| | 年柱 | 月柱 | 日柱 | 时柱 |','|---|---|---|---|---|',
 ...([['天干','gan'],['地支','zhi'],['十神','tenGod'],['藏干','hiddenStems']] as const).map(([label,key])=>`| ${label} | ${p.map(v=>v[key]).join(' | ')} |`),'','## 大运',`- 方向：${c.forward?'顺排':'逆排'}`,`- 起运：${c.qiyun.label}`,'| 步 | 年龄 | 干支 |','|---|---|---|',...c.dayun.map(r=>`| ${r.step} | ${r.age} | ${r.ganzhi} |`),'','## 流年',`当前年份：${c.currentYear} ${c.currentGanzhi}`,'| 年份 | 干支 |','|---|---|',...c.annual.map(r=>`| ${r.year} | ${r.ganzhi} |`),'','## 神煞',...(c.shensha.length?c.shensha.map(s=>`- ${s.name} — 见于${s.positions.join('、')} — ${s.method}`):['未命中已收录项目']),'','## 警告',...c.warnings.map(w=>`- ${w}`),`- ${c.calculationNotes}`,`- 算法版本：${c.algorithmVersion}`].join('\n');
}
