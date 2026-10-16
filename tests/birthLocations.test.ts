import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BIRTH_LOCATIONS,FUAN_LOCATION,SELECTABLE_BIRTH_LOCATIONS,searchBirthLocations,birthLocationNote} from '../src/domain/bazi/locations.ts';
import {calculateBazi} from '../src/domain/bazi/index.ts';
import {testContext} from './helpers/sqlite.ts';
import {saveProfile,createChart,getChart,listProfiles,validateBaziInput} from '../src/data/aiRepo.ts';
import {createBackup,inspectBackup,restoreBackup} from '../src/services/backup.ts';
test('new selection is Jiangsu only, full Chinese hierarchy and spaced/separated forms match Fu’an',()=>{
 assert.equal(SELECTABLE_BIRTH_LOCATIONS.length,116);
 assert.ok(SELECTABLE_BIRTH_LOCATIONS.every(l=>l.name.startsWith('江苏省/')));
 for(const query of ['富安镇','江苏省盐城市东台市富安镇','盐城市东台市富安镇','江苏省/盐城市/东台市/富安镇','江苏 盐城 东台 富安',' 江苏省　盐城市　东台市　富安镇 '])assert.deepEqual(searchBirthLocations(query),[FUAN_LOCATION],query);
 for(const query of ['北京','上海','浙江省','浙江省盐城市东台市富安镇','江苏省盐城市东台市未收录镇','   '])assert.deepEqual(searchBirthLocations(query),[],query);
 assert.ok(searchBirthLocations('江苏省盐城市东台市').some(l=>l.id===FUAN_LOCATION.id));
 assert.ok(searchBirthLocations('江苏省盐城市东台市').some(l=>l.name==='江苏省/盐城市/东台市'));
});
test('Fu’an is its sourced town-government point, not Dongtai city longitude',()=>{
 assert.equal(FUAN_LOCATION.longitude,120.478263);
 assert.match(FUAN_LOCATION.source,/dongtai.gov.cn.*202303.*fuan-government/);
 const dongtai=BIRTH_LOCATIONS.find(l=>l.name==='江苏省/盐城市/东台市')!;
 assert.notEqual(FUAN_LOCATION.longitude,dongtai.longitude);
 assert.match(birthLocationNote(FUAN_LOCATION),/镇政府代表点/);
 const birth={calendar:'solar' as const,date:'2000-01-01',time:{kind:'clock' as const,value:'12:30'},sex:'男' as const,timeBasis:'trueSolar' as const,location:FUAN_LOCATION};
 assert.equal(calculateBazi(birth).timeConversion?.longitudeMinutes,4*(120.478263-120));
});
test('previously saved out-of-province profiles and frozen charts survive edit/backup',async()=>{
 const a=await testContext(),b=await testContext();try{
 const location=BIRTH_LOCATIONS.find(l=>l.name==='北京市')!;
 const input={calendar:'solar' as const,date:'2000-01-01',time:{kind:'clock' as const,value:'12:30'},sex:'男' as const,timeBasis:'trueSolar' as const,location};
 assert.doesNotThrow(()=>validateBaziInput(input));assert.match(birthLocationNote(location),/历史已保存地点/);
 const p=await saveProfile(a,{nickname:'合成旧外省档案',input}),result=calculateBazi(input);
 const ch=await createChart(a,{profileId:p.id,input,result:{...result},algorithmVersion:result.algorithmVersion});
 await saveProfile(a,{id:p.id,nickname:'合成改名',input});
 await restoreBackup(b,inspectBackup(await createBackup(a)));
 assert.deepEqual((await listProfiles(b.db))[0].input,input);
 assert.deepEqual((await getChart(b.db,ch.id))?.result,ch.result);
 assert.deepEqual(searchBirthLocations(location.name),[]);
 }finally{a.close();b.close();}
});
