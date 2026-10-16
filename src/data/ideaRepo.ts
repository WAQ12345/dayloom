import { validateIdea, type Idea, type IdeaInput } from '../domain/ideas.ts';
import { newId, type DataContext, type SqlExecutor, type SqlValue } from './sql.ts';
type Row={id:string;body:string;tags_json:string;created_at:number;updated_at:number;pinned:number;archived:number};
const idea=(row:Row):Idea=>({id:row.id,body:row.body,tags:JSON.parse(row.tags_json),createdAt:row.created_at,updatedAt:row.updated_at,pinned:row.pinned===1,archived:row.archived===1});
export type IdeaQuery={query?:string;tag?:string|null;limit?:number;offset?:number;archived?:boolean|null;sort?:'created'|'pinned'};
/** Existing AI/export callers retain all records in writing-time order unless they opt into management filters. */
export async function listIdeas(db:SqlExecutor,{query='',tag=null,limit=50,offset=0,archived=null,sort='created'}:IdeaQuery={}):Promise<Idea[]>{
 if(typeof query!=='string'||Array.from(query).length>20000||(tag!==null&&typeof tag!=='string')||!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||(archived!==null&&typeof archived!=='boolean')||!['created','pinned'].includes(sort))throw new Error('想法查询无效');
 const conditions:string[]=[],params:SqlValue[]=[];
 if(query.trim()){conditions.push('instr(body,?)>0');params.push(query.trim());}
 if(tag!==null){conditions.push('EXISTS (SELECT 1 FROM json_each(ideas.tags_json) WHERE value=?)');params.push(tag);}
 if(archived!==null){conditions.push('archived=?');params.push(archived?1:0);}
 return(await db.all<Row>(`SELECT * FROM ideas ${conditions.length?'WHERE '+conditions.join(' AND '):''} ORDER BY ${sort==='pinned'?'pinned DESC,':''}created_at DESC,id DESC LIMIT ? OFFSET ?`,[...params,limit,offset])).map(idea);
}
export async function listIdeaTags(db:SqlExecutor):Promise<string[]>{return(await db.all<{tag:string}>('SELECT DISTINCT value AS tag FROM ideas,json_each(ideas.tags_json) ORDER BY tag COLLATE NOCASE,tag')).map(row=>row.tag);}
export async function getIdea(db:SqlExecutor,id:string):Promise<Idea|null>{const row=await db.first<Row>('SELECT * FROM ideas WHERE id=?',[id]);return row?idea(row):null;}
export async function getIdeasByIds(db:SqlExecutor,ids:readonly string[]):Promise<Idea[]>{
 if(!Array.isArray(ids)||ids.length<1||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id))throw new Error('请选择不同想法');
 const rows:Row[]=[];for(let offset=0;offset<ids.length;offset+=400){const batch=ids.slice(offset,offset+400);rows.push(...await db.all<Row>(`SELECT * FROM ideas WHERE id IN (${batch.map(()=>'?').join(',')})`,batch));}
 return ids.map(id=>{const row=rows.find(row=>row.id===id);if(!row)throw new Error('所选想法已不存在，请重新选择');return idea(row);});
}
export async function createIdea(ctx:DataContext,input:IdeaInput,opts?:{consumeDraft?:boolean}):Promise<Idea>{const value=validateIdea(input);return ctx.db.transaction(async tx=>{const now=ctx.clock.now().getTime(),id=newId('idea');await tx.run('INSERT INTO ideas(id,body,tags_json,created_at,updated_at,pinned,archived) VALUES(?,?,?,?,?,?,?)',[id,value.body,JSON.stringify(value.tags),now,now,0,0]);if(opts?.consumeDraft)await tx.run("DELETE FROM drafts WHERE key=?",["idea:editor"]);return{id,...value,createdAt:now,updatedAt:now,pinned:false,archived:false};});}
export async function updateIdea(ctx:DataContext,id:string,input:IdeaInput,opts?:{consumeDraft?:boolean}):Promise<Idea>{const value=validateIdea(input);return ctx.db.transaction(async tx=>{const old=await getIdea(tx,id);if(!old)throw new Error('想法已不存在');if(old.body===value.body&&JSON.stringify(old.tags)===JSON.stringify(value.tags)){if(opts?.consumeDraft)await tx.run("DELETE FROM drafts WHERE key=?",["idea:editor"]);return old;}const now=Math.max(ctx.clock.now().getTime(),old.updatedAt+1);await tx.run('UPDATE ideas SET body=?,tags_json=?,updated_at=? WHERE id=?',[value.body,JSON.stringify(value.tags),now,id]);if(opts?.consumeDraft)await tx.run("DELETE FROM drafts WHERE key=?",["idea:editor"]);return{...old,...value,updatedAt:now};});}
/** Frozen AI conversation snapshots deliberately survive source deletion. */
export async function deleteIdea(ctx:DataContext,id:string):Promise<void>{await ctx.db.run('DELETE FROM ideas WHERE id=?',[id]);}

/** Management state never changes the content's writing/modification timestamps. */
export async function setIdeaPinned(ctx:DataContext,id:string,pinned:boolean):Promise<Idea>{
 if(typeof pinned!=='boolean')throw new Error('置顶状态无效');
 return ctx.db.transaction(async tx=>{const old=await getIdea(tx,id);if(!old)throw new Error('想法已不存在');if(pinned&&old.archived)throw new Error('请先恢复归档想法');await tx.run('UPDATE ideas SET pinned=? WHERE id=?',[pinned?1:0,id]);return {...old,pinned};});
}
export async function setIdeaArchived(ctx:DataContext,id:string,archived:boolean):Promise<Idea>{
 if(typeof archived!=='boolean')throw new Error('归档状态无效');
 return ctx.db.transaction(async tx=>{const old=await getIdea(tx,id);if(!old)throw new Error('想法已不存在');await tx.run(archived?'UPDATE ideas SET archived=1,pinned=0 WHERE id=?':'UPDATE ideas SET archived=0 WHERE id=?',[id]);return {...old,archived,pinned:archived?false:old.pinned};});
}
