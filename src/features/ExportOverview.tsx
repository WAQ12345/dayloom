import React, { useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { MotionSection } from '../ui/MotionSection';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Choice, Field, Note, Row, Screen, useAction } from '../ui/kit';
import { DateField } from '../ui/DateTimeField';
import { ExportPanel } from '../ui/ExportPanel';
import { useApp } from '../ui/context';
import { listMealsInRange, loadEnergyData, listFoodSettlements } from '../data/foodRepo';
import { listWaterInRange } from '../data/waterRepo';
import { listItems, listCategories } from '../data/itemRepo';
import { listProfiles, listCharts, getChart, type BaziProfile, type BaziChart as SavedChart } from '../data/aiRepo';
import type { BaziChart } from '../domain/bazi';
import { IdeaSelection } from '../ui/IdeaSelection';
import { getIdea } from '../data/ideaRepo';
import { foodRangeDocument, itemsDocument, baziDocument, ideasDocument, type ExportDocument } from '../services/export/document';
export default function ExportOverview(){
 const params=useLocalSearchParams<{kind?:string;ideaId?:string}>();
 const {ctx,today}=useApp();const {busy,error,setError,run}=useAction();
 const [kind,setKind]=useState<'food'|'bazi'|'items'|'ideas'>(params.kind==='ideas'?'ideas':'food'),[from,setFrom]=useState(today),[to,setTo]=useState(today),[exportBusy,setExportBusy]=useState(false),[query,setQuery]=useState(''),[category,setCategory]=useState<string|null>(null),[sort,setSort]=useState('recent');
 const [selectedIdeas,setSelectedIdeas]=useState<string[]>(params.ideaId?[params.ideaId]:[]),[ideasLoading,setIdeasLoading]=useState(params.kind==='ideas'),[preselectLoading,setPreselectLoading]=useState(!!params.ideaId);
 useEffect(()=>{let live=true;if(!params.ideaId)return;void getIdea(ctx.db,params.ideaId).then(idea=>{if(live&&!idea){setSelectedIdeas([]);setError('想法已不存在，请重新选择');}}).catch(e=>{if(live){setSelectedIdeas([]);setError(e instanceof Error?e.message:'读取想法失败');}}).finally(()=>{if(live)setPreselectLoading(false);});return()=>{live=false;};},[ctx,params.ideaId,setError]);
 const [profiles,setProfiles]=useState<BaziProfile[]>([]),[charts,setCharts]=useState<SavedChart[]>([]),[profile,setProfile]=useState(''),[chart,setChart]=useState(''),[categories,setCategories]=useState<string[]>([]),[loading,setLoading]=useState(true),[documents,setDocuments]=useState<ExportDocument[]|null>(null);const epoch=useRef(0);
 useEffect(()=>{let live=true;const invalidate=()=>{epoch.current++;};Promise.all([listProfiles(ctx.db),listCategories(ctx.db)]).then(([p,c])=>{if(live){setProfiles(p);setCategories(c);}}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;invalidate();};},[ctx,setError]);
 const chooseProfile=async(id:string)=>{const token=++epoch.current;setProfile(id);setChart('');setCharts([]);setLoading(true);setError('');try{const rows=await listCharts(ctx.db,id);if(token===epoch.current){setCharts(rows);setChart(rows[0]?.id??'');}}catch(e){if(token===epoch.current)setError(e instanceof Error?e.message:'读取命盘失败');}finally{if(token===epoch.current)setLoading(false);}};
 const prepare=()=>void run(async()=>{
  const now=ctx.clock.now();let docs:ExportDocument[];
  if(kind==='food'){if(from>to||to>today)throw new Error('请选择有效的起止日期');docs=await ctx.db.transaction(async db=>{const meals=await listMealsInRange(db,from,to),water=await listWaterInRange(db,from,to),energy=await loadEnergyData(db,from,to),settlements=await listFoodSettlements(db);return[foodRangeDocument(from,to,meals,water,energy,settlements,today,now)];});}
  else if(kind==='ideas'){docs=await ctx.db.transaction(async db=>{if(!selectedIdeas.length)throw new Error('请选择想法');const rows=await Promise.all(selectedIdeas.map(id=>getIdea(db,id)));if(rows.some(row=>!row))throw new Error('所选想法已变化，请重新选择');return[ideasDocument(rows.filter(row=>row!==null),now)];});}
  else if(kind==='bazi'){const saved=await getChart(ctx.db,chart);if(!saved||saved.profileId!==profile)throw new Error('命盘已不存在，请重新选择');docs=[baziDocument(saved.result as unknown as BaziChart,now)];}
  else{docs=await ctx.db.transaction(async db=>{const rows=await listItems(db,query,category);if(!rows.length)throw new Error('没有符合条件的物品');const current=itemsDocument(rows,query,category,sort,now);return[current,...(query||category?[itemsDocument(await listItems(db),'',null,sort,now)]:[])];});}
  setDocuments(docs);
 });
 const back=()=>{if(busy||exportBusy)return;if(documents)setDocuments(null);else router.back();};
 useEffect(()=>{const subscription=BackHandler.addEventListener('hardwareBackPress',()=>{if(busy||exportBusy)return true;if(documents){setDocuments(null);return true;}return false;});return()=>subscription.remove();},[busy,exportBusy,documents]);
 return <Screen title="文档导出" action={<Button title="返回" secondary disabled={busy||exportBusy} onPress={back}/>}><MotionSection transitionKey={documents?'2-format':'1-scope'}>{documents?<ExportPanel documents={documents} defaultFormat={documents[0]?.kind==='ideas'?'md':'pdf'} onBusyChange={setExportBusy}/>:<><Row>{([['food','每日饮食'],['bazi','八字命盘'],['items','物品列表'],['ideas','想法']] as const).map(([id,label])=><Button key={id} title={label} secondary={kind!==id} disabled={busy||loading} onPress={()=>{setKind(id);setError('');}}/>)}</Row>
 {kind==='ideas'&&<IdeaSelection selectedIds={selectedIdeas} onChange={setSelectedIdeas} disabled={busy||preselectLoading} onLoadingChange={setIdeasLoading}/>}
 {kind==='food'&&<><DateField label="开始日期" value={from} max={to} disabled={busy} onChange={setFrom}/><DateField label="结束日期" value={to} min={from} max={today} disabled={busy} onChange={setTo}/></>}
 {kind==='bazi'&&<>{profiles.length===0?<Note>暂无出生档案，请先在 AI 工具中添加并查看命盘。</Note>:<Row>{profiles.map(p=><Choice key={p.id} title={p.nickname} selected={profile===p.id} onPress={()=>{if(!busy&&!loading)void chooseProfile(p.id);}}/>)}</Row>}{profile&&!loading&&!charts.length&&<Note>此档案尚未排盘，请先在 AI 工具中查看命盘。</Note>}{charts.map(c=><Button key={c.id} title={`${String(c.input.date)} · ${new Date(c.createdAt).toLocaleString('zh-CN')}`} secondary={chart!==c.id} disabled={busy||loading} onPress={()=>setChart(c.id)}/>)}</>}
 {kind==='items'&&<><Field label="搜索物品（选填）" value={query} onChangeText={v=>{if(!busy)setQuery(v);}}/><Row>{[null,...categories].map(c=><Choice key={c??'all'} title={c??'全部分类'} selected={category===c} onPress={()=>{if(!busy)setCategory(c);}}/>)}</Row><Row>{[['recent','最近购入'],['price','价格从高到低'],['created','最近添加']].map(([id,label])=><Choice key={id} title={label} selected={sort===id} onPress={()=>{if(!busy)setSort(id);}}/>)}</Row></>}
 {loading&&<Note>正在读取…</Note>}{!!error&&<Note error>{error}</Note>}<Button title={busy?'正在准备…':'选择格式并导出'} disabled={busy||loading||(kind==='bazi'&&!chart)||(kind==='ideas'&&(ideasLoading||preselectLoading||!selectedIdeas.length))} onPress={prepare}/></>}</MotionSection></Screen>;
}
