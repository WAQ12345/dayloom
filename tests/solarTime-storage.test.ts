import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testContext} from './helpers/sqlite.ts';
import {saveProfile,createChart,createConversation,getChart,getConversation,validateBaziInput} from '../src/data/aiRepo.ts';
import {createBackup,inspectBackup,restoreBackup} from '../src/services/backup.ts';
import {calculateBazi} from '../src/domain/bazi/index.ts';
import {baziScope} from '../src/services/aiTools/index.ts';
test('time basis, longitude and DST identity, frozen old chart/AI and backup compatibility',async()=>{
 const a=await testContext(),b=await testContext();try{
 const old={calendar:'solar' as const,date:'1990-05-15',time:{kind:'clock' as const,value:'23:30'},sex:'男' as const};
 const p=await saveProfile(a,{nickname:'合成测试',input:old});
 const oldResult=calculateBazi(old),first=await createChart(a,{profileId:p.id,input:old,result:{...oldResult},algorithmVersion:'old-frozen'});
 const scope=baziScope({profileId:p.id,chartId:first.id,chartMarkdown:oldResult.markdown,algorithmVersion:'old-frozen',referenceSummary:'合成'});
 const conversation=await createConversation(a,{tool:'bazi',profileId:p.id,snapshot:scope.snapshot,refs:scope.references,promptVersion:'old-frozen'});
 const location={id:'test',name:'合成地点',longitude:87.62,source:'test'};
 const input={...old,timeBasis:'trueSolar' as const,location,dst:'standard' as const};
 const result=calculateBazi(input);const make=(x:Record<string,unknown>)=>createChart(a,{profileId:p.id,input:x,result:{...result},algorithmVersion:result.algorithmVersion});
 const c=await make(input),same=await make({...input,location:{source:'test',longitude:87.62,name:'合成地点',id:'test'}});assert.equal(c.id,same.id);
 assert.notEqual(c.id,(await make({...input,location:{...location,longitude:88}})).id);
 assert.notEqual(c.id,(await make({...input,dst:'summer'})).id);
 assert.notEqual(c.id,(await make({...input,timeBasis:'beijing'})).id);
 await saveProfile(a,{id:p.id,nickname:p.nickname,input});assert.deepEqual((await getChart(a.db,first.id))?.result,first.result);assert.equal((await getConversation(a.db,conversation.id))?.snapshot,conversation.snapshot);
 await restoreBackup(b,inspectBackup(await createBackup(a)));assert.deepEqual(await getChart(b.db,c.id),c);assert.equal((await getConversation(b.db,conversation.id))?.snapshot,conversation.snapshot);
 assert.throws(()=>validateBaziInput({...input,location:{...location,longitude:Infinity}}));assert.throws(()=>validateBaziInput({...input,time:{kind:'shichen',value:'午'}}));assert.doesNotThrow(()=>validateBaziInput(old));
 }finally{a.close();b.close();}
});
