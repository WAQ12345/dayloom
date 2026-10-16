import { isValidDate, assertToday, todayOf } from '../domain/dates.ts';
import type { DataContext, SqlExecutor } from './sql.ts';
export type Draft<T>={key:string;date:string|null;payload:T;updatedAt:number};
export async function getDraft<T>(db:SqlExecutor,key:string):Promise<Draft<T>|null>{const row=await db.first<{key:string;date:string|null;payload:string;updated_at:number}>('SELECT * FROM drafts WHERE key=?',[key]);if(!row)return null;try{return{key:row.key,date:row.date,payload:JSON.parse(row.payload) as T,updatedAt:row.updated_at};}catch{throw new Error('草稿内容损坏，无法恢复');}}
export async function saveDraft(ctx:DataContext,key:string,date:string|null,payload:unknown):Promise<void>{
  if(!/^(meal|water|task|item|shopping|membership|fixed|settlement|bazi|ai|idea|template|collection):[A-Za-z0-9_-]{1,100}$/.test(key))throw new Error('无效草稿标识');if(['idea:editor','template:editor','collection:editor'].includes(key)&&date!==null)throw new Error('此草稿不绑定日期');if(date!==null&&!isValidDate(date))throw new Error('无效草稿日期');const raw=JSON.stringify(payload);if(!raw||raw.length>100000)throw new Error('草稿过大');
  // A draft may be flushed after midnight, but its captured date is immutable and never becomes a business record.
  await ctx.db.transaction(async tx=>{const old=await tx.first<{date:string|null}>('SELECT date FROM drafts WHERE key=?',[key]);if(old&&old.date!==date)throw new Error('草稿日期不能改变');if(!old&&date!==null&&date>todayOf(ctx.clock))assertToday(date,todayOf(ctx.clock));await tx.run('INSERT INTO drafts(key,date,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',[key,date,raw,ctx.clock.now().getTime()]);});
}
export async function deleteDraft(ctx:DataContext,key:string):Promise<void>{await ctx.db.transaction(async tx=>{await tx.run('DELETE FROM drafts WHERE key=?',[key]);});}
