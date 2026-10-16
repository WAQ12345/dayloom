import { daysInMonth, isValidDate, localDate } from './dates.ts';
import { dateString, lunarYearMonths, solarToLunar } from './bazi/civil.ts';

export type CalendarKind='solar'|'lunar';
export type DateSelection={value:string;leap:boolean};
export type MonthOption={key:string;label:string;month:number;leap:boolean;days:number[]};
const pad=(n:number)=>String(n).padStart(2,'0');
export const pickerDate=(year:number,month:number,day:number)=>`${year}-${pad(month)}-${pad(day)}`;
export function pickerMonths(year:number,calendar:CalendarKind,min:string,max:string):MonthOption[]{
 const months=calendar==='lunar'?lunarYearMonths(year):Array.from({length:12},(_,i)=>({month:i+1,leap:false,days:daysInMonth(`${year}-${pad(i+1)}`),start:0}));
 return months.map(m=>({key:`${m.month}${m.leap?'L':''}`,label:`${m.leap?'闰':''}${m.month}月`,month:m.month,leap:m.leap,
  days:Array.from({length:m.days},(_,i)=>i+1).filter(day=>{const solar=calendar==='lunar'?dateString(m.start+(day-1)*86400000):pickerDate(year,m.month,day);return solar>=min&&solar<=max;})})).filter(m=>m.days.length>0);
}
export function pickerYears(calendar:CalendarKind,min:string,max:string):number[]{
 const first=calendar==='lunar'?Math.max(1900,solarToLunar(min).year):Number(min.slice(0,4));
 const last=calendar==='lunar'?Math.min(2100,solarToLunar(max).year):Number(max.slice(0,4));
 return Array.from({length:Math.max(0,last-first+1)},(_,i)=>first+i);
}
export function normalizePickerDate(selection:DateSelection,calendar:CalendarKind,min:string,max:string):DateSelection{
 const years=pickerYears(calendar,min,max);
 const fallback=calendar==='lunar'?solarToLunar(max):null;
 const parts=/^\d{4}-\d{2}-\d{2}$/.test(selection.value)?selection.value.split('-').map(Number):[fallback?.year??Number(max.slice(0,4)),fallback?.month??Number(max.slice(5,7)),fallback?.day??Number(max.slice(8,10))];
 const year=Math.max(years[0],Math.min(years[years.length-1],parts[0]));
 const months=pickerMonths(year,calendar,min,max);
 const month=months.find(m=>m.month===parts[1]&&m.leap===selection.leap)??months.find(m=>m.month===parts[1])??months[months.length-1];
 const day=Math.max(month.days[0],Math.min(month.days[month.days.length-1],parts[2]));
 return {value:pickerDate(year,month.month,day),leap:month.leap};
}
export function dateBounds(min='1900-01-01',max=localDate()){
 if(!isValidDate(min)||!isValidDate(max)||min>max)throw new Error('日期选择范围无效');
 return {min,max};
}
