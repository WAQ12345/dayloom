import { validateTemplate, type TaskTemplate, type TemplateInput } from '../domain/templates.ts';
import { assertToday, todayOf } from '../domain/dates.ts';
import type { Task } from '../domain/types.ts';
import { newId, type DataContext, type SqlExecutor } from './sql.ts';
type Row={id:string;name:string;note:string;order_level:1|2|3;created_at:number;updated_at:number};
const convert=(r:Row):TaskTemplate=>({id:r.id,name:r.name,note:r.note,orderLevel:r.order_level,createdAt:r.created_at,updatedAt:r.updated_at});
export async function listTemplates(db:SqlExecutor,{query='',limit=50,offset=0}:{query?:string;limit?:number;offset?:number}={}):Promise<TaskTemplate[]>{
 if(typeof query!=='string'||query.length>100000||!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)throw new Error('模板查询无效');
 const text=query.trim();return(await db.all<Row>('SELECT * FROM task_templates WHERE instr(name,?)>0 OR instr(note,?)>0 ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',[text,text,limit,offset])).map(convert);
}
export async function getTemplate(db:SqlExecutor,id:string):Promise<TaskTemplate|null>{const r=await db.first<Row>('SELECT * FROM task_templates WHERE id=?',[id]);return r?convert(r):null;}
async function consumeDraft(tx:SqlExecutor,consume?:boolean){if(consume)await tx.run('DELETE FROM drafts WHERE key=?',['template:editor']);}
export async function createTemplate(ctx:DataContext,input:TemplateInput,opts?:{consumeDraft?:boolean}):Promise<TaskTemplate>{const value=validateTemplate(input);return ctx.db.transaction(async tx=>{const now=ctx.clock.now().getTime(),id=newId('template');await tx.run('INSERT INTO task_templates VALUES(?,?,?,?,?,?)',[id,value.name,value.note,value.orderLevel,now,now]);await consumeDraft(tx,opts?.consumeDraft);return{id,...value,createdAt:now,updatedAt:now};});}
export async function updateTemplate(ctx:DataContext,id:string,input:TemplateInput,opts?:{consumeDraft?:boolean}):Promise<TaskTemplate>{const value=validateTemplate(input);return ctx.db.transaction(async tx=>{const old=await getTemplate(tx,id);if(!old)throw new Error('模板已不存在');if(old.name===value.name&&old.note===value.note&&old.orderLevel===value.orderLevel){await consumeDraft(tx,opts?.consumeDraft);return old;}const now=Math.max(ctx.clock.now().getTime(),old.updatedAt+1);await tx.run('UPDATE task_templates SET name=?,note=?,order_level=?,updated_at=? WHERE id=?',[value.name,value.note,value.orderLevel,now,id]);await consumeDraft(tx,opts?.consumeDraft);return{...old,...value,updatedAt:now};});}
export async function deleteTemplate(ctx:DataContext,id:string):Promise<void>{await ctx.db.transaction(async tx=>{
 await tx.run('DELETE FROM task_templates WHERE id=?',[id]);
 const draft=await tx.first<{payload:string}>('SELECT payload FROM drafts WHERE key=?',['template:editor']);
 let matches=false;try{matches=!!draft&&JSON.parse(draft.payload)?.id===id;}catch{/* Unreadable draft ownership is unknown; preserve it. */}
 if(matches)await tx.run('DELETE FROM drafts WHERE key=?',['template:editor']);
});}
/** A call is all-or-nothing. Separate explicit calls may create another independent set. */
export async function addTemplatesToToday(ctx:DataContext,ids:readonly string[],expectedDate:string):Promise<Task[]>{
 if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id))throw new Error('请选择不同模板');assertToday(expectedDate,todayOf(ctx.clock));
 return ctx.db.transaction(async tx=>{
  assertToday(expectedDate,todayOf(ctx.clock));const rows:Row[]=[];
  for(let offset=0;offset<ids.length;offset+=400){const batch=ids.slice(offset,offset+400);rows.push(...await tx.all<Row>(`SELECT * FROM task_templates WHERE id IN (${batch.map(()=>'?').join(',')})`,batch));}
  if(rows.length!==ids.length)throw new Error('所选模板已不存在，请重新选择');
  rows.sort((a,b)=>b.created_at-a.created_at||(a.id<b.id?1:a.id>b.id?-1:0));
  let order=(await tx.first<{n:number}>('SELECT COALESCE(MAX(sort_order),0) AS n FROM tasks WHERE date=?',[expectedDate]))!.n;const tasks:Task[]=[];
  for(const row of rows){const value=validateTemplate(convert(row)),now=ctx.clock.now().getTime();const task:Task={id:newId('task'),date:expectedDate,name:value.name,note:value.note||null,orderLevel:value.orderLevel,priority:'normal',project:'',status:'todo',sortOrder:++order,createdAt:now,updatedAt:now};
   await tx.run('INSERT INTO tasks(id,date,name,priority,project,status,sort_order,order_level,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[task.id,task.date,task.name,task.priority,task.project,task.status,task.sortOrder,task.orderLevel,task.note,now,now]);tasks.push(task);
  }
  await tx.run('UPDATE plan_settlements SET stale=1 WHERE date=?',[expectedDate]);assertToday(expectedDate,todayOf(ctx.clock));return tasks;
 });
}
