import { bjMs, bjParts, parseDate } from './civil.ts';
import { delta_t_seconds, mod, sun_apparent_longitude } from './astronomy.ts';
export type TimeBasis='beijing'|'trueSolar';
export type DstChoice='standard'|'summer';
export type BirthLocation={id:string;name:string;longitude:number;source:string};
export type BirthTimeOptions={timeBasis?:TimeBasis;location?:BirthLocation;dst?:DstChoice};
export type TimeConversion={original:string;standard:string;corrected:string;basis:TimeBasis;longitude?:number;longitudeMinutes:number;equationMinutes:number;dstMinutes:number;summary:string;changes:string[]};
const rad=(x:number)=>x*Math.PI/180;
/** Meeus ch. 25 + 28: apparent right ascension, not the annual Fourier approximation.
 * Low precision solar coordinates; 1900–2100, no claim of second-level authority. */
export function equationOfTime(ms:number):number {
 const year=new Date(ms).getUTCFullYear(),jd=ms/86400000+2440587.5+delta_t_seconds(year)/86400,t=(jd-2451545)/36525;
 const omega=125.04-1934.136*t;
 const epsilon=23+(26+(21.448-46.815*t-.00059*t*t+.001813*t*t*t)/60)/60+.00256*Math.cos(rad(omega));
 const lambda=sun_apparent_longitude(jd);
 const alpha=mod(Math.atan2(Math.cos(rad(epsilon))*Math.sin(rad(lambda)),Math.cos(rad(lambda)))*180/Math.PI,360);
 const mean=mod(280.46646+36000.76983*t+.0003032*t*t,360);
 const nutation=-.00478*Math.sin(rad(omega));
 return 4*(mod(mean-.0057183-alpha+nutation*Math.cos(rad(epsilon))+180,360)-180);
}
export function chinaDstDates(year:number):{start:string;end:string}|null {
 if(year<1986||year>1991)return null;
 const sunday=(month:number)=>{const day=new Date(Date.UTC(year,month-1,11)).getUTCDay();return 11+(7-day)%7;};
 return {start:`${year}-${year===1986?'05-04':`04-${String(sunday(4)).padStart(2,'0')}`}`,end:`${year}-09-${String(sunday(9)).padStart(2,'0')}`};
}
export function needsDstConfirmation(date:string):boolean{const [year]=parseDate(date),range=chinaDstDates(year);return !!range&&date>=range.start&&date<=range.end;}
export function validateTimeOptions(value:BirthTimeOptions):void {
 if(value.timeBasis!==undefined&&!['beijing','trueSolar'].includes(value.timeBasis))throw new Error('时间口径无效');
 if(value.dst!==undefined&&!['standard','summer'].includes(value.dst))throw new Error('夏令时确认无效');
 if(value.location!==undefined){const l=value.location;if(!l||typeof l!=='object'||typeof l.id!=='string'||!l.id||l.id.length>100||typeof l.name!=='string'||!l.name||l.name.length>200||typeof l.source!=='string'||!l.source||l.source.length>200||!Number.isFinite(l.longitude)||l.longitude<73||l.longitude>135.1)throw new Error('出生地点或经度无效');}
}
const stamp=(ms:number)=>new Date(ms+8*3600000).toISOString().slice(0,16).replace('T',' ');
export function convertBirthTime(date:string,time:string,options:BirthTimeOptions):{standardMs:number;correctedMs:number;conversion:TimeConversion}{
 validateTimeOptions(options);const [y,m,d]=parseDate(date);if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('出生时间无效');
 const [h,min]=time.split(':').map(Number),raw=bjMs(y,m,d,h,min),range=chinaDstDates(y),basis=options.timeBasis??'beijing';
 // Absence of all new options is the frozen legacy Beijing convention.
 const explicit=options.timeBasis!==undefined||options.dst!==undefined;
 if(explicit&&needsDstConfirmation(date)&&!options.dst)throw new Error('请确认原始钟表是否已校正夏令时');
 let dstMinutes=0;
 if(options.dst==='summer'){
  if(!range)throw new Error('该日期不在大陆1986—1991夏令时范围');
  const start=bjMs(...parseDate(range.start),3),end=bjMs(...parseDate(range.end),2);
  if(raw<start||raw>=end)throw new Error('该钟表时刻不属于夏令时间；春季02:00—02:59不存在，结束日02:00后为标准时间');
  dstMinutes=-60;
 }
 const standardMs=raw+dstMinutes*60000;
 if(basis==='trueSolar'&&!options.location)throw new Error('请选择出生城市或区县以确定经度');
 const longitudeMinutes=basis==='trueSolar'?4*(options.location!.longitude-120):0,equationMinutes=basis==='trueSolar'?equationOfTime(standardMs):0;
 const correctedMs=standardMs+(longitudeMinutes+equationMinutes)*60000;
 const original=stamp(raw),standard=stamp(standardMs),corrected=stamp(correctedMs),changes:string[]=[];
 const a=bjParts(raw),b=bjParts(correctedMs);
 if(original.slice(0,10)!==corrected.slice(0,10))changes.push('跨公历日期');
 if(Math.floor((a[3]+1)/2)%12!==Math.floor((b[3]+1)/2)%12)changes.push('跨时辰');
 const dayKey=(ms:number)=>stamp(ms+3600000).slice(0,10);if(dayKey(raw)!==dayKey(correctedMs))changes.push('跨23点日柱边界');
 const signed=(n:number)=>`${n>=0?'+':''}${n.toFixed(2)}`;
 const summary=`原始 ${original} → ${basis==='trueSolar'?'真太阳时':'标准北京时间'} ${corrected}；${dstMinutes?'夏令时 −60分；':options.dst==='standard'?'已确认标准时间，不重复扣减；':''}${basis==='trueSolar'?`经度 ${options.location!.longitude}°（${signed(longitudeMinutes)}分）＋均时差 ${signed(equationMinutes)}分；`:''}${changes.join('、')||'未跨日期/时辰边界'}。`;
 return {standardMs,correctedMs,conversion:{original,standard,corrected,basis,longitude:options.location?.longitude,longitudeMinutes,equationMinutes,dstMinutes,summary,changes}};
}
