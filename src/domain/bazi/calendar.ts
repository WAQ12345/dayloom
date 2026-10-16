import { delta_t_seconds, sun_apparent_longitude, new_moon_jde, mod } from './astronomy.ts';
import { JIE_DEFS } from './tables.ts';
const DAY = 86400000;
export function bjParts(ms:number):number[]{const d=new Date(ms+8*3600000);return[d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate(),d.getUTCHours(),d.getUTCMinutes()];}
export function dateString(ms:number):string {return new Date(ms+8*3600000).toISOString().slice(0,10);}
export function bjMs(y:number,m:number,d:number,h=0,min=0):number {return Date.UTC(y,m-1,d,h-8,min);}
export function parseDate(value:string):[number,number,number] {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('日期格式应为 YYYY-MM-DD');
 const [y,m,d]=value.split('-').map(Number);if(dateString(bjMs(y,m,d))!==value)throw new Error('日期不存在');return[y,m,d];
}
export function ttToMs(jd:number):number {const year=2000+(jd-2451545)/365.242189;return(jd-delta_t_seconds(year)/86400-2440587.5)*DAY;}
const termCache=new Map<string,number>();
export function solarTermJd(year:number,longitude:number):number {
 const key=`${year}:${longitude}`;const cached=termCache.get(key);if(cached!==undefined)return cached;
 const jd0=2451545+(year-2000)*365.242189+mod(longitude-280.46646,360)/0.98564736;
 let lo=jd0-8,hi=jd0+8;
 for(let i=0;i<52;i++){const mid=(lo+hi)/2;if(mod(sun_apparent_longitude(mid)-longitude+180,360)-180<0)lo=mid;else hi=mid;}
 const result=(lo+hi)/2;if(termCache.size>4096)termCache.clear();termCache.set(key,result);return result;
}
export function solarTermBeijing(year:number,longitude:number):number {return ttToMs(solarTermJd(year,longitude));}
export function jieEvents(year:number){return[year-1,year,year+1].flatMap(y=>JIE_DEFS.map(([longitude,name,zhi])=>({time:solarTermBeijing(y,longitude),name,zhi}))).sort((a,b)=>a.time-b.time);}
export interface LunarDate {year:number;month:number;day:number;leap:boolean}
interface LunarMonth {year:number;month:number;leap:boolean;start:number;days:number}
const lunarCache=new Map<number,LunarMonth[]>();
function lastMoon(jd:number):number{let k=Math.round((jd-2451550.09766)/29.530588861);while(dateStart(ttToMs(new_moon_jde(k)))>dateStart(ttToMs(jd)))k--;while(dateStart(ttToMs(new_moon_jde(k+1)))<=dateStart(ttToMs(jd)))k++;return k;}
function dateStart(ms:number):number{const[y,m,d]=bjParts(ms);return bjMs(y,m,d);}
function lunarMonths(year:number):LunarMonth[]{
 const cached=lunarCache.get(year);if(cached)return cached;
 const k0=lastMoon(solarTermJd(year,270)),k1=lastMoon(solarTermJd(year+1,270));
 const moons=Array.from({length:k1-k0+1},(_,i)=>new_moon_jde(k0+i));
 const middle=[year-1,year,year+1].flatMap(y=>Array.from({length:12},(_,i)=>solarTermJd(y,i*30)));
 const starts=moons.map(m=>dateStart(ttToMs(m)));
 const middleDays=middle.map(z=>dateStart(ttToMs(z)));
 const n=moons.length-1;const leapIndex=n===13?starts.slice(0,-1).findIndex((m,i)=>!middleDays.some(z=>z>=m&&z<starts[i+1])):-1;
 let month=11,ly=year;const result:LunarMonth[]=[];
 for(let i=0;i<n;i++){const leap=i===leapIndex;if(i>0&&!leap){month++;if(month===13){month=1;ly=year+1;}}
  const start=dateStart(ttToMs(moons[i]));result.push({year:ly,month,leap,start,days:Math.round((dateStart(ttToMs(moons[i+1]))-start)/DAY)});}
 if(lunarCache.size>256)lunarCache.clear();lunarCache.set(year,result);return result;
}
export function solarToLunar(value:string):LunarDate {const[y,m,d]=parseDate(value);const ms=bjMs(y,m,d);for(const info of[y-2,y-1,y].flatMap(lunarMonths)){if(ms>=info.start&&ms<info.start+info.days*DAY)return{year:info.year,month:info.month,day:Math.round((ms-info.start)/DAY)+1,leap:info.leap};}throw new Error('无法转换农历');}
/** Actual months in one lunar year, including its leap month when present. */
export function lunarYearMonths(year:number):readonly LunarMonth[] {
 if(year<1900||year>2100)throw new Error('农历年份超出范围');
 return [...lunarMonths(year-1),...lunarMonths(year)].filter(m=>m.year===year).map(m=>({...m}));
}
export function lunarToSolar(value:string,leap=false):string {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('农历格式应为 YYYY-MM-DD');
 const[y,m,d]=value.split('-').map(Number);if(y<1900||y>2100||m<1||m>12||d<1||d>30)throw new Error('农历日期超出范围');
 const info=[...lunarMonths(y-1),...lunarMonths(y)].find(i=>i.year===y&&i.month===m&&i.leap===leap);
 if(!info)throw new Error(leap?'该农历年份不存在所选闰月':'无法找到该农历月份');if(d>info.days)throw new Error(`该农历月份只有 ${info.days} 天`);
 return dateString(info.start+(d-1)*DAY);
}
