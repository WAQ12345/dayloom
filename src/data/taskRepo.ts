import { assertToday, todayOf } from '../domain/dates.ts';
import type { Task, TaskStatus, PlanSettlement } from '../domain/types.ts';
import { nextOrder, reorderTaskLevel } from '../domain/tasks.ts';
import { validateTask, type ValidTask } from '../domain/validation.ts';
import { newId, type DataContext, type SqlExecutor } from './sql.ts';
type Row = {id:string;date:string;name:string;priority:Task['priority'];project:string;status:TaskStatus;sort_order:number;order_level:Task['orderLevel'];note:string|null;created_at:number;updated_at:number};
const convert=(r:Row):Task=>({id:r.id,date:r.date,name:r.name,priority:r.priority,project:r.project,status:r.status,sortOrder:r.sort_order,orderLevel:r.order_level??2,note:r.note,createdAt:r.created_at,updatedAt:r.updated_at});
const checked=(v:ValidTask)=>validateTask({...v,note:v.note??''});
export async function listTasks(db:SqlExecutor,date:string):Promise<Task[]>{return(await db.all<Row>('SELECT * FROM tasks WHERE date=? ORDER BY order_level,sort_order,created_at,id',[date])).map(convert);}
export async function listTasksInRange(db:SqlExecutor,from:string,to:string):Promise<Task[]>{return(await db.all<Row>('SELECT * FROM tasks WHERE date BETWEEN ? AND ? ORDER BY date,order_level,sort_order,created_at,id',[from,to])).map(convert);}
export async function getTask(db:SqlExecutor,id:string):Promise<Task|null>{const r=await db.first<Row>('SELECT * FROM tasks WHERE id=?',[id]);return r?convert(r):null;}
async function invalidate(tx:SqlExecutor,date:string){await tx.run('UPDATE plan_settlements SET stale=1 WHERE date=?',[date]);}
export async function createTask(ctx:DataContext,date:string,input:ValidTask):Promise<Task>{
  input=checked(input);assertToday(date,todayOf(ctx.clock));
  return ctx.db.transaction(async tx=>{
    assertToday(date,todayOf(ctx.clock));const now=ctx.clock.now().getTime();
    const task:Task={id:newId('task'),date,name:input.name,priority:input.priority??'normal',project:input.project,note:input.note,status:'todo',sortOrder:nextOrder(await listTasks(tx,date)),orderLevel:input.orderLevel??2,createdAt:now,updatedAt:now};
    await tx.run('INSERT INTO tasks(id,date,name,priority,project,status,sort_order,order_level,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[task.id,date,task.name,task.priority,task.project,task.status,task.sortOrder,task.orderLevel,task.note,now,now]);
    await invalidate(tx,date);assertToday(date,todayOf(ctx.clock));return task;
  });
}
export async function updateTask(ctx:DataContext,id:string,input:ValidTask):Promise<Task>{
  input=checked(input);return ctx.db.transaction(async tx=>{const old=await getTask(tx,id);if(!old)throw new Error('任务已不存在');assertToday(old.date,todayOf(ctx.clock));const orderLevel=input.orderLevel??2;const sortOrder=orderLevel===old.orderLevel?old.sortOrder:nextOrder(await listTasks(tx,old.date));const task={...old,name:input.name,priority:input.priority??old.priority,project:input.project,note:input.note,orderLevel,sortOrder,updatedAt:ctx.clock.now().getTime()};await tx.run('UPDATE tasks SET name=?,priority=?,project=?,note=?,order_level=?,sort_order=?,updated_at=? WHERE id=?',[task.name,task.priority,task.project,task.note,task.orderLevel,task.sortOrder,task.updatedAt,id]);await invalidate(tx,old.date);assertToday(old.date,todayOf(ctx.clock));return task;});
}
/** Atomically reorder all tasks in one execution level, only on the current day.
 * Pure ordering does not invalidate settlement or alter task status/progress.
 */
export async function reorderTasks(ctx:DataContext,date:string,level:Task['orderLevel'],orderedIds:readonly string[]):Promise<Task[]>{
  assertToday(date,todayOf(ctx.clock));
  return ctx.db.transaction(async tx=>{
    assertToday(date,todayOf(ctx.clock));
    const before=await listTasks(tx,date),after=reorderTaskLevel(before,level,orderedIds);
    const oldOrders=new Map(before.map(t=>[t.id,t.sortOrder]));
    for(const task of after){if(oldOrders.get(task.id)!==task.sortOrder)await tx.run('UPDATE tasks SET sort_order=? WHERE id=? AND date=? AND order_level=?',[task.sortOrder,task.id,date,level]);}
    assertToday(date,todayOf(ctx.clock));
    return after;
  });
}
export async function setTaskStatus(ctx:DataContext,id:string,status:TaskStatus):Promise<void>{
  if(!['todo','done','cancelled'].includes(status))throw new Error('无效任务状态');await ctx.db.transaction(async tx=>{const old=await getTask(tx,id);if(!old)throw new Error('任务已不存在');assertToday(old.date,todayOf(ctx.clock));await tx.run('UPDATE tasks SET status=?,updated_at=? WHERE id=?',[status,ctx.clock.now().getTime(),id]);await invalidate(tx,old.date);assertToday(old.date,todayOf(ctx.clock));});
}
export async function deleteTask(ctx:DataContext,id:string):Promise<void>{await ctx.db.transaction(async tx=>{const old=await getTask(tx,id);if(!old)return;assertToday(old.date,todayOf(ctx.clock));await tx.run('DELETE FROM tasks WHERE id=?',[id]);await invalidate(tx,old.date);assertToday(old.date,todayOf(ctx.clock));});}
type SettleRow={date:string;summary:string|null;done_count:number;total_count:number;stale:number;settled_at:number};
export async function getPlanSettlement(db:SqlExecutor,date:string):Promise<PlanSettlement|null>{const r=await db.first<SettleRow>('SELECT * FROM plan_settlements WHERE date=?',[date]);return r?{date:r.date,summary:r.summary,doneCount:r.done_count,totalCount:r.total_count,stale:!!r.stale,settledAt:r.settled_at}:null;}
export async function savePlanSettlement(ctx:DataContext,date:string,summary:string|null):Promise<PlanSettlement>{
  assertToday(date,todayOf(ctx.clock));if((summary?.length??0)>2000)throw new Error('总结最多2000字');return ctx.db.transaction(async tx=>{assertToday(date,todayOf(ctx.clock));const tasks=await listTasks(tx,date);const value:PlanSettlement={date,summary,doneCount:tasks.filter(t=>t.status==='done').length,totalCount:tasks.filter(t=>t.status!=='cancelled').length,stale:false,settledAt:ctx.clock.now().getTime()};await tx.run('INSERT INTO plan_settlements(date,summary,done_count,total_count,stale,settled_at) VALUES(?,?,?,?,0,?) ON CONFLICT(date) DO UPDATE SET summary=excluded.summary,done_count=excluded.done_count,total_count=excluded.total_count,stale=0,settled_at=excluded.settled_at',[date,summary,value.doneCount,value.totalCount,value.settledAt]);assertToday(date,todayOf(ctx.clock));return value;});
}
