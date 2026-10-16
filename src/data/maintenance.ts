import type { DataContext } from './sql.ts';
export type DataModule='food'|'plans'|'items'|'shopping'|'membership'|'fixed'|'ai'|'ideas'|'templates'|'collections';
const TABLES:Partial<Record<DataModule,readonly string[]>>={templates:['task_templates'],collections:['collections'],ideas:['ideas'],food:['meals','water','day_energy','food_settlements','food_favorites'],plans:['tasks','plan_settlements'],items:['items'],shopping:['shopping_items'],ai:['ai_messages','ai_conversations','ai_sessions','bazi_charts','bazi_profiles']};
/** Explicitly confirmed settings action; ordinary CRUD never calls this function. */
export async function deleteModule(ctx:DataContext,module:DataModule):Promise<void>{
 if(!['food','plans','items','shopping','membership','fixed','ai','ideas','templates','collections'].includes(module))throw new Error('无效模块');
 await ctx.db.transaction(async tx=>{
  if(module==='membership'||module==='fixed')await tx.run('DELETE FROM life_records WHERE kind=?',[module]);else for(const table of TABLES[module]!)await tx.exec(`DELETE FROM ${table}`);
  const prefixes=module==='food'?['meal:%','water:%','settlement:food%']:module==='plans'?['task:%','settlement:plan%']:module==='items'?['item:%']:module==='ideas'?['idea:%']:module==='templates'?['template:%']:module==='collections'?['collection:%']:module==='ai'?['ai:%','bazi:%']:[`${module}:%`];
  for(const prefix of prefixes)await tx.run('DELETE FROM drafts WHERE key LIKE ?',[prefix]);
 });
}
