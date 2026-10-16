/** Development only: isolated in-memory database, never reads the installed app or user files. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { testContext } from '../tests/helpers/sqlite.ts';
import { createIdea, updateIdea, deleteIdea, listIdeas } from '../src/data/ideaRepo.ts';
import { createConversation, appendMessage } from '../src/data/aiRepo.ts';
import { ideaScope } from '../src/services/aiTools/index.ts';
import { saveDraft } from '../src/data/draftRepo.ts';
import { createBackup, inspectBackup } from '../src/services/backup.ts';
import { ideasDocument, renderMarkdown, renderHtml } from '../src/services/export/document.ts';
const out=resolve('artifacts/ideas');mkdirSync(out,{recursive:true});
const ctx=await testContext('2026-10-10');
try{
 const simple=await createIdea(ctx,{body:'清晨想到：把每天的零碎灵感记下来。💡\n晚上再回看，找到值得继续的一件事。',tags:['生活','灵感']});
 ctx.setDate('2026-10-11');
 const markdown=await createIdea(ctx,{body:'## 周末的小计划\n\n- 带一本**纸书**去公园\n- 记录三种树叶 🍂\n\n| 观察 | 感受 |\n| --- | --- |\n| 风声 | 慢下来 |\n\n`先记录，再整理`\n\n<script>这只是原文，不能执行</script>',tags:['周末','多行Markdown']});
 ctx.setDate('2026-10-12');
 const long=await createIdea(ctx,{body:Array.from({length:260},(_,i)=>`第${i+1}段：这是隔离测试用的长篇想法。让正文自然换行与分页，核对末段、中文、标点和 emoji 🌱 都完整保留；不包含任何真实资料。`).join('\n\n'),tags:['长文','分页']});
 ctx.setDate('2026-10-15');
 const conversations:{id:string;kind:string;sourceId:string;snapshot:string;references:ReturnType<typeof ideaScope>['references'];mock:boolean;realModelCall:boolean}[]=[];
 const addMockConversation=async(idea:typeof simple,kind:string)=>{
  const scope=ideaScope([idea]);const conversation=await createConversation(ctx,{tool:'ideas',snapshot:scope.snapshot,refs:scope.references,promptVersion:scope.promptVersion});
  await appendMessage(ctx,{conversationId:conversation.id,role:'user',content:'QA合成问题：请整理这条测试想法。此会话仅用于离线验收。',settings:{model:'qa-synthetic-no-provider',qaSynthetic:true},status:'success'});
  await appendMessage(ctx,{conversationId:conversation.id,role:'assistant',content:'QA合成回答，非模型返回。未调用任何模型或读取API Key。\n\n## 主题归纳\n记录零碎灵感，仅依据冻结测试资料 [I1]。\n\n## 关联与启发\n这是人工写入的隔离验收文本。\n\n## 可行动建议\n无真实执行动作。\n\n## 待澄清问题\n核对历史快照不会跟随原文改变；源删除后仍可回看。',settings:{model:'qa-synthetic-no-provider',qaSynthetic:true},status:'success'});
  conversations.push({id:conversation.id,kind,sourceId:idea.id,snapshot:scope.snapshot,references:scope.references,mock:true,realModelCall:false});
 };
 await addMockConversation(simple,'原记录已修改，历史仍为修改前快照');
 const temporary=await createIdea(ctx,{body:'QA合成已删除源：这条临时想法只用于检验历史依据保留，不进入最终三条列表或想法导出。',tags:['QA删除源']});
 await addMockConversation(temporary,'原记录已删除，历史快照保留');
 await deleteIdea(ctx,temporary.id);

 await updateIdea(ctx,simple.id,{body:simple.body+'\n\n后来补充：编写时间保持最初那天，修改时间应单独显示。',tags:simple.tags});
 await saveDraft(ctx,'idea:editor',null,{id:null,input:{body:'这是尚未保存的测试草稿',tags:['草稿']},tagInput:'尚未确认的临时标签'.repeat(4)});
 const ideas=await listIdeas(ctx.db,{limit:100});const doc=ideasDocument(ideas,ctx.clock.now());
 const bytes=await createBackup(ctx),checked=inspectBackup(bytes);
 writeFileSync(`${out}/qa-ideas-fixtures.zip`,bytes);writeFileSync(`${out}/ideas.md`,renderMarkdown(doc));writeFileSync(`${out}/ideas.html`,renderHtml(doc));
 writeFileSync(`${out}/expected.json`,JSON.stringify({isolatedFixture:true,realModelCall:false,conversations,deletedSourceId:temporary.id,aiSendAcceptance:'NOT RUN：真实AI发送未验，mock消息不是模型返回',summary:checked.summary,order:ideas.map(i=>i.id),ideas,ids:{simple:simple.id,markdown:markdown.id,long:long.id},assertions:['编写时间倒序，编辑不改变编写时间','仅编辑过的记录显示修改时间','正文末段第260段存在','Markdown正文、emoji和标签完整','HTML不执行script','草稿临时标签不进入正式标签','想法正文导出只有3条，不能包含QA合成问题或QA合成回答','分析历史有2个合成会话，每个1个user和1个assistant消息','simple历史依据保留修改前正文；临时源记录删除但依据可阅并标原记录已删除','真实模型发送NOT RUN；mock成功状态仅用于历史UI测试','此ZIP仅用于隔离QA环境，勿恢复到真实资料环境']},null,2)+'\n');
 console.log(JSON.stringify({out,bytes:bytes.length,ideas:ideas.length,summary:checked.summary}));
}finally{ctx.close();}
