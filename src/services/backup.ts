import { validateTemplate } from '../domain/templates.ts';
import { validateCollection } from '../domain/collections.ts';
import { validateIdea } from '../domain/ideas.ts';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { SCHEMA_VERSION, migrateLegacyAi } from '../data/migrations.ts';
import { jsonObject, validateBaziInput, validateConversationData } from '../data/aiRepo.ts';
import { SETTINGS_VALIDATORS } from '../data/settingsRepo.ts';
import { newId, PHOTO_NAME_RE, type DataContext, type SqlValue } from '../data/sql.ts';
import { LIMITS } from '../domain/validation.ts';
import { round1, totalConsumption } from '../domain/energy.ts';
import { isValidDate, isValidTime, todayOf } from '../domain/dates.ts';

type Row=Record<string,SqlValue>;
type Rule=(v:unknown)=>boolean;
const text:Rule=v=>typeof v==='string'&&v.length<=100000;
const short:Rule=v=>typeof v==='string'&&v.length>0&&v.length<=500;
const num:Rule=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e15;
const integer:Rule=v=>num(v)&&Number.isSafeInteger(v);
const nullable=(r:Rule):Rule=>v=>v===null||r(v);
const choice=(...values:SqlValue[]):Rule=>v=>values.includes(v as SqlValue);
const bounded=(max:number,min=0):Rule=>v=>num(v)&&(v as number)>=min&&(v as number)<=max;
const boundedText=(max:number,required=false):Rule=>v=>typeof v==='string'&&v.length<=max&&(!required||v.trim().length>0);
const name=boundedText(LIMITS.name,true),note=nullable(boundedText(LIMITS.note)),kcal=bounded(LIMITS.kcal);
const photo:Rule=v=>v===null||(typeof v==='string'&&PHOTO_NAME_RE.test(v));
const objectJson:Rule=v=>{try{if(typeof v!=='string')return false;jsonObject(JSON.parse(v));return true;}catch{return false;}};
const baziInputJson:Rule=v=>{try{if(typeof v!=='string')return false;validateBaziInput(JSON.parse(v));return true;}catch{return false;}};
const arrayJson:Rule=v=>{try{return typeof v==='string'&&Array.isArray(JSON.parse(v))&&objectJson(JSON.stringify({refs:JSON.parse(v)}));}catch{return false;}};
const ideaBody:Rule=v=>{try{return validateIdea({body:v,tags:[]}).body===v;}catch{return false;}};
const ideaTags:Rule=v=>{try{if(typeof v!=='string')return false;const tags=JSON.parse(v);return JSON.stringify(validateIdea({body:'正文',tags}).tags)===JSON.stringify(tags);}catch{return false;}};
const aiTables=['bazi_profiles','bazi_charts','ai_conversations','ai_messages'];
const specs:Record<string,Record<string,Rule>>={
 task_templates:{id:short,name:boundedText(100,true),note:boundedText(500),order_level:choice(1,2,3),created_at:integer,updated_at:integer},
 collections:{id:short,kind:choice('text','link','account'),account:boundedText(1000),password:boundedText(4000),name:boundedText(200),body:boundedText(40000),url:boundedText(8192),source:boundedText(400),created_at:integer,updated_at:integer},
 ideas:{id:short,body:ideaBody,tags_json:ideaTags,created_at:integer,updated_at:integer,pinned:choice(0,1),archived:choice(0,1)},
 meals:{id:short,date:isValidDate,meal_type:choice('breakfast','lunch','dinner','snack'),name,kcal,time:nullable(isValidTime),note,photo,created_at:integer,updated_at:integer},
 food_favorites:{id:short,name,kcal,meal_type:nullable(choice('breakfast','lunch','dinner','snack')),created_at:integer},
 day_energy:{date:isValidDate,metabolism:nullable(bounded(10000,1)),expenditure:nullable(kcal),updated_at:integer},
 food_settlements:{date:isValidDate,confirmed:choice(0,1),stale:choice(0,1),intake:nullable(num),total:nullable(num),note:nullable(text),settled_at:integer},
 water:{id:short,date:isValidDate,time:isValidTime,amount_ml:bounded(LIMITS.waterMl,1),note,created_at:integer},
 tasks:{id:short,date:isValidDate,name,order_level:choice(1,2,3),priority:choice('normal','important'),project:boundedText(LIMITS.project),status:choice('todo','done','cancelled'),sort_order:v=>integer(v)&&(v as number)>=1,note,created_at:integer,updated_at:integer},
 plan_settlements:{date:isValidDate,summary:nullable(boundedText(2000)),done_count:integer,total_count:integer,stale:choice(0,1),settled_at:integer},
 categories:{name:boundedText(LIMITS.category,true),sort:integer},
 shopping_items:{id:short,name,note,status:choice('pending','done'),seq:v=>integer(v)&&(v as number)>=1,created_at:integer,completed_at:nullable(integer),updated_at:integer},
 life_records:{id:short,kind:choice('membership','fixed'),name,start_date:isValidDate,amount_cents:nullable(v=>integer(v)&&(v as number)<=LIMITS.priceYuan*100),note,seq:v=>integer(v)&&(v as number)>=1,created_at:integer,updated_at:integer},
 items:{id:short,name,category:boundedText(LIMITS.category,true),purchase_date:nullable(isValidDate),price_cents:nullable(v=>integer(v)&&(v as number)<=LIMITS.priceYuan*100),location:nullable(boundedText(LIMITS.name)),brand:nullable(boundedText(LIMITS.name)),note,photo,created_at:integer,updated_at:integer},
 bazi_profiles:{id:short,nickname:boundedText(100,true),input_json:baziInputJson,created_at:integer,updated_at:integer},
 bazi_charts:{id:short,profile_id:short,input_json:baziInputJson,result_json:objectJson,algorithm_version:short,created_at:integer},
 ai_conversations:{id:short,tool:choice('food','bazi','ideas'),profile_id:nullable(short),snapshot:objectJson,refs:arrayJson,prompt_version:short,created_at:integer},
 ai_messages:{id:short,conversation_id:short,role:choice('user','assistant'),content:boundedText(2000000),settings_json:objectJson,usage_json:nullable(objectJson),status:choice('success','error','cancelled'),error:nullable(boundedText(2000)),created_at:integer,seq:v=>integer(v)&&(v as number)>=1},
 settings:{key:choice('profile','waterAmounts','reminder','aiModel'),value:text},
 drafts:{key:short,date:nullable(isValidDate),payload:text,updated_at:integer},
 ai_sessions:{id:short,created_at:integer,question:text,model:short,snapshot:text,refs:text,answer:nullable(text),citations:text,status:choice('success','error','cancelled'),error:nullable(text)},
};
export const BACKUP_LIMITS={zip:100*1024*1024,expanded:200*1024*1024,photo:20*1024*1024,manifest:20*1024*1024,entries:10001} as const;
const {zip:MAX_ZIP,expanded:MAX_EXPANDED,photo:MAX_PHOTO,manifest:MAX_MANIFEST,entries:MAX_ENTRIES}=BACKUP_LIMITS;
export function assertArchiveBudget(entries:readonly {name:string;size:number}[]):void {
 if(entries.length>MAX_ENTRIES||entries.reduce((n,e)=>n+e.size,0)>MAX_EXPANDED||entries.some(e=>!Number.isSafeInteger(e.size)||e.size<0||e.size>(e.name==='manifest.json'?MAX_MANIFEST:MAX_PHOTO)))throw new Error('备份超过可恢复的容量限制，未生成文件');
}
type Payload={format:'daily-life';version:1;schema:number;createdAt:string;tables:Record<string,Row[]>};
export type ValidatedBackup={summary:{createdAt:string;meals:number;tasks:number;templates:number;collections:number;ideas:number;items:number;shopping:number;memberships:number;fixed:number;drafts:number;photos:number;baziProfiles:number;aiConversations:number};payload:Payload;photos:Record<string,Uint8Array>};
function fail():never {throw new Error('备份格式无效或已损坏，原数据未修改。旧验证版 JSON 不兼容。');}
function validatePayload(value:unknown,today=todayOf()):Payload {
 if(!value||typeof value!=='object') return fail();
 const p=value as Payload;
 if(p.format!=='daily-life'||p.version!==1||![1,2,3,4,5,6,7,SCHEMA_VERSION].includes(p.schema)||typeof p.createdAt!=='string'||!Number.isFinite(Date.parse(p.createdAt))||!p.tables)return fail();
 const expected=Object.keys(specs).filter(key=>(p.schema>=3||!['shopping_items','life_records'].includes(key))&&(p.schema>=4||!aiTables.includes(key))&&(p.schema>=5||key!=='ideas')&&(p.schema>=6||!['task_templates','collections'].includes(key)));
 if(typeof p.tables!=='object'||Array.isArray(p.tables)||Object.keys(p.tables).sort().join()!==expected.sort().join())return fail();
 // Schema 1 preserves legacy ordering/priority; the new level defaults to 2.
 if(p.schema===1){
  if(!Array.isArray(p.tables.tasks))return fail();
  for(const row of p.tables.tasks){if(!row||typeof row!=='object'||'order_level' in row)return fail();row.order_level=2;}
 }
 if(p.schema<3){p.tables.shopping_items=[];p.tables.life_records=[];}
 if(p.schema<4)for(const table of aiTables)p.tables[table]=[];
 if(p.schema<5)p.tables.ideas=[];
 if(p.schema<6){p.tables.task_templates=[];p.tables.collections=[];}
 if(p.schema<7)for(const row of p.tables.collections){
  if(!row||typeof row!=='object'||Object.keys(row).sort().join()!=='body,created_at,id,name,source,updated_at,url')return fail();
  row.kind=typeof row.url==='string'&&row.url.trim()?'link':'text';row.account='';row.password='';
 }
 if(p.schema<8){
  if(!Array.isArray(p.tables.ideas))return fail();
  for(const row of p.tables.ideas){
   if(!row||typeof row!=='object'||Object.keys(row).sort().join()!=='body,created_at,id,tags_json,updated_at')return fail();
   row.pinned=0;row.archived=0;
  }
 }
 p.schema=SCHEMA_VERSION;
 for(const [table,spec] of Object.entries(specs)) {
  const rows=p.tables[table];if(!Array.isArray(rows)||rows.length>100000)return fail();
  const keys=new Set<SqlValue>();
  for(const row of rows) {
   if(!row||typeof row!=='object'||Object.keys(row).sort().join()!==Object.keys(spec).sort().join())return fail();
   for(const [col,rule] of Object.entries(spec))if(!rule(row[col]))return fail();
   const key=row.id??row.key??row.date??row.name;if(keys.has(key))return fail();keys.add(key);
   if(['ideas','task_templates','collections'].includes(table)&&(row.updated_at as number)<(row.created_at as number))return fail();
   if(table==='ideas'&&row.archived===1&&row.pinned===1)return fail();
   if(table==='task_templates'){try{const clean=validateTemplate({name:row.name,note:row.note,orderLevel:row.order_level});if(clean.name!==row.name||clean.note!==row.note)return fail();}catch{return fail();}}
   if(table==='collections'){try{const clean=validateCollection(row);if(clean.kind!==row.kind||clean.account!==row.account||clean.password!==row.password||clean.name!==row.name||clean.body!==row.body||clean.url!==row.url||clean.source!==row.source)return fail();}catch{return fail();}}
   if(table==='life_records'&&(row.start_date as string)>today)return fail();
   if(table==='shopping_items'&&((row.status==='done')!==(row.completed_at!==null)))return fail();
   if(table==='settings') {try {const k=row.key as keyof typeof SETTINGS_VALIDATORS;const sanitized=SETTINGS_VALIDATORS[k](JSON.parse(row.value as string));if(sanitized===undefined)return fail();row.value=JSON.stringify(sanitized);}catch{return fail();}}
   if(table==='drafts') validateDraft(row);
   if(table==='ai_sessions') {try {const refs=JSON.parse(row.refs as string);const citations=JSON.parse(row.citations as string);if(!Array.isArray(refs)||!Array.isArray(citations)||refs.some((r:Record<string,unknown>)=>!r||!/^R\d+$/.test(String(r.ref))||!short(r.recordId)||!choice('meal','water')(r.kind)||!isValidDate(r.date)||!text(r.label)||!text(r.summary))||citations.some((c:Record<string,unknown>)=>!c||!/^R\d+$/.test(String(c.ref))||!text(c.recordId)||typeof c.valid!=='boolean'||(c.valid&&!refs.some((r:Record<string,unknown>)=>r.ref===c.ref&&r.recordId===c.recordId))))return fail();JSON.parse(row.snapshot as string);}catch{return fail();}}
   if(table==='plan_settlements'&&(row.done_count as number)>(row.total_count as number))return fail();
  }
 }
 for(const table of ['shopping_items','life_records'])if(new Set(p.tables[table].map(r=>r.seq)).size!==p.tables[table].length)return fail();
 const profiles=new Set(p.tables.bazi_profiles.map(r=>r.id)),conversations=new Set(p.tables.ai_conversations.map(r=>r.id));
 if(p.tables.bazi_charts.some(r=>!profiles.has(r.profile_id))||p.tables.ai_messages.some(r=>!conversations.has(r.conversation_id)))return fail();
 for(const c of p.tables.ai_conversations){try{validateConversationData(c.tool as string,c.profile_id as string|null,c.snapshot as string,JSON.parse(c.refs as string));}catch{return fail();}if(c.tool==='bazi'){const refs=JSON.parse(c.refs as string) as {recordId:string}[];const ch=p.tables.bazi_charts.find(r=>r.id===refs[0].recordId);if(ch&&ch.profile_id!==c.profile_id)return fail();}if((c.tool==='food'&&c.profile_id!==null)||(c.tool==='bazi'&&(c.profile_id===null||!profiles.has(c.profile_id))))return fail();const messages=p.tables.ai_messages.filter(r=>r.conversation_id===c.id);if(new Set(messages.map(r=>r.seq)).size!==messages.length)return fail();}
 const categories=new Set(p.tables.categories.map(r=>r.name));if(!categories.size||p.tables.items.some(r=>!categories.has(r.category)))return fail();
 const dates=new Set(p.tables.tasks.map(r=>r.date));for(const date of dates){const tasks=p.tables.tasks.filter(r=>r.date===date).sort((a,b)=>(a.sort_order as number)-(b.sort_order as number));if(new Set(tasks.map(r=>r.sort_order)).size!==tasks.length)return fail();}
 // A confirmed settlement must agree with records, not merely carry a trusted flag.
 for(const s of p.tables.food_settlements)if(s.confirmed===1&&s.stale===0){const d=p.tables.day_energy.find(r=>r.date===s.date);const meals=p.tables.meals.filter(r=>r.date===s.date);if(!d||d.metabolism===null||!meals.length||s.total!==totalConsumption(d.metabolism as number,d.expenditure as number|null)||s.intake!==round1(meals.reduce((n,r)=>n+(r.kcal as number),0)))return fail();}
 return p;
}
function validateDraft(row:Row):Record<string,unknown>{
 let value:unknown;try{value=JSON.parse(row.payload as string);}catch{return fail();}
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();
 const d=value as Record<string,unknown>,input=d.input;
 if(row.key==='ai:food'||row.key==='ai:bazi'||row.key==='ai:ideas'){if(row.date!==null||Object.keys(d).join()!=='question'||!boundedText(4000)(d.question))return fail();return d;}
 if(row.key==='bazi:editor'){if(row.date!==null||!(d.id===null||short(d.id))||!boundedText(100)(d.nickname)||Object.keys(d).sort().join()!=='id,input,nickname')return fail();try{jsonObject(input);}catch{return fail();}return d;}
 if(row.key==='template:editor'||row.key==='collection:editor'){
  if(row.date!==null||!(d.id===null||short(d.id))||Object.keys(d).sort().join()!=='id,input'||!input||typeof input!=='object'||Array.isArray(input)||(row.payload as string).length>100000)return fail();
  const fields=input as Record<string,unknown>;
  if(row.key==='collection:editor'&&Object.keys(fields).sort().join()==='body,name,source,url'){
   fields.kind=typeof fields.url==='string'&&fields.url.trim()?'link':'text';fields.account='';fields.password='';row.payload=JSON.stringify(d);
  }
  const keys=row.key==='template:editor'?['name','note']:['name','body','url','source','account','password'];
  if(Object.keys(fields).sort().join()!==(row.key==='template:editor'?'name,note,orderLevel':'account,body,kind,name,password,source,url')||keys.some(key=>typeof fields[key]!=='string'||/\u0000/.test(fields[key] as string)))return fail();
  if(row.key==='template:editor'&&!choice(1,2,3)(fields.orderLevel))return fail();
  if(row.key==='collection:editor'&&!choice('text','link','account')(fields.kind))return fail();
  return d;
 }
 if(row.key==='idea:editor'){
  if(row.date!==null||!(d.id===null||short(d.id))||!['id,input','id,input,tagInput'].includes(Object.keys(d).sort().join())||(d.tagInput!==undefined&&!boundedText(100000)(d.tagInput))||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join()!=='body,tags')return fail();
  const fields=input as Record<string,unknown>;
  if(typeof fields.body!=='string'||(row.payload as string).length>100000||/\u0000/.test(fields.body))return fail();
  // Draft text may be incomplete or exceed the formal record limit; only confirmed tags are validated here.
  try{validateIdea({body:'草稿',tags:fields.tags});}catch{return fail();}return d;
 }
 if(!input||typeof input!=='object'||Array.isArray(input)||!(d.id===null||short(d.id)))return fail();
 const fields=input as Record<string,unknown>;
 const strings=(keys:string[])=>keys.every(k=>typeof fields[k]==='string'&&(fields[k] as string).length<=100000);
 if(row.key==='meal:editor'){
  if(!isValidDate(row.date)||d.date!==row.date||!strings(['name','kcal','time','note'])||!choice('breakfast','lunch','dinner','snack')(fields.mealType)||typeof d.photoChanged!=='boolean'||!(d.photo===null||typeof d.photo==='string'))return fail();
 }else if(row.key==='task:editor'){
  if(!isValidDate(row.date)||!strings(['name','project','note'])||(fields.order!==undefined&&typeof fields.order!=='string')||(fields.priority!==undefined&&!choice('normal','important')(fields.priority))||(fields.orderLevel!==undefined&&!choice(1,2,3)(fields.orderLevel)))return fail();
 }else if(row.key==='shopping:editor'){
  if(row.date!==null||!strings(['name','note'])||Object.keys(fields).sort().join()!=='name,note'||Object.keys(d).sort().join()!=='id,input')return fail();
 }else if(row.key==='membership:editor'||row.key==='fixed:editor'){
  if(row.date!==null||!strings(['name','startDate','amount','note'])||Object.keys(fields).sort().join()!=='amount,name,note,startDate'||Object.keys(d).sort().join()!=='id,input')return fail();
 }else if(row.key==='item:editor'){
  if(row.date!==null||!strings(['name','category','purchaseDate','price','location','brand','note'])||typeof fields.unknownDate!=='boolean'||typeof fields.unknownPrice!=='boolean'||typeof d.photoChanged!=='boolean'||!(d.photo===null||typeof d.photo==='string')||!(d.originalPhoto===null||typeof d.originalPhoto==='string'))return fail();
 }else return fail();
 return d;
}
type DraftObject={row:Row;data:Record<string,unknown>};
function draftObjects(payload:Payload):DraftObject[]{return payload.tables.drafts.map(row=>({row,data:validateDraft(row)}));}
function normalizeDraftPhotos(payload:Payload,ctx:DataContext):void {
 for(const {row,data} of draftObjects(payload)){
  if(typeof data.photo==='string'){
   const name=data.photo.split('/').pop()??'';
   if(!PHOTO_NAME_RE.test(name)||ctx.photos.uri(name)!==data.photo||!ctx.photos.exists(name))throw new Error('草稿照片已失效，请重新选择照片后备份');
   data.photo=`backup-photo:${name}`;
  }
  row.payload=JSON.stringify(data);
 }
}
function photoReferences(payload:Payload):string[]{
 const refs=[...payload.tables.meals,...payload.tables.items].map(r=>r.photo).filter((p):p is string=>typeof p==='string');
 for(const {data} of draftObjects(payload)){
  if(data.photo!==undefined&&data.photo!==null){if(typeof data.photo!=='string'||!data.photo.startsWith('backup-photo:')||!PHOTO_NAME_RE.test(data.photo.slice(13)))return fail();refs.push(data.photo.slice(13));}
  if(data.originalPhoto!==undefined&&data.originalPhoto!==null){if(typeof data.originalPhoto!=='string'||!PHOTO_NAME_RE.test(data.originalPhoto))return fail();refs.push(data.originalPhoto);}
 }
 return [...new Set(refs)];
}
function imageValid(bytes:Uint8Array):boolean {return bytes.length>12&&((bytes[0]===255&&bytes[1]===216&&bytes[2]===255)||(bytes[0]===137&&strFromU8(bytes.slice(1,4))==='PNG')||(strFromU8(bytes.slice(0,4))==='RIFF'&&strFromU8(bytes.slice(8,12))==='WEBP'));}
export async function createBackup(ctx:DataContext):Promise<Uint8Array> {
 return ctx.db.transaction(async tx=>{
  const tables:Record<string,Row[]>={};for(const table of Object.keys(specs))tables[table]=await tx.all<Row>(`SELECT * FROM ${table}`);
  const payload:Payload={format:'daily-life',version:1,schema:SCHEMA_VERSION,createdAt:ctx.clock.now().toISOString(),tables};
  tables.settings=tables.settings.filter(r=>r.key!=='modelCatalog'&&r.key!=='connectionStatus');
  normalizeDraftPhotos(payload,ctx);
  validatePayload(payload,todayOf(ctx.clock));
  const entries:Record<string,Uint8Array>={'manifest.json':strToU8(JSON.stringify(payload))};
  assertArchiveBudget([{name:'manifest.json',size:entries['manifest.json'].length}]);
  for(const name of photoReferences(payload)){const b=await ctx.photos.read(name);if(b.length>MAX_PHOTO||!imageValid(b))throw new Error('照片缺失、格式无效或过大，未生成备份');entries[`photos/${name}`]=b;assertArchiveBudget(Object.entries(entries).map(([name,bytes])=>({name,size:bytes.length})));}
  const bytes=zipSync(entries,{level:6});if(bytes.length>MAX_ZIP)throw new Error('备份超过 100 MB，请减少照片后重试');return bytes;
 });
}
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes:Uint8Array):number {let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
/** fflate decompresses ZIP data but does not promise CRC verification; check it explicitly. */
function verifyArchive(bytes:Uint8Array,files:Record<string,Uint8Array>):void {
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0||view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)return fail();
 const count=view.getUint16(end+10,true);let at=view.getUint32(end+16,true);
 if(count!==Object.keys(files).length)return fail();
 for(let i=0;i<count;i++){
  if(at+46>end||view.getUint32(at,true)!==0x02014b50)return fail();
  const len=view.getUint16(at+28,true),extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true);
  if(at+46+len+extra+comment>end)return fail();
  const name=strFromU8(bytes.slice(at+46,at+46+len));const content=files[name];
  if(!content||content.length!==view.getUint32(at+24,true)||crc32(content)!==view.getUint32(at+16,true))return fail();
  at+=46+len+extra+comment;
 }
}
export function inspectBackup(bytes:Uint8Array):ValidatedBackup {
 if(bytes.length>MAX_ZIP||bytes.length<4||bytes[0]!==80||bytes[1]!==75)return fail();
 let files:Record<string,Uint8Array>;let total=0;let count=0;const entryNames=new Set<string>();
 try {files=unzipSync(bytes,{filter:file=>{if(entryNames.has(file.name))throw new Error('Duplicate entry');entryNames.add(file.name);total+=file.originalSize;count++;if(count>MAX_ENTRIES||total>MAX_EXPANDED||file.originalSize>(file.name==='manifest.json'?MAX_MANIFEST:MAX_PHOTO)||!(file.name==='manifest.json'||(file.name.startsWith('photos/')&&PHOTO_NAME_RE.test(file.name.slice(7)))))throw new Error('Invalid ZIP');return true;}});}catch{return fail();}
 try{verifyArchive(bytes,files);}catch{return fail();}
 let payload:Payload;try{payload=validatePayload(JSON.parse(strFromU8(files['manifest.json'])));}catch{return fail();}
 const photos:Record<string,Uint8Array>={};for(const [path,b] of Object.entries(files))if(path!=='manifest.json'){if(!imageValid(b))return fail();photos[path.slice(7)]=b;}
 const wanted=new Set(photoReferences(payload));
 if(Object.keys(photos).length!==wanted.size||[...wanted].some(name=>!photos[name]))return fail();
 return {payload,photos,summary:{createdAt:payload.createdAt,meals:payload.tables.meals.length,tasks:payload.tables.tasks.length,templates:payload.tables.task_templates.length,collections:payload.tables.collections.length,ideas:payload.tables.ideas.length,items:payload.tables.items.length,shopping:payload.tables.shopping_items.length,memberships:payload.tables.life_records.filter(r=>r.kind==='membership').length,fixed:payload.tables.life_records.filter(r=>r.kind==='fixed').length,drafts:payload.tables.drafts.length,photos:wanted.size,baziProfiles:payload.tables.bazi_profiles.length,aiConversations:payload.tables.ai_conversations.length||payload.tables.ai_sessions.length}};
}
export async function restoreBackup(ctx:DataContext,backup:ValidatedBackup):Promise<void> {
 // Revalidate and clone at the write boundary; callers cannot smuggle SQL columns through a preview object.
 const payload=validatePayload(JSON.parse(JSON.stringify(backup.payload)),todayOf(ctx.clock));
 const names=new Map<string,string>();const staged:string[]=[];
 try {
  for(const old of photoReferences(payload)){
   const bytes=backup.photos[old];if(!bytes||bytes.length>MAX_PHOTO||!imageValid(bytes))return fail();const name=`${newId('restored')}.${old.split('.').pop()}`;staged.push(name);await ctx.photos.write(name,bytes);names.set(old,name);
  }
  for(const row of [...payload.tables.meals,...payload.tables.items])if(typeof row.photo==='string')row.photo=names.get(row.photo)!;
  for(const {row,data} of draftObjects(payload)){
   if(typeof data.photo==='string')data.photo=ctx.photos.uri(names.get(data.photo.slice(13))!);
   if(typeof data.originalPhoto==='string')data.originalPhoto=names.get(data.originalPhoto)!;
   row.payload=JSON.stringify(data);
  }
  payload.tables.settings=payload.tables.settings.filter(r=>r.key!=='reminder');payload.tables.settings.push({key:'reminder',value:JSON.stringify({enabled:false,time:'21:30',notificationId:null})});
  await ctx.db.transaction(async tx=>{for(const table of [...Object.keys(specs)].reverse())await tx.run(`DELETE FROM ${table}`);for(const table of Object.keys(specs)){const cols=Object.keys(specs[table]);for(const row of payload.tables[table])await tx.run(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`,cols.map(k=>row[k]));}await migrateLegacyAi(tx);});
 } catch(error){for(const name of staged){try{ctx.photos.remove(name);}catch{/* Orphan is harmless; old database is untouched. */}}throw error;}
 // Old photos are deliberately retained; a failed cleanup must never make a committed restore look failed.
}
