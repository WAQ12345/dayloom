import { assertToday, todayOf, isValidTime } from '../domain/dates.ts';
import type { WaterRecord } from '../domain/types.ts';
import { newId, type DataContext, type SqlExecutor } from './sql.ts';
type Row = { id: string; date: string; time: string; amount_ml: number; note: string | null; created_at: number };
const convert = (r: Row): WaterRecord => ({ id: r.id, date: r.date, time: r.time, amountMl: r.amount_ml, note: r.note, createdAt: r.created_at });
export async function listWater(db: SqlExecutor, date: string): Promise<WaterRecord[]> { return (await db.all<Row>('SELECT * FROM water WHERE date=? ORDER BY created_at DESC,rowid DESC', [date])).map(convert); }
export async function listWaterInRange(db: SqlExecutor, from: string, to: string): Promise<WaterRecord[]> { return (await db.all<Row>('SELECT * FROM water WHERE date BETWEEN ? AND ? ORDER BY date,time', [from,to])).map(convert); }
export async function addWater(ctx: DataContext, date: string, amountMl: number, time: string, note: string | null = null): Promise<WaterRecord> {
  assertToday(date, todayOf(ctx.clock));
  if (!Number.isFinite(amountMl) || amountMl < 1 || amountMl > 5000 || !isValidTime(time) || (note?.length ?? 0) > 500) throw new Error('饮水量需1—5000ml，时间格式HH:MM，备注最多500字');
  const record: WaterRecord = { id:newId('water'), date, time, amountMl, note, createdAt:ctx.clock.now().getTime() };
  await ctx.db.transaction(async tx => { assertToday(date,todayOf(ctx.clock)); await tx.run('INSERT INTO water(id,date,time,amount_ml,note,created_at) VALUES(?,?,?,?,?,?)',[record.id,date,time,amountMl,note,record.createdAt]); assertToday(date,todayOf(ctx.clock)); });
  return record;
}
export async function deleteWater(ctx: DataContext, id: string): Promise<void> {
  await ctx.db.transaction(async tx => { const row=await tx.first<Row>('SELECT * FROM water WHERE id=?',[id]); if(!row)return; assertToday(row.date,todayOf(ctx.clock)); await tx.run('DELETE FROM water WHERE id=?',[id]); assertToday(row.date,todayOf(ctx.clock)); });
}
export async function undoLastWater(ctx: DataContext, date: string): Promise<void> {
  assertToday(date,todayOf(ctx.clock));
  await ctx.db.transaction(async tx => { assertToday(date,todayOf(ctx.clock)); const rows=await listWater(tx,date); if(rows[0])await tx.run('DELETE FROM water WHERE id=?',[rows[0].id]); assertToday(date,todayOf(ctx.clock)); });
}
