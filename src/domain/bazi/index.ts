import { convertBirthTime, validateTimeOptions, type TimeConversion } from './birthTime.ts';
import { Solar, LunarUtil } from 'lunar-typescript';
import { bjParts,bjMs,dateString,parseDate,solarToLunar,lunarToSolar } from './civil.ts';
import { ZHI } from './tables.ts';
import { computeShensha } from './shensha.ts';
import { pillarRelations,type Relation } from './relations.ts';
import { NOTES,SOLAR_TIME_NOTES,EXPLANATION_VERSION } from './explanations.ts';
import type { BaziInput,BaziChart as LegacyChart,BaziPillar } from './legacy.ts';
export type { BaziInput,BaziPillar } from './legacy.ts';
export { BAZI_REFERENCE_SUMMARY,BAZI_REFERENCE_SOURCES } from './references.ts';
export { solarToLunar,lunarToSolar } from './civil.ts';
export const BAZI_ALGORITHM_VERSION='lunar-typescript-1.8.6-zhaoxi-2.1.0';
export type PillarDetail={wuxing:string;nayin:string;growth:string;voids:string;hidden:{gan:string;element:string;tenGod:string}[]};
export type Cycle={step:string;ganzhi:string;startYear:number;endYear:number;startAge:number;endAge:number;startDate:string;endDate:string;annual:{year:number;ganzhi:string;age:number}[]};
export type BaziChart=LegacyChart & {schemaVersion?:2;timeConversion?:TimeConversion;explanationNotes?:typeof NOTES;profileNickname?:string;ruleVersion?:string;explanationVersion?:string;details?:Record<'year'|'month'|'day'|'hour',PillarDetail|null>;elements?:Record<string,number>;professional?:{taiyuan:{ganzhi:string;nayin:string};minggong:{ganzhi:string;nayin:string}|null;shengong:{ganzhi:string;nayin:string}|null};relations?:Relation[];cycles?:Cycle[];startSolar?:string;qiyunDays?:number;};
export function calculateBazi(input:BaziInput,now=new Date()):BaziChart {
 if(!input||!['solar','lunar'].includes(input.calendar)||!['男','女'].includes(input.sex))throw new Error('请选择历法与排盘性别');
 if(!Number.isFinite(now.getTime()))throw new Error('当前时间无效');
 if(input.place!==undefined&&(typeof input.place!=='string'||input.place.length>200))throw new Error('出生地不能超过 200 字');
 if(input.leapMonth!==undefined&&typeof input.leapMonth!=='boolean')throw new Error('闰月标记无效');
 const solar=input.calendar==='lunar'?lunarToSolar(input.date,!!input.leapMonth):input.date;
 const [y,m,d]=parseDate(solar);if(y<1900||y>2100)throw new Error('支持的公历范围为 1900—2100 年');
 if(solar>dateString(now.getTime()))throw new Error('出生日期不能晚于今天');
 let h=12,min=0;const warnings:string[]=[];
 if(input.time?.kind==='clock'){
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time.value))throw new Error('出生时间无效');[h,min]=input.time.value.split(':').map(Number);
 }else if(input.time?.kind==='shichen'){
  if(input.time.value.length!==1||!ZHI.includes(input.time.value))throw new Error('时辰无效');h=ZHI.indexOf(input.time.value)*2;
  warnings.push('仅提供时辰，以该时辰代表时刻暂算起运；子时采用当日 00:00。');
 }else if(input.time?.kind==='unknown')warnings.push('时辰未知；年/月节气及起运以当日 12:00 暂算，不推断时柱、命宫或身宫。');
 else throw new Error('请选择出生时间方式');
 validateTimeOptions(input);
 if(input.timeBasis==='trueSolar'&&input.time.kind!=='unknown'&&!input.location)throw new Error('请选择出生城市或区县以确定经度');
 if(input.timeBasis==='trueSolar'&&input.time.kind==='shichen')throw new Error('仅知道时辰无法精确换算真太阳时，请补充具体时间或选择北京时间');
 const unknown=input.time.kind==='unknown';
 const converted=input.time.kind==='clock'?convertBirthTime(solar,input.time.value,input):null;
 const standardParts=converted?bjParts(converted.standardMs):[y,m,d,h,min];
 const correctedParts=converted?bjParts(Math.floor(converted.correctedMs/1000)*1000):standardParts;
 const makeSolar=(p:number[])=>Solar.fromYmdHms(p[0],p[1],p[2],p[3],p[4],converted?new Date(converted.correctedMs+8*3600000).getUTCSeconds():0);
 const birth=Solar.fromYmdHms(standardParts[0],standardParts[1],standardParts[2],standardParts[3],standardParts[4],0),l=birth.getLunar(),absoluteEight=l.getEightChar();absoluteEight.setSect(1);
 const eight=makeSolar(correctedParts).getLunar().getEightChar();eight.setSect(1);
 if(unknown&&input.timeBasis==='trueSolar')warnings.push('时间未知：真太阳时待具体时间确定后换算，当前不生成校正分钟或时柱。');
 const yearGz=absoluteEight.getYear(),monthGz=absoluteEight.getMonth(),dayGz=eight.getDay(),hourGz=unknown?null:eight.getTime();
 if(converted?.conversion.basis==='trueSolar'){const minute=correctedParts[3]*60+correctedParts[4];const edge=Math.min(...Array.from({length:13},(_,i)=>Math.abs(minute-(i*120+60))));if(edge<=5)warnings.push('换算时间接近时辰边界，请核对出生时间和地点。');}
 const palace=(body:boolean)=>{let offset=LunarUtil.MONTH_ZHI.indexOf(monthGz[1])+(body?LunarUtil.ZHI:LunarUtil.MONTH_ZHI).indexOf(hourGz![1]);offset=body?(offset>12?offset-12:offset):(offset>=14?26:14)-offset;let gan=(LunarUtil.GAN.indexOf(yearGz[0]))*2+offset;while(gan>10)gan-=10;const ganzhi=LunarUtil.GAN[gan]+LunarUtil.MONTH_ZHI[offset];return {ganzhi,nayin:LunarUtil.NAYIN[ganzhi]};};
 const gods=(value:string)=>value==='七杀'?'偏官':value;
 const getPillar=(value:string|null,isDay=false):BaziPillar=>value?{gan:value[0],zhi:value[1],label:value,tenGod:isDay?'日主':gods(LunarUtil.SHI_SHEN[dayGz[0]+value[0]]),hiddenStems:LunarUtil.ZHI_HIDE_GAN[value[1]].map(g=>g+LunarUtil.WU_XING_GAN[g]).join('、')}:{gan:'未知',zhi:'未知',label:'未知',tenGod:'未知',hiddenStems:'未知'};
 const pillars={year:getPillar(yearGz),month:getPillar(monthGz),day:getPillar(dayGz,true),hour:getPillar(hourGz)};
 const detail=(gz:string|null,growth:string,voids:string):PillarDetail|null=>gz?{wuxing:LunarUtil.WU_XING_GAN[gz[0]]+LunarUtil.WU_XING_ZHI[gz[1]],nayin:LunarUtil.NAYIN[gz],growth,voids,hidden:LunarUtil.ZHI_HIDE_GAN[gz[1]].map(g=>({gan:g,element:LunarUtil.WU_XING_GAN[g],tenGod:gods(LunarUtil.SHI_SHEN[dayGz[0]+g])}))}:null;
 const details={year:detail(yearGz,eight.getDiShi(ZHI.indexOf(yearGz[1])),absoluteEight.getYearXunKong()),month:detail(monthGz,eight.getDiShi(ZHI.indexOf(monthGz[1])),absoluteEight.getMonthXunKong()),day:detail(dayGz,eight.getDayDiShi(),eight.getDayXunKong()),hour:detail(hourGz,eight.getTimeDiShi(),eight.getTimeXunKong())};
 const elements:Record<string,number>={木:0,火:0,土:0,金:0,水:0};for(const p of Object.values(details))if(p)for(const element of p.wuxing)elements[element]++;
 const yun=absoluteEight.getYun(input.sex==='男'?1:0,2),start=yun.getStartSolar();
 // A precise ten-year interval can cover parts of eleven calendar years.
 // Do not use DaYun.getLiuNian for index 0: it drops the birth year when
 // the first handover occurs within that same year.
 const cycles:Cycle[]=yun.getDaYun(13).map((dy,i)=>{
  const first=i===0?birth:start.nextYear((i-1)*10),end=i===0?start:start.nextYear(i*10);
  const startYear=first.getYear(),endYear=end.toYmdHms().endsWith('01-01 00:00:00')?end.getYear()-1:end.getYear();
  const annual=Array.from({length:Math.max(0,Math.min(endYear,2100)-startYear+1)},(_,n)=>{
   const year=startYear+n;
   return {year,ganzhi:Solar.fromYmd(year,7,1).getLunar().getYearInGanZhiExact(),age:year-y+1};
  });
  return {step:i===0?'起运前':String(i),ganzhi:i===0?'—':dy.getGanZhi(),startYear,endYear,startAge:startYear-y+1,endAge:endYear-y+1,startDate:first.toYmdHms(),endDate:end.toYmdHms(),annual};
 }).filter(c=>c.startDate<c.endDate&&c.startYear<=2100);
 const before=l.getPrevJie(),after=l.getNextJie();
 for(const term of [before,after]){const s=term.getSolar(),delta=Math.abs((converted?.standardMs??bjMs(y,m,d,h,min))-bjMs(s.getYear(),s.getMonth(),s.getDay(),s.getHour(),s.getMinute()));if(delta<=86400000){warnings.push(`接近${term.getName()}交界（${s.toYmdHms()} 北京时间），请核对出生时间；不确定时刻可能改变月柱或年柱。`);}}
 const lunarDate=solarToLunar(solar),currentYear=bjParts(now.getTime())[0];
 const qiyun={years:yun.getStartYear(),months:yun.getStartMonth(),label:`${yun.getStartYear()}年${yun.getStartMonth()}个月${yun.getStartDay()}天${yun.getStartHour()}小时`};
 const chart:BaziChart={schemaVersion:2,algorithmVersion:BAZI_ALGORITHM_VERSION,ruleVersion:'dual-clock-23h-yun2-eot-meeus1-dst1',timeConversion:converted?.conversion,explanationVersion:EXPLANATION_VERSION+'-solar1',explanationNotes:{...SOLAR_TIME_NOTES},input:JSON.parse(JSON.stringify(input)),solarDate:solar,lunarDate,lunarLabel:`${Solar.fromYmd(y,m,d).getLunar().getYear()}年${Solar.fromYmd(y,m,d).getLunar().getMonthInChinese()}月${Solar.fromYmd(y,m,d).getLunar().getDayInChinese()}`,
 timeLabel:input.time.kind==='unknown'?'未知':input.time.kind==='clock'?`${input.time.value}（原始钟表）${converted?.conversion.basis==='trueSolar'?` · 校正后${ZHI[Math.floor((correctedParts[3]+1)/2)%12]}时`:''}`:`${input.time.value}时（代表时刻 ${String(h).padStart(2,'0')}:00）`,zishi:correctedParts[3]===23?'夜子时':correctedParts[3]===0?'早子时':'无',solarYear:y,yearNumber:yearGz===Solar.fromYmdHms(y,7,1,12,0,0).getLunar().getYearInGanZhiExact()?y:y-1,jieName:before.getName(),hourUnknown:unknown,pillars,details,elements,
 forward:yun.isForward(),qiyun,qiyunDays:yun.getStartDay(),startSolar:start.toYmdHms(),cycles,dayun:cycles.map(c=>({step:c.step,age:`${c.startAge}—${c.endAge}虚岁`,ganzhi:c.ganzhi})),annual:[...new Map(cycles.flatMap(c=>c.annual).map(a=>[a.year,a])).values()],currentYear,currentGanzhi:Solar.fromYmd(currentYear,7,1).getLunar().getYearInGanZhiExact(),
 professional:{taiyuan:{ganzhi:absoluteEight.getTaiYuan(),nayin:absoluteEight.getTaiYuanNaYin()},minggong:unknown?null:palace(false),shengong:unknown?null:palace(true)},
 relations:pillarRelations([yearGz[0],monthGz[0],dayGz[0],hourGz?.[0]??null],[yearGz[1],monthGz[1],dayGz[1],hourGz?.[1]??null]),shensha:computeShensha([yearGz[0],monthGz[0],dayGz[0],hourGz?.[0]??null],[yearGz[1],monthGz[1],dayGz[1],hourGz?.[1]??null],input.sex),warnings,
 calculationNotes:'北京时间 UTC+8；立春分年、十二节分月；23:00 换日（sect=1）；起运按分钟差换算（sect=2），大运年龄按虚岁。出生至起运的时间不是小运。年月柱、节气与起运按标准北京时间对应绝对瞬间；日时柱、命身宫按所选时钟；真太阳时=标准北京时间+4×(经度−120°)+当时均时差。原始钟表已校正夏令时则不重复扣减；未知或时辰时间仅暂算。均时差为1900—2100低精度天文算法，不宣称秒级权威；地点是市县代表点（坐标系未注明、历史地名），不等于出生建筑精确经度。1900—2100指输入公历日期，校正内部可进入相邻年一天；出生年与虚岁保留原始日期口径。历法范围1900—2100，未完成全范围权威逐时核对。传统文化参考。',markdown:''};
 chart.markdown=formatBaziReport(chart);return chart;
}
export function currentCycleIndex(c:BaziChart,now:Date):number {
 if(!c.cycles||!Number.isFinite(now.getTime()))return -1;const [y,m,d,h,min]=bjParts(now.getTime());const stamp=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')} ${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00`;
 return c.cycles.findIndex(x=>stamp>=x.startDate&&stamp<x.endDate);
}
const clean=(s:string)=>s.replace(/[|\r\n]/g,' ');
export function formatBaziReport(c:BaziChart):string {
 if(c.schemaVersion!==2)return c.markdown; // Frozen legacy prose must never gain current fields.
 const notes=c.explanationNotes??NOTES;
 const keys=['year','month','day','hour'] as const,p=keys.map(k=>c.pillars[k]);
 const lines=['## 出生资料',...(c.profileNickname?[`昵称：${clean(c.profileNickname)}`]:[]),`公历：${c.solarDate} · 农历：${c.lunarLabel}`,`时间：${c.timeLabel} · 性别：${c.input.sex}`,...(c.timeConversion?[c.timeConversion.summary]:[]),...(c.input.place?[`出生地：${clean(c.input.place)}`]:[]),...c.warnings.map(w=>`提示：${w}`),notes.birth,'## 四柱','| 项目 | 年柱 | 月柱 | 日柱 | 时柱 |','|---|---|---|---|---|',...(['gan','zhi','tenGod'] as const).map((k,i)=>`| ${['天干','地支','十神'][i]} | ${p.map(x=>x[k]).join(' | ')} |`),notes.pillars,'## 四柱详项'];
 for(const k of keys){const d=c.details?.[k];lines.push(`### ${['年柱','月柱','日柱','时柱'][keys.indexOf(k)]}`,d?`藏干：${d.hidden.map(h=>`${h.gan}${h.element}（${h.tenGod}）`).join('、')}；五行：${d.wuxing}；纳音：${d.nayin}；十二长生：${d.growth}；旬空：${d.voids}`:'未记录或时辰未知');}
 if(c.elements)lines.push(`表层五行：${Object.entries(c.elements).map(([k,v])=>`${k} ${v}`).join(' · ')}${c.hourUnknown?'（仅统计已知六字）':''}`);lines.push(notes.details,'## 大运与流年',`起运：出生后 ${c.qiyun.label}；${c.forward?'顺排':'逆排'}；交运：${c.startSolar??'旧命盘未记录'}${c.input.time.kind!=='clock'?'（暂算）':''}`);
 for(const cycle of c.cycles??[]){lines.push(`### ${cycle.step==='起运前'?'起运前':`第${cycle.step}步 ${cycle.ganzhi}`} · ${cycle.startYear}—${cycle.endYear} · ${cycle.startAge}—${cycle.endAge}虚岁`,`交运区间：${cycle.startDate} 至 ${cycle.endDate}（结束时刻不含）`,'| 流年 | 干支 | 虚岁 |','|---|---|---|',...cycle.annual.map(a=>`| ${a.year} | ${a.ganzhi} | ${a.age} |`));}
 lines.push(notes.cycles,'## 专业资料');for(const [key,label] of [['taiyuan','胎元'],['minggong','命宫'],['shengong','身宫']] as const){const p=c.professional?.[key];lines.push(`${label}：${p?`${p.ganzhi} · ${p.nayin}`:'未知或未记录'}`);}
 lines.push(notes.professional,'## 合冲刑害',...(c.relations?.length?c.relations.map(r=>`${r.name}：${r.symbols} · ${r.positions.join('、')} · ${r.rule}`):['未命中已收录关系']),notes.relations,'## 神煞',...(c.shensha.length?c.shensha.map(s=>`${s.name}：${s.positions.join('、')} · ${s.method}`):['未命中已收录神煞']),notes.shensha,'## 排盘口径',c.calculationNotes,notes.rules,`算法版本：${c.algorithmVersion}`,`规则版本：${c.ruleVersion??'旧版'}`,`释义版本：${c.explanationVersion??'旧版'}`);
 return lines.join('\n');
}
