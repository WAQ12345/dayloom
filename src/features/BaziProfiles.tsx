import { BirthLocationField } from '../ui/BirthLocationField';
import { needsDstConfirmation, type BirthLocation, type DstChoice, type TimeBasis } from '../domain/bazi/birthTime';
import { lunarToSolar } from '../domain/bazi';
import { DateField, TimeField } from '../ui/DateTimeField';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Text } from 'react-native';
import { Button, Card, Choice, Field, Row, Screen, C, useAction } from '../ui/kit';
import { useApp } from '../ui/context';
import { useConfirm } from '../ui/confirm';
import { BaziChartView } from './BaziChartView';
import { calculateBazi, formatBaziReport, type BaziInput, type BaziChart as CalculatedChart, BAZI_REFERENCE_SUMMARY } from '../domain/bazi';
import { listProfiles, saveProfile, deleteProfile, createChart, listCharts, type BaziChart as StoredChart, type BaziProfile } from '../data/aiRepo';
import { baziScope, type ToolScope } from '../services/aiTools';

type Form={id?:string;nickname:string;calendar:'solar'|'lunar';date:string;leapMonth:boolean;timeKind:'clock'|'shichen'|'unknown';time:string;sex:'男'|'女';place:string;timeBasis:TimeBasis;location?:BirthLocation;dst?:DstChoice};
const empty:Form={nickname:'',calendar:'solar',date:'',leapMonth:false,timeKind:'unknown',time:'',sex:'男',place:'',timeBasis:'trueSolar'};
export function BaziProfiles({onAnalyze}:{onAnalyze:(scope:ToolScope)=>void}){
 const {ctx,revision,today}=useApp();const confirm=useConfirm();const {busy,error,setError,run}=useAction();
 const [profiles,setProfiles]=useState<BaziProfile[]>([]),[form,setForm]=useState<Form|null>(null),[chart,setChart]=useState<{profile:BaziProfile;result:CalculatedChart;id:string}|null>(null);
 const [history,setHistory]=useState<{profile:BaziProfile;rows:StoredChart[];hasMore:boolean}|null>(null);
 const saveLock=useRef(false);
 const reload=useCallback(async()=>setProfiles(await listProfiles(ctx.db)),[ctx]);
 useEffect(()=>{let live=true;void listProfiles(ctx.db).then(rows=>{if(live)setProfiles(rows);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[ctx,revision,setError]);
 const edit=(p?:BaziProfile)=>{setError('');if(!p){setForm({...empty});return;}const x=p.input as unknown as BaziInput;setForm({id:p.id,nickname:p.nickname,calendar:x.calendar,date:x.date,leapMonth:!!x.leapMonth,timeKind:x.time.kind,time:x.time.kind==='unknown'?'':x.time.value,sex:x.sex,place:x.place??'',timeBasis:x.timeBasis??'beijing',location:x.location,dst:x.dst});};
 const update=(next:Partial<Form>)=>setForm(f=>f?{...f,...next}:null);
 let dstRequired=false;try{if(form)dstRequired=needsDstConfirmation(form.calendar==='lunar'?lunarToSolar(form.date,form.leapMonth):form.date);}catch{}
 const close=async()=>{if(busy)return;if(await confirm({title:'离开出生资料编辑？',message:'尚未保存的修改将丢弃。',confirmText:'丢弃修改'}))setForm(null);};
 const save=()=>void run(async()=>{if(!form||saveLock.current)return;saveLock.current=true;try{const input:BaziInput={calendar:form.calendar,date:form.date.trim(),leapMonth:form.calendar==='lunar'&&form.leapMonth,time:form.timeKind==='unknown'?{kind:'unknown'}:{kind:form.timeKind,value:form.time.trim()},sex:form.sex,place:form.location?.name??form.place.trim(),timeBasis:form.timeBasis,location:form.location,dst:form.dst};calculateBazi(input,ctx.clock.now());await saveProfile(ctx,{id:form.id,nickname:form.nickname.trim(),input:{...input}});await reload();setForm(null);}finally{saveLock.current=false;}});
 const generate=(p:BaziProfile)=>void run(async()=>{const result=calculateBazi(p.input as unknown as BaziInput,ctx.clock.now());result.profileNickname=p.nickname;result.markdown=formatBaziReport(result);const saved=await createChart(ctx,{profileId:p.id,input:p.input,result:result as unknown as Record<string,unknown>,algorithmVersion:result.algorithmVersion});setChart({profile:p,result:saved.result as unknown as CalculatedChart,id:saved.id});});
 return <>
  <Row><Text style={{flex:1,fontSize:17,color:C.text,fontWeight:'600'}}>出生档案</Text><Button title="添加" secondary onPress={()=>edit()} disabled={busy}/></Row>
  {!!error&&<Text accessibilityRole="alert" style={{color:C.accent}}>{error}</Text>}
  {profiles.map(p=><Card key={p.id}><Text style={{fontSize:17,fontWeight:'600',color:C.text}}>{p.nickname}</Text><Text style={{color:C.muted,fontSize:12}}>{String(p.input.date)} · {p.input.calendar==='lunar'?'农历':'公历'} · {String(p.input.sex)}</Text><Row><Button title="查看命盘" onPress={()=>generate(p)} disabled={busy}/><Button title="历史命盘" secondary disabled={busy} onPress={()=>void run(async()=>{const rows=await listCharts(ctx.db,p.id,21);setHistory({profile:p,rows:rows.slice(0,20),hasMore:rows.length>20});})}/><Button title="编辑" secondary disabled={busy} onPress={()=>edit(p)}/><Button title="删除" secondary disabled={busy} onPress={()=>void run(async()=>{if(await confirm({title:`删除「${p.nickname}」？`,message:'同时删除该档案的命盘及解读记录。'})){await deleteProfile(ctx,p.id);await reload();}})}/></Row></Card>)}
  <Modal visible={!!form} animationType="fade" onRequestClose={()=>void close()}>{form&&<Screen title={form.id?'编辑出生资料':'添加出生资料'} action={<Button title="返回" secondary onPress={()=>void close()}/>}>
   <Field label="昵称" value={form.nickname} onChangeText={nickname=>update({nickname})}/>
   <Row><Choice title="公历" selected={form.calendar==='solar'} onPress={()=>{if(form.calendar!=='solar')update({calendar:'solar',leapMonth:false,date:''});}}/><Choice title="农历" selected={form.calendar==='lunar'} onPress={()=>{if(form.calendar!=='lunar')update({calendar:'lunar',leapMonth:false,date:''});}}/></Row>
   <DateField label="出生日期" value={form.date} calendar={form.calendar} leap={form.leapMonth} max={today} onChange={(date,leapMonth)=>update({date,leapMonth,dst:undefined})}/>
   <Row>{(['clock','shichen','unknown'] as const).map((k,i)=><Choice key={k} title={['具体时间','时辰','不确定'][i]} selected={form.timeKind===k} onPress={()=>update({timeKind:k,time:k==='shichen'?'午':'',dst:undefined})}/>)}</Row>
   {form.timeKind==='clock'&&<TimeField label="原始出生钟表（北京时间）" value={form.time} onChange={time=>update({time,dst:undefined})}/>}
   {form.timeKind==='shichen'&&<Row>{[...'子丑寅卯辰巳午未申酉戌亥'].map(t=><Choice key={t} title={t} selected={form.time===t} onPress={()=>update({time:t})}/>)}</Row>}
   <Text style={{color:C.text,fontSize:14}}>排盘所用性别</Text><Row>{(['男','女'] as const).map(sex=><Choice key={sex} title={sex} selected={form.sex===sex} onPress={()=>update({sex})}/>)}</Row>
   <Text style={{color:C.text}}>日时柱所用时间</Text><Row><Choice title="真太阳时" selected={form.timeBasis==='trueSolar'} onPress={()=>update({timeBasis:'trueSolar'})}/><Choice title="北京时间" selected={form.timeBasis==='beijing'} onPress={()=>update({timeBasis:'beijing'})}/></Row>
   <BirthLocationField value={form.location} onChange={location=>update({location,place:location?.name??''})}/>
   {form.timeBasis==='beijing'&&!form.location&&<Field label="出生地备注（选填）" value={form.place} onChangeText={place=>update({place})}/>}
   {form.timeBasis==='trueSolar'&&<Text style={{color:C.muted,fontSize:12,lineHeight:20}}>{form.timeKind==='unknown'?'时间未知：保存待定口径，不换算分钟、不推断时柱。':'需具体出生时间和地点；仅知道时辰请补充时间或改用北京时间。'} 年月节气和起运按绝对出生瞬间，日时柱按真太阳时，23点换日。地点为代表点估算。</Text>}
   {dstRequired&&form.timeKind==='clock'&&<><Text style={{color:C.text}}>历史夏令时：确认原始钟表</Text><Row><Choice title="已转标准北京时间" selected={form.dst==='standard'} onPress={()=>update({dst:'standard'})}/><Choice title="当时夏令钟表（减1小时）" selected={form.dst==='summer'} onPress={()=>update({dst:'summer'})}/></Row><Text style={{color:C.muted,fontSize:12,lineHeight:20}}>结束日01:00—01:59出现两次：第一次选夏令，第二次选标准。春季跳时02:00—02:59不是有效夏令钟表。已经校正过的时间不重复扣减。</Text></>}

   {!!error&&<Text accessibilityRole="alert" style={{color:C.accent}}>{error}</Text>}<Button title={busy?'保存中…':'保存资料'} onPress={save} disabled={busy}/>
  </Screen>}</Modal>
  <Modal visible={!!history} animationType="fade" onRequestClose={()=>setHistory(null)}>{history&&<Screen title={`${history.profile.nickname}的历史命盘`} action={<Button title="返回" secondary onPress={()=>setHistory(null)}/>}>
   {!history.rows.length&&<Text style={{color:C.muted}}>暂无历史命盘</Text>}
   {history.rows.map(row=><Card key={row.id}><Text style={{color:C.text}}>{String(row.input.date)} · {row.input.calendar==='lunar'?'农历':'公历'} · {String(row.input.sex)}</Text><Text style={{color:C.muted,fontSize:12,lineHeight:19}}>{row.algorithmVersion}</Text><Button title="查看" secondary onPress={()=>{setChart({profile:history.profile,result:row.result as unknown as CalculatedChart,id:row.id});setHistory(null);}}/></Card>)}
   {history.hasMore&&<Button title={busy?'读取中…':'加载更多'} secondary disabled={busy} onPress={()=>void run(async()=>{const rows=await listCharts(ctx.db,history.profile.id,21,history.rows.length);setHistory({...history,rows:[...history.rows,...rows.slice(0,20)],hasMore:rows.length>20});})}/>}
  </Screen>}</Modal>
  <Modal visible={!!chart} animationType="fade" onRequestClose={()=>setChart(null)}>{chart&&<Screen title={`${chart.result.profileNickname??chart.profile.nickname}的命盘`} action={<Button title="返回" secondary onPress={()=>setChart(null)}/>}>

   <Button title="解读此命盘" onPress={()=>{const scope=baziScope({profileId:chart.profile.id,chartId:chart.id,chartMarkdown:chart.result.markdown,algorithmVersion:chart.result.algorithmVersion,referenceSummary:BAZI_REFERENCE_SUMMARY});setChart(null);onAnalyze(scope);}}/>
   <BaziChartView key={chart.id} chart={chart.result} now={ctx.clock.now()}/>
  </Screen>}</Modal>
 </>;
}
