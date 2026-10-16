import type { ShoppingItem } from '../domain/types.ts';
import { validateShopping, type ValidShopping } from '../domain/validation.ts';
import { newId, type DataContext, type SqlExecutor } from './sql.ts';
type Row = { id:string; name:string; note:string|null; status:'pending'|'done'; seq:number; created_at:number; completed_at:number|null; updated_at:number };
const convert = (r:Row):ShoppingItem => ({id:r.id,name:r.name,note:r.note,status:r.status,seq:r.seq,createdAt:r.created_at,completedAt:r.completed_at,updatedAt:r.updated_at});
export async function listShopping(db:SqlExecutor,status:ShoppingItem['status']):Promise<ShoppingItem[]> {
 if(status!=='pending'&&status!=='done')throw new Error('无效购物状态');
 return (await db.all<Row>(`SELECT * FROM shopping_items WHERE status=? ORDER BY ${status==='pending'?'created_at':'completed_at'} DESC,seq DESC`,[status])).map(convert);
}
export async function getShopping(db:SqlExecutor,id:string):Promise<ShoppingItem|null>{const r=await db.first<Row>('SELECT * FROM shopping_items WHERE id=?',[id]);return r?convert(r):null;}
export async function createShopping(ctx:DataContext,input:ValidShopping):Promise<ShoppingItem>{
 const value=validateShopping({name:input.name,note:input.note??''});
 return ctx.db.transaction(async tx=>{const now=ctx.clock.now().getTime();const seq=(await tx.first<{n:number}>('SELECT COALESCE(MAX(seq),0)+1 AS n FROM shopping_items'))!.n;const item:ShoppingItem={...value,id:newId('shopping'),status:'pending',seq,createdAt:now,completedAt:null,updatedAt:now};await tx.run('INSERT INTO shopping_items VALUES(?,?,?,?,?,?,?,?)',[item.id,item.name,item.note,item.status,seq,now,null,now]);return item;});
}
export async function updateShopping(ctx:DataContext,id:string,input:ValidShopping):Promise<ShoppingItem>{const value=validateShopping({name:input.name,note:input.note??''});return ctx.db.transaction(async tx=>{const old=await getShopping(tx,id);if(!old)throw new Error('购物记录已不存在');const item={...old,...value,updatedAt:ctx.clock.now().getTime()};await tx.run('UPDATE shopping_items SET name=?,note=?,updated_at=? WHERE id=?',[item.name,item.note,item.updatedAt,id]);return item;});}
export async function setShoppingStatus(ctx:DataContext,id:string,status:ShoppingItem['status']):Promise<void>{if(status!=='pending'&&status!=='done')throw new Error('无效购物状态');await ctx.db.transaction(async tx=>{const old=await getShopping(tx,id);if(!old)throw new Error('购物记录已不存在');if(old.status===status)return;const now=ctx.clock.now().getTime();await tx.run('UPDATE shopping_items SET status=?,completed_at=?,updated_at=? WHERE id=?',[status,status==='done'?now:null,now,id]);});}
export async function deleteShopping(ctx:DataContext,id:string):Promise<void>{await ctx.db.transaction(async tx=>{await tx.run('DELETE FROM shopping_items WHERE id=?',[id]);});}
