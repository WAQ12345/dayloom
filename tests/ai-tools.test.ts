import test from 'node:test';
import assert from 'node:assert/strict';
import { foodScope,baziScope,prepareTurn,inspectAnswer } from '../src/services/aiTools/index.ts';
import { createAiPreview } from '../src/services/ai.ts';
const config={model:'deepseek-flash',thinking:'high' as const,maxOutputTokens:8192,timeoutSeconds:180};
const capability={id:'deepseek-flash',name:'Flash',contextWindow:1048576,maxOutputTokens:393216,thinking:['off','low','high','max'] as ('off'|'low'|'high'|'max')[]};
const scope=foodScope(createAiPreview({question:'总结',includeFood:false,meals:[],water:[],selectedIds:[],from:'2026-10-13',to:'2026-10-13'}));
test('preview freezes configuration, selected records and exact messages independently of subsequent edits',()=>{
 const c={...config};const p=prepareTurn({question:'总结',scope,config:c,capability,history:[]});c.model='changed';assert.equal(p.config.model,'deepseek-flash');assert.ok(Object.isFrozen(p.config));assert.ok(Object.isFrozen(p.messages));assert.ok(Object.isFrozen(p.scope.references));assert.equal(p.messages.at(-1)?.content,'总结');assert.equal(p.scope.references.length,0);
});
test('follow-up carries only successful pairs in the same explicit scope, never failed/partial replies',()=>{
 const p=prepareTurn({question:'追问',scope,config,capability,history:[{role:'user',content:'first',status:'success'},{role:'assistant',content:'partial',status:'cancelled'},{role:'user',content:'second',status:'success'},{role:'assistant',content:'complete',status:'success'}]});
 assert.equal(p.historyCount,2);assert.ok(!p.messages.some(m=>m.content==='partial'||m.content==='first'));assert.equal(p.messages[2].content,'second');assert.equal(p.messages[3].content,'complete');
});
test('tool scopes reject foreign record kinds and profile crossover',()=>{
 assert.throws(()=>prepareTurn({question:'q',scope:{...scope,profileId:'b'},config,capability,history:[]}),/授权范围/);
 assert.throws(()=>prepareTurn({question:'q',scope:{...scope,references:[{ref:'R1',recordId:'1',label:'x',summary:'x',kind:'task'}]},config,capability,history:[]}),/授权范围/);
 const b=baziScope({profileId:'b',chartId:'c',chartMarkdown:'庚辰',algorithmVersion:'v1',referenceSummary:'摘要'});const p=prepareTurn({question:'解释',scope:b,config,capability,history:[]});assert.equal(p.scope.references[0].ref,'B1');assert.ok(!p.messages[0].content.includes('饮食记录助手'));
});
test('overflow never silently truncates context; model mismatch and old prompt require a new preview',()=>{
 assert.throws(()=>prepareTurn({question:'q',scope,config,capability:{...capability,contextWindow:100},history:[]}),/过长/);
 assert.throws(()=>prepareTurn({question:'q',scope,config:{...config,model:'x'},capability,history:[]}),/不一致/);
 assert.throws(()=>prepareTurn({question:'q',scope:{...scope,promptVersion:'old'},config,capability,history:[]}),/旧版/);
});
test('format warnings preserve original answer and out-of-scope references are invalid',()=>{
 const original='不完整 [R99] [B1]';const result=inspectAnswer('food',original,[]);assert.ok(result.warning);assert.ok(result.citations.every(c=>!c.valid));assert.equal(original,'不完整 [R99] [B1]');
});
