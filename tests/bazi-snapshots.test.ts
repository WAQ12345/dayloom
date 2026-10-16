import test from 'node:test';
import assert from 'node:assert/strict';
import { testContext } from './helpers/sqlite.ts';
import { saveProfile, createChart, createConversation, appendMessage, getChart, getConversation, listCharts, listMessages } from '../src/data/aiRepo.ts';
import { calculateBazi, formatBaziReport, type BaziInput } from '../src/domain/bazi/index.ts';
import { calculateBazi as legacy } from '../src/domain/bazi/legacy.ts';
import { NOTES } from '../src/domain/bazi/explanations.ts';
import { createBackup, inspectBackup, restoreBackup } from '../src/services/backup.ts';
import { baziDocument, renderHtml, renderMarkdown } from '../src/services/export/document.ts';
const input:BaziInput={calendar:'solar',date:'1990-06-15',time:{kind:'clock',value:'12:30'},sex:'男'};
const now=new Date('2026-10-14T04:00:00Z');
const record=(profileId:string,birth=input)=>{const result=calculateBazi(birth,now);result.profileNickname='测试资料快照';result.markdown=formatBaziReport(result);return{profileId,input:{...birth},result:{...result},algorithmVersion:result.algorithmVersion};};

test('concurrent repeat calculations reuse input+algorithm+rules; nickname alone preserves the snapshot',async()=>{
 const ctx=await testContext();try{
  const p=await saveProfile(ctx,{nickname:'示例',input:{...input}}),value=record(p.id);
  const rows=await Promise.all(Array.from({length:8},()=>createChart(ctx,value)));assert.equal(new Set(rows.map(r=>r.id)).size,1);assert.equal((await listCharts(ctx.db,p.id)).length,1);
  const normalized=await createChart(ctx,{...value,input:{sex:'男',place:'   ',time:{value:'12:30',kind:'clock'},date:input.date,calendar:'solar',leapMonth:false}});assert.equal(normalized.id,rows[0].id);
  await saveProfile(ctx,{id:p.id,nickname:'改名',input:{...input}});
  const renamed=await createChart(ctx,{...value,result:{...value.result,profileNickname:'改名'}});assert.equal(renamed.id,rows[0].id);assert.equal(renamed.result.profileNickname,'测试资料快照');
  const changedRules=await createChart(ctx,{...value,result:{...value.result,ruleVersion:'future-rules'}});assert.notEqual(changedRules.id,rows[0].id);
  const changedAlgorithm=await createChart(ctx,{...value,algorithmVersion:'future-algorithm'});assert.notEqual(changedAlgorithm.id,rows[0].id);
 }finally{ctx.close();}
});
test('editing birth creates a new version without rewriting chart or AI history',async()=>{
 const ctx=await testContext();try{
  const p=await saveProfile(ctx,{nickname:'示例',input:{...input}}),old=await createChart(ctx,record(p.id));
  const snapshot=JSON.stringify({chart:old.result.markdown,algorithmVersion:old.algorithmVersion,referenceSummary:'测试摘要'});
  const c=await createConversation(ctx,{tool:'bazi',profileId:p.id,snapshot,refs:[{ref:'B1',kind:'bazi',recordId:old.id,label:'保存时命盘',summary:old.result.markdown}],promptVersion:'saved-v1'});
  await appendMessage(ctx,{conversationId:c.id,role:'assistant',content:'冻结的旧AI回答',settings:{model:'test'},status:'success'});
  const updated={...input,date:'1990-06-16'};await saveProfile(ctx,{id:p.id,nickname:'新资料',input:updated});
  const next=await createChart(ctx,record(p.id,updated));assert.notEqual(next.id,old.id);assert.deepEqual(await getChart(ctx.db,old.id),old);assert.equal((await getConversation(ctx.db,c.id))?.snapshot,snapshot);assert.equal((await listMessages(ctx.db,c.id))[0].content,'冻结的旧AI回答');
  assert.equal((await createChart(ctx,record(p.id))).id,old.id);
 }finally{ctx.close();}
});
test('old and new charts and AI snapshots survive ZIP and full exports without recalculation',async()=>{
 const a=await testContext(),b=await testContext();try{
  const p=await saveProfile(a,{nickname:'仅供测试',input:{...input}}),oldResult=legacy(input,now);
  const old=await createChart(a,{profileId:p.id,input:{...input},result:{...oldResult},algorithmVersion:oldResult.algorithmVersion});
  const fresh=await createChart(a,record(p.id));const frozen={old:old.result.markdown,fresh:fresh.result.markdown};
  const ai='只属于AI历史，不得进入命盘导出';const c=await createConversation(a,{tool:'bazi',profileId:p.id,snapshot:JSON.stringify({chart:old.result.markdown,algorithmVersion:old.algorithmVersion,referenceSummary:'旧摘要'}),refs:[{ref:'B1',kind:'bazi',recordId:old.id,label:'旧命盘',summary:old.result.markdown}],promptVersion:'legacy-v1'});await appendMessage(a,{conversationId:c.id,role:'assistant',content:ai,settings:{model:'test'},status:'success'});
  await restoreBackup(b,inspectBackup(await createBackup(a)));
  assert.deepEqual((await getChart(b.db,old.id))?.result,old.result);assert.deepEqual((await getChart(b.db,fresh.id))?.result,fresh.result);
  assert.equal((await getChart(b.db,old.id))?.result.markdown,frozen.old);assert.equal((await getChart(b.db,fresh.id))?.result.markdown,frozen.fresh);assert.equal((await listMessages(b.db,c.id))[0].content,ai);
  const oldExport=renderMarkdown(baziDocument(oldResult,now));assert.ok(!oldExport.includes(NOTES.professional));assert.ok(!oldExport.includes('胎元：'));
  const result=record(p.id).result,document=baziDocument(result,now),md=renderMarkdown(document),html=renderHtml(document);
  for(const value of Object.values(result.explanationNotes??NOTES)){assert.ok(md.includes(value));assert.ok(html.includes(value));}assert.match(md,/昵称：测试资料快照/);assert.ok(!md.includes(ai)&&!html.includes(ai));
  assert.equal(document.blocks.filter(x=>x.kind==='table').length,result.cycles!.length+1);assert.ok(md.includes('起运前'));
  result.markdown='后续修改';assert.ok(!renderMarkdown(document).includes('后续修改'));
 }finally{a.close();b.close();}
});
test('history pagination has stable rows, rejects invalid requests and does not recalculate',async()=>{
 const ctx=await testContext();try{
  const p=await saveProfile(ctx,{nickname:'分页测试',input:{...input}});
  for(let n=0;n<25;n++)await createChart(ctx,{profileId:p.id,input:{...input},result:{markdown:`原文${n}`,ruleVersion:String(n)},algorithmVersion:'fixture-only'});
  const all=await listCharts(ctx.db,p.id),first=await listCharts(ctx.db,p.id,20),last=await listCharts(ctx.db,p.id,20,20);assert.deepEqual([...first,...last],all);assert.equal(first.length,20);assert.equal(last.length,5);
  await assert.rejects(listCharts(ctx.db,p.id,0));await assert.rejects(listCharts(ctx.db,p.id,20,-1));
 }finally{ctx.close();}
});
