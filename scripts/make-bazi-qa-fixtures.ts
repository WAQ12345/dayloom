/** Development only. Uses fake profiles in an in-memory SQLite database. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { testContext } from '../tests/helpers/sqlite.ts';
import { saveProfile, createChart, createConversation, appendMessage } from '../src/data/aiRepo.ts';
import { calculateBazi, formatBaziReport, type BaziInput } from '../src/domain/bazi/index.ts';
import { calculateBazi as legacy } from '../src/domain/bazi/legacy.ts';
import { createBackup, inspectBackup } from '../src/services/backup.ts';
import { baziDocument, renderMarkdown, renderHtml } from '../src/services/export/document.ts';
const out=resolve('artifacts/bazi-118');mkdirSync(out,{recursive:true});
const ctx=await testContext('2026-10-14');
const fixtures:[string,BaziInput,boolean][]=[
 ['完整示例1990',{calendar:'solar',date:'1990-06-15',time:{kind:'clock',value:'12:30'},sex:'男',place:'测试地点'},false],
 ['时辰未知示例2023',{calendar:'lunar',date:'2023-02-01',leapMonth:true,time:{kind:'unknown'},sex:'女'},false],
 ['旧版示例2000',{calendar:'solar',date:'2000-01-01',time:{kind:'clock',value:'23:00'},sex:'男'},true],
];
const expected=[];
try{
 for(const [nickname,input,isLegacy] of fixtures){
  const p=await saveProfile(ctx,{nickname,input:{...input}});
  const result=isLegacy?legacy(input,ctx.clock.now()):calculateBazi(input,ctx.clock.now());
  if(!isLegacy){const c=result as ReturnType<typeof calculateBazi>;c.profileNickname=nickname;c.markdown=formatBaziReport(c);}
  const chart=await createChart(ctx,{profileId:p.id,input:{...input},result:{...result},algorithmVersion:result.algorithmVersion});
  expected.push({nickname,profileId:p.id,chartId:chart.id,algorithmVersion:result.algorithmVersion,pillars:Object.fromEntries(Object.entries(result.pillars).map(([k,v])=>[k,v.label])),professional:'professional' in result?result.professional:null,chartMarkdown:result.markdown});
  const document=baziDocument(result,ctx.clock.now());writeFileSync(`${out}/${isLegacy?'legacy':nickname.startsWith('完整')?'full':'unknown'}.md`,renderMarkdown(document));writeFileSync(`${out}/${isLegacy?'legacy':nickname.startsWith('完整')?'full':'unknown'}.html`,renderHtml(document));
  if(isLegacy){const c=await createConversation(ctx,{tool:'bazi',profileId:p.id,snapshot:JSON.stringify({chart:result.markdown,algorithmVersion:result.algorithmVersion,referenceSummary:'测试资料，非真人'}),refs:[{ref:'B1',kind:'bazi',recordId:chart.id,label:'旧版示例命盘',summary:result.markdown}],promptVersion:'qa-frozen-old-v1'});await appendMessage(ctx,{conversationId:c.id,role:'user',content:'测试用历史问题',settings:{model:'fixture-only'},status:'success'});await appendMessage(ctx,{conversationId:c.id,role:'assistant',content:'这是测试用旧AI快照；恢复后应原样保留，命盘导出不含本段。',settings:{model:'fixture-only'},status:'success'});}
 }
 const bytes=await createBackup(ctx),checked=inspectBackup(bytes);writeFileSync(`${out}/qa-bazi-fixtures.zip`,bytes);writeFileSync(`${out}/qa-expected.json`,JSON.stringify({summary:checked.summary,fixtures:expected},null,2)+'\n');console.log(JSON.stringify({path:`${out}/qa-bazi-fixtures.zip`,bytes:bytes.length,summary:checked.summary}));
}finally{ctx.close();}
