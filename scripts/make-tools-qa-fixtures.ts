/** Development only: isolated in-memory SQLite fixtures; never reads or restores installed app data. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { localDate,shiftDate } from '../src/domain/dates.ts';
import { testContext } from '../tests/helpers/sqlite.ts';
import { createTemplate,listTemplates } from '../src/data/templateRepo.ts';
import { createCollection,listCollections,getCollection } from '../src/data/collectionRepo.ts';
import { createIdea,listIdeas } from '../src/data/ideaRepo.ts';
import { createTask,listTasks } from '../src/data/taskRepo.ts';
import { createBackup,inspectBackup,restoreBackup } from '../src/services/backup.ts';
const generatedAt=new Date(),today=localDate(generatedAt),yesterday=shiftDate(today,-1);
const out=resolve('artifacts/tools');mkdirSync(out,{recursive:true});
const ctx=await testContext(yesterday),readback=await testContext(today);
try{
 const history=await createTask(ctx,yesterday,{name:'QA 昨日计划：整理读书笔记',note:'用于验证历史计划的保存为模板入口，不修改历史任务。',orderLevel:2,project:''});
 ctx.setDate(today);
 const taskOne=await createTask(ctx,today,{name:'QA 今日计划：阅读二十分钟',note:'从今日任务保存为模板，核对名称、备注和红旗次序。',orderLevel:1,project:''});
 const taskTwo=await createTask(ctx,today,{name:'QA 今日计划：清理书桌',note:'从今日任务保存为模板，核对绿旗次序。',orderLevel:3,project:''});
 const templateOne=await createTemplate(ctx,{name:'QA 模板：晨间阅读',note:'这是模板原始备注。生成今日计划后，修改模板不应修改已生成的计划。',orderLevel:1});
 const templateTwo=await createTemplate(ctx,{name:'QA 模板：晚间整理',note:'核对批量加入、绿旗次序与重复加入产生独立任务。',orderLevel:3});
 const link=await createCollection(ctx,{kind:'link',account:'',password:'',name:'',body:'',url:'https://example.com',source:''});
 const longBody=Array.from({length:100},(_,index)=>`第${index+1}段：这是隔离 QA 用的中文收藏正文，核对完整换行、滚动、复制和再次粘贴。收藏只保存文字与链接，不抓取网页，不包含真实资料。🌱`).join('\n\n')+'\n\n收藏正文末尾标记：TOOLS-QA-END。';
 const article=await createCollection(ctx,{kind:'text',account:'',password:'',name:'QA 长文收藏：读书时的摘录',body:longBody,url:'',source:'QA 手工合成书摘'});
 const account=await createCollection(ctx,{kind:'account',name:'QA 合成账号平台',body:'仅供隔离测试，无真实凭证。',url:'https://example.com/login',source:'QA 手工合成',account:'qa-user@example.invalid',password:' QA-only dummy 123! \n'});
 const idea=await createIdea(ctx,{body:'QA 想法：把有价值的段落先收藏，再用自己的话整理。\n\n复制粘贴核对：中文、换行、emoji 💡 和标点都应保留。\n末尾标记：TOOLS-QA-IDEA-END。',tags:['QA','复制粘贴']});
 const templates=await listTemplates(ctx.db,{limit:100}),collections=await listCollections(ctx.db,{limit:100}),ideas=await listIdeas(ctx.db,{limit:100}),todayTasks=await listTasks(ctx.db,today),historyTasks=await listTasks(ctx.db,yesterday);
 const bytes=await createBackup(ctx),checked=inspectBackup(bytes);
 assert.equal(checked.summary.templates,2);assert.equal(checked.summary.collections,3);assert.equal(checked.summary.ideas,1);assert.equal(checked.summary.tasks,3);assert.equal(checked.summary.drafts,0);
 await restoreBackup(readback,checked);
 assert.deepEqual(await listTemplates(readback.db,{limit:100}),templates);assert.deepEqual(await listCollections(readback.db,{limit:100}),collections);assert.deepEqual(await getCollection(readback.db,account.id),account);assert.equal(checked.payload.tables.collections.find(row=>row.id===account.id)?.password,account.password);assert.deepEqual(await listIdeas(readback.db,{limit:100}),ideas);assert.deepEqual(await listTasks(readback.db,today),todayTasks);assert.deepEqual(await listTasks(readback.db,yesterday),historyTasks);
 const zipPath=resolve(out,'qa-tools.zip'),expectedPath=resolve(out,'expected.json');writeFileSync(zipPath,bytes);
 writeFileSync(expectedPath,JSON.stringify({isolatedFixture:true,generatedAt:generatedAt.toISOString(),today,yesterday,schema:checked.payload.schema,zipSha256:createHash('sha256').update(bytes).digest('hex'),zipBytes:bytes.length,roundtrip:'PASS: isolated in-memory database only',realModelCall:false,phoneAccess:false,installedAppRestore:false,summary:checked.summary,ids:{templateOne:templateOne.id,templateTwo:templateTwo.id,link:link.id,article:article.id,account:account.id,idea:idea.id,taskOne:taskOne.id,taskTwo:taskTwo.id,history:history.id},templates,collections,syntheticAccountRecord:account,ideas,todayTasks,historyTasks,assertions:['模板列表2条、红旗1和绿旗3，模板名称及备注完整','批量加入今日后原有2条任务保留，新增2条独立待办，同级追加','重复加入允许再新增独立待办，不修改模板或原有任务','修改或删除模板不连带修改已生成计划','今日计划可另存模板，昨日历史计划只读且另存行为由入口权限决定','收藏列表3条：QA合成账号、无名称纯链接 https://example.com，以及有名称中文长正文和来源','长正文存在第100段及TOOLS-QA-END，复制后粘贴内容完整','QA账号密码为合成占位字符串，仅getCollection详情与普通ZIP含明文，列表数据不返回密码',
'1条想法用于复制粘贴，末尾TOOLS-QA-IDEA-END存在','无草稿，恢复后不会自动弹编辑窗口','此ZIP仅用于隔离QA包，勿恢复到正式真实资料环境']},null,2)+'\n');
 console.log(JSON.stringify({zipPath,expectedPath,today,yesterday,bytes:bytes.length,summary:checked.summary,roundtrip:'PASS'}));
}finally{ctx.close();readback.close();}
