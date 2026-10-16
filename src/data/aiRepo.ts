import { validateIdea, ideaReferenceSummary, formatIdeaTime, IDEA_SCOPE_NOTICE, type Idea } from '../domain/ideas.ts';
import { getIdeasByIds } from './ideaRepo.ts';
import { validateTimeOptions, type BirthTimeOptions } from '../domain/bazi/birthTime.ts';
import { isValidDate, isValidTime } from '../domain/dates.ts';
import { newId, type DataContext, type SqlExecutor } from './sql.ts';
export type JsonObject = Record<string, unknown>;
export type BaziProfile={id:string;nickname:string;input:JsonObject;createdAt:number;updatedAt:number};
export type BaziChart={id:string;profileId:string;input:JsonObject;result:JsonObject;algorithmVersion:string;createdAt:number};
export type AiConversation={id:string;tool:'food'|'bazi'|'ideas';profileId:string|null;snapshot:string;refs:unknown[];promptVersion:string;createdAt:number};
export type AiMessage={id:string;conversationId:string;role:'user'|'assistant';content:string;settings:JsonObject;usage:JsonObject|null;status:'success'|'error'|'cancelled';error:string|null;createdAt:number;seq:number};
export function jsonObject(value:unknown):string {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('资料格式无效');
 const encoded=JSON.stringify(value);if(encoded.length>500000)throw new Error('资料过大');
 // Provider secrets must never become ordinary business data or backup content.
 const visit=(v:unknown,depth=0):void=>{if(depth>30)throw new Error('资料层级过深');if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(/^(api[_-]?key|authorization|access[_-]?token|secret)$/i.test(k))throw new Error('资料不能包含密钥');visit(x,depth+1);}else if(typeof v==='number'&&!Number.isFinite(v))throw new Error('资料数值无效');};visit(value);return encoded;
}
/** Structural boundary check: restoring a profile must never make form access unsafe. */
export function validateBaziInput(value:unknown):JsonObject {
 jsonObject(value);const v=value as JsonObject;validateTimeOptions(v as BirthTimeOptions);
 if(!['solar','lunar'].includes(String(v.calendar))||typeof v.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.date)||!['男','女'].includes(String(v.sex)))throw new Error('出生资料格式无效');
 const [year,month,day]=v.date.split('-').map(Number);
 if(year<1900||year>2100||month<1||month>12||day<1||day>(v.calendar==='lunar'?30:31)||(v.calendar==='solar'&&!isValidDate(v.date)))throw new Error('出生日期无效');
 if(v.leapMonth!==undefined&&typeof v.leapMonth!=='boolean')throw new Error('闰月标记无效');
 if(v.place!==undefined&&(typeof v.place!=='string'||v.place.length>200))throw new Error('出生地无效');
 if(!v.time||typeof v.time!=='object'||Array.isArray(v.time))throw new Error('出生时间无效');
 const t=v.time as JsonObject;
 if(t.kind==='clock'){if(!isValidTime(t.value))throw new Error('出生时间无效');}
 else if(t.kind==='shichen'){if(typeof t.value!=='string'||t.value.length!==1||!'子丑寅卯辰巳午未申酉戌亥'.includes(t.value))throw new Error('时辰无效');}
 else if(t.kind!=='unknown')throw new Error('出生时间无效');
 if(v.timeBasis==='trueSolar'&&t.kind==='shichen')throw new Error('时辰资料不能精确换算真太阳时');
 if(v.timeBasis==='trueSolar'&&t.kind==='clock'&&!v.location)throw new Error('真太阳时需要出生地点');
 return v;
}
export function validateConversationData(tool:string,profileId:string|null,snapshot:string,refs:unknown[]):void {
 if(!['food','bazi','ideas'].includes(tool)||!Array.isArray(refs)||(tool!=='ideas'&&refs.length>500))throw new Error('会话资料无效');
 const data=JSON.parse(snapshot);jsonObject(data);const seen=new Set<string>();
 for(const raw of refs){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('会话引用无效');const r=raw as JsonObject;
  if(typeof r.ref!=='string'||seen.has(r.ref)||typeof r.recordId!=='string'||!r.recordId||r.recordId.length>500||typeof r.label!=='string'||r.label.length>100000||typeof r.summary!=='string'||r.summary.length>100000)throw new Error('会话引用无效');seen.add(r.ref);
  if(tool==='food'&&(!/^R[1-9]\d*$/.test(r.ref)||!['meal','water'].includes(String(r.kind))||!isValidDate(r.date)))throw new Error('饮食引用无效');
  if(tool==='bazi'&&(r.kind!=='bazi'||r.ref!=='B1'))throw new Error('命盘引用无效');
 }
 if(tool==='ideas'){
  if(profileId!==null||Object.keys(data).sort().join()!=='ideas,notice'||data.notice!==IDEA_SCOPE_NOTICE||!Array.isArray(data.ideas)||!data.ideas.length||refs.length!==data.ideas.length)throw new Error('想法快照无效');
  const ids=new Set<string>();
  for(let i=0;i<data.ideas.length;i++){
   const row=data.ideas[i] as JsonObject;if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join()!=='body,createdAt,id,tags,updatedAt')throw new Error('想法快照无效');
   const value=validateIdea(row),ref=refs[i] as JsonObject;
   if(typeof row.id!=='string'||!row.id||ids.has(row.id)||row.id.length>500||!Number.isSafeInteger(row.createdAt)||!Number.isSafeInteger(row.updatedAt)||(row.createdAt as number)<0||(row.updatedAt as number)<(row.createdAt as number)||row.body!==value.body||JSON.stringify(row.tags)!==JSON.stringify(value.tags)||Object.keys(ref).sort().join()!=='kind,label,recordId,ref,summary'||ref.label!==formatIdeaTime(row.createdAt as number)||ref.kind!=='idea'||ref.ref!==`I${i+1}`||ref.recordId!==row.id||ref.summary!==ideaReferenceSummary(row as unknown as Idea))throw new Error('想法引用与正文不一致');
   ids.add(row.id);
  }
 }
 if(tool==='food'&&profileId!==null)throw new Error('饮食范围无效');
 if(tool==='bazi'&&(!profileId||refs.length!==1||typeof data.chart!=='string'||!data.chart||typeof data.algorithmVersion!=='string'||typeof data.referenceSummary!=='string'||(refs[0] as JsonObject).summary!==data.chart))throw new Error('命盘快照无效');
}
function text(v:string,max=100000){if(typeof v!=='string'||v.length>max)throw new Error('文本无效或过长');return v;}
function required(v:string,max=100){text(v,max);if(!v.trim())throw new Error('请填写必填项');return v.trim();}
type ProfileRow={id:string;nickname:string;input_json:string;created_at:number;updated_at:number};
const profile=(r:ProfileRow):BaziProfile=>({id:r.id,nickname:r.nickname,input:JSON.parse(r.input_json),createdAt:r.created_at,updatedAt:r.updated_at});
export async function listProfiles(db:SqlExecutor):Promise<BaziProfile[]>{return(await db.all<ProfileRow>('SELECT * FROM bazi_profiles ORDER BY updated_at DESC,id DESC')).map(profile);}
export async function getProfile(db:SqlExecutor,id:string):Promise<BaziProfile|null>{const r=await db.first<ProfileRow>('SELECT * FROM bazi_profiles WHERE id=?',[id]);return r?profile(r):null;}
export async function saveProfile(ctx:DataContext,value:{id?:string;nickname:string;input:JsonObject}):Promise<BaziProfile>{const nickname=required(value.nickname),input=jsonObject(validateBaziInput(value.input));return ctx.db.transaction(async tx=>{const old=value.id?await getProfile(tx,value.id):null;if(value.id&&!old)throw new Error('档案已不存在');const now=ctx.clock.now().getTime(),id=old?.id??newId('birth');await tx.run('INSERT INTO bazi_profiles VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname,input_json=excluded.input_json,updated_at=excluded.updated_at',[id,nickname,input,old?.createdAt??now,now]);return{id,nickname,input:JSON.parse(input),createdAt:old?.createdAt??now,updatedAt:now};});}
/** Explicit profile deletion includes its charts and private interpretation history. */
export async function deleteProfile(ctx:DataContext,id:string):Promise<void>{await ctx.db.transaction(async tx=>{await tx.run('DELETE FROM ai_messages WHERE conversation_id IN (SELECT id FROM ai_conversations WHERE profile_id=?)',[id]);await tx.run('DELETE FROM ai_conversations WHERE profile_id=?',[id]);await tx.run('DELETE FROM bazi_charts WHERE profile_id=?',[id]);await tx.run('DELETE FROM bazi_profiles WHERE id=?',[id]);});}
type ChartRow={id:string;profile_id:string;input_json:string;result_json:string;algorithm_version:string;created_at:number};
const chart=(r:ChartRow):BaziChart=>({id:r.id,profileId:r.profile_id,input:JSON.parse(r.input_json),result:JSON.parse(r.result_json),algorithmVersion:r.algorithm_version,createdAt:r.created_at});
function normalizedBirth(value:JsonObject):string {
 const v=validateBaziInput(value);const time=v.time as JsonObject;
 return JSON.stringify({calendar:v.calendar,date:v.date,leapMonth:v.calendar==='lunar'&&!!v.leapMonth,time:time.kind==='unknown'?{kind:'unknown'}:{kind:time.kind,value:time.value},sex:v.sex,timeBasis:v.timeBasis??'beijing',location:v.location?{id:(v.location as JsonObject).id,name:(v.location as JsonObject).name,longitude:(v.location as JsonObject).longitude,source:(v.location as JsonObject).source}:null,dst:v.dst??null,place:typeof v.place==='string'?v.place.trim():''});
}
/** Reuse immutable snapshots, including concurrent repeated taps. Never rewrite legacy rows. */
export async function createChart(ctx:DataContext,value:Omit<BaziChart,'id'|'createdAt'>):Promise<BaziChart>{
 const input=jsonObject(validateBaziInput(value.input)),result=jsonObject(value.result),version=required(value.algorithmVersion),identity=normalizedBirth(value.input);
 return ctx.db.transaction(async tx=>{
  if(!await getProfile(tx,value.profileId))throw new Error('档案已不存在');
  const rows=await tx.all<ChartRow>('SELECT * FROM bazi_charts WHERE profile_id=? AND algorithm_version=? ORDER BY created_at DESC,id DESC',[value.profileId,version]);
  const existing=rows.find(r=>normalizedBirth(JSON.parse(r.input_json))===identity&&JSON.parse(r.result_json).ruleVersion===value.result.ruleVersion);
  if(existing)return chart(existing);
  const id=newId('chart'),createdAt=ctx.clock.now().getTime();await tx.run('INSERT INTO bazi_charts VALUES(?,?,?,?,?,?)',[id,value.profileId,input,result,version,createdAt]);
  return {...value,id,createdAt,input:JSON.parse(input),result:JSON.parse(result),algorithmVersion:version};
 });
}
export async function listCharts(db:SqlExecutor,profileId:string,limit?:number,offset=0):Promise<BaziChart[]>{
 if(!Number.isSafeInteger(offset)||offset<0||(limit!==undefined&&(!Number.isSafeInteger(limit)||limit<1||limit>100)))throw new Error('命盘分页无效');
 return(await db.all<ChartRow>(`SELECT * FROM bazi_charts WHERE profile_id=? ORDER BY created_at DESC,id DESC${limit===undefined?'':' LIMIT ? OFFSET ?'}`,limit===undefined?[profileId]:[profileId,limit,offset])).map(chart);
}
export async function getChart(db:SqlExecutor,id:string):Promise<BaziChart|null>{const r=await db.first<ChartRow>('SELECT * FROM bazi_charts WHERE id=?',[id]);return r?chart(r):null;}
export async function deleteChart(ctx:DataContext,id:string):Promise<void>{await ctx.db.run('DELETE FROM bazi_charts WHERE id=?',[id]);}
type ConversationRow={id:string;tool:'food'|'bazi'|'ideas';profile_id:string|null;snapshot:string;refs:string;prompt_version:string;created_at:number};
const conversation=(r:ConversationRow):AiConversation=>({id:r.id,tool:r.tool,profileId:r.profile_id,snapshot:r.snapshot,refs:JSON.parse(r.refs),promptVersion:r.prompt_version,createdAt:r.created_at});
export async function createConversation(ctx:DataContext,value:{tool:'food'|'bazi'|'ideas';profileId?:string|null;snapshot:string;refs:unknown[];promptVersion:string}):Promise<AiConversation>{if(!['food','bazi','ideas'].includes(value.tool)||!Array.isArray(value.refs))throw new Error('会话类型无效');text(value.snapshot,500000);jsonObject(JSON.parse(value.snapshot));const refs=JSON.stringify(value.refs);jsonObject({refs:value.refs});required(value.promptVersion);validateConversationData(value.tool,value.profileId??null,value.snapshot,value.refs);return ctx.db.transaction(async tx=>{const profileId=value.profileId??null;if(value.tool==='food'&&profileId!==null)throw new Error('饮食会话不能关联出生档案');if(value.tool==='bazi'&&(!profileId||!await getProfile(tx,profileId)))throw new Error('请选择出生档案');if(value.tool==='bazi'){const ref=value.refs[0] as {recordId:string};const c=await getChart(tx,ref.recordId);if(!c||c.profileId!==profileId)throw new Error('命盘不属于所选档案');}if(value.tool==='ideas'){const frozen=JSON.parse(value.snapshot).ideas;const source=await getIdeasByIds(tx,frozen.map((r:{id:string})=>r.id));for(let i=0;i<source.length;i++){const a=source[i],b=frozen[i];if(a.body!==b.body||JSON.stringify(a.tags)!==JSON.stringify(b.tags)||a.createdAt!==b.createdAt||a.updatedAt!==b.updatedAt)throw new Error('想法已变更，请重新预览授权');}}const id=newId('conversation'),createdAt=ctx.clock.now().getTime();await tx.run('INSERT INTO ai_conversations VALUES(?,?,?,?,?,?,?)',[id,value.tool,profileId,value.snapshot,refs,value.promptVersion,createdAt]);return{id,tool:value.tool,profileId,snapshot:value.snapshot,refs:JSON.parse(refs),promptVersion:value.promptVersion,createdAt};});}
export async function getConversation(db:SqlExecutor,id:string):Promise<AiConversation|null>{const r=await db.first<ConversationRow>('SELECT * FROM ai_conversations WHERE id=?',[id]);return r?conversation(r):null;}
export async function listConversations(db:SqlExecutor,tool?:'food'|'bazi'|'ideas',offset=0):Promise<AiConversation[]>{if(tool&&!['food','bazi','ideas'].includes(tool))throw new Error('会话类型无效');if(!Number.isSafeInteger(offset)||offset<0)throw new Error('分页无效');return(await db.all<ConversationRow>(`SELECT * FROM ai_conversations ${tool?'WHERE tool=?':''} ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?`,tool?[tool,offset]:[offset])).map(conversation);}
export async function deleteConversation(ctx:DataContext,id:string):Promise<void>{await ctx.db.transaction(async tx=>{await tx.run('DELETE FROM ai_messages WHERE conversation_id=?',[id]);await tx.run('DELETE FROM ai_conversations WHERE id=?',[id]);if(id.startsWith('legacy_'))await tx.run('DELETE FROM ai_sessions WHERE id=?',[id.slice(7)]);});}
type MessageRow={id:string;conversation_id:string;role:'user'|'assistant';content:string;settings_json:string;usage_json:string|null;status:AiMessage['status'];error:string|null;created_at:number;seq:number};
const message=(r:MessageRow):AiMessage=>({id:r.id,conversationId:r.conversation_id,role:r.role,content:r.content,settings:JSON.parse(r.settings_json),usage:r.usage_json?JSON.parse(r.usage_json):null,status:r.status,error:r.error,createdAt:r.created_at,seq:r.seq});
export async function appendMessage(ctx:DataContext,value:Omit<AiMessage,'id'|'createdAt'|'seq'|'usage'|'error'>&{usage?:JsonObject|null;error?:string|null}):Promise<AiMessage>{if(!['user','assistant'].includes(value.role)||!['success','error','cancelled'].includes(value.status))throw new Error('消息状态无效');text(value.content,2000000);if(value.error)text(value.error,2000);const settings=jsonObject(value.settings),usage=value.usage?jsonObject(value.usage):null;return ctx.db.transaction(async tx=>{if(!await getConversation(tx,value.conversationId))throw new Error('会话已不存在');const seq=(await tx.first<{n:number}>('SELECT COALESCE(MAX(seq),0)+1 AS n FROM ai_messages WHERE conversation_id=?',[value.conversationId]))!.n,id=newId('message'),createdAt=ctx.clock.now().getTime();await tx.run('INSERT INTO ai_messages VALUES(?,?,?,?,?,?,?,?,?,?)',[id,value.conversationId,value.role,value.content,settings,usage,value.status,value.error??null,createdAt,seq]);return{...value,id,createdAt,seq,settings:JSON.parse(settings),usage:usage?JSON.parse(usage):null,error:value.error??null};});}
export async function listMessages(db:SqlExecutor,conversationId:string):Promise<AiMessage[]>{return(await db.all<MessageRow>('SELECT * FROM ai_messages WHERE conversation_id=? ORDER BY seq',[conversationId])).map(message);}
