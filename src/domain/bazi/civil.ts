import { Solar, Lunar, LunarYear } from 'lunar-typescript';
// Keep the active civil calendar independent of the frozen legacy astronomy.
export function bjParts(ms:number):number[]{const d=new Date(ms+8*3600000);return[d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate(),d.getUTCHours(),d.getUTCMinutes()];}
export function dateString(ms:number):string{return new Date(ms+8*3600000).toISOString().slice(0,10);}
export function bjMs(y:number,m:number,d:number,h=0,min=0):number{return Date.UTC(y,m-1,d,h-8,min);}
export function parseDate(value:string):[number,number,number]{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('日期格式应为 YYYY-MM-DD');
 const [y,m,d]=value.split('-').map(Number);if(dateString(bjMs(y,m,d))!==value)throw new Error('日期不存在');return[y,m,d];
}
export type LunarDate={year:number;month:number;day:number;leap:boolean};
export function solarToLunar(value:string):LunarDate {
 const [y,m,d]=parseDate(value),l=Solar.fromYmd(y,m,d).getLunar();
 return {year:l.getYear(),month:Math.abs(l.getMonth()),day:l.getDay(),leap:l.getMonth()<0};
}
export function lunarYearMonths(year:number){
 if(!Number.isInteger(year)||year<1900||year>2100)throw new Error('农历年份超出范围');
 return LunarYear.fromYear(year).getMonths().filter(m=>m.getYear()===year).map(m=>{
  const s=Lunar.fromYmd(year,m.getMonth(),1).getSolar();
  return {year,month:Math.abs(m.getMonth()),leap:m.getMonth()<0,days:m.getDayCount(),start:bjMs(s.getYear(),s.getMonth(),s.getDay())};
 });
}
export function lunarToSolar(value:string,leap=false):string {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('农历格式应为 YYYY-MM-DD');
 const [y,m,d]=value.split('-').map(Number),info=lunarYearMonths(y).find(x=>x.month===m&&x.leap===leap);
 if(!info)throw new Error('所选月份或闰月不存在');
 if(d<1||d>info.days)throw new Error(`该农历月份只有 ${info.days} 天`);
 const solar=Lunar.fromYmd(y,leap?-m:m,d).getSolar().toYmd();
 if(solar<'1900-01-01'||solar>'2100-12-31')throw new Error('换算后公历超出支持范围');return solar;
}
