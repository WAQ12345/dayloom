import { TimeField } from '../ui/DateTimeField';
/* eslint-disable react-hooks/set-state-in-effect -- Reloads synchronize local SQLite records with mounted screens. */
import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Screen, Button, Field, Card, Row, Hero, IconButton, PageBar, C } from '../ui/kit';
import { DateViewCoordinator, WaterReadCoordinator } from '../domain/asyncView';
import { MotionSection } from '../ui/MotionSection';
import { useApp } from '../ui/context';
import { useConfirm, useDialog } from '../ui/confirm';
import { getMeal, listMeals, createMeal, updateMeal, deleteMeal, listFavorites, addFavorite, deleteFavorite, listRecentMeals, loadEnergyData, setExpenditure, type PhotoChange } from '../data/foodRepo';
import { listWater, addWater, deleteWater, undoLastWater } from '../data/waterRepo';
import { getSetting, setSetting } from '../data/settingsRepo';
import { getDraft, saveDraft, deleteDraft } from '../data/draftRepo';
import { dailyEnergy, monthEnergy, signedKcal, netLabel, formatKcal, type EnergyData, type DailyEnergy } from '../domain/energy';
import { isValidDate, todayOf, dateText, localTime, monthOf, monthDates, shiftMonth, monthText, mondayOffset } from '../domain/dates';
import { validateMeal, parseNumber, validateWaterAmount, requiredTime, type MealInput } from '../domain/validation';
import { MEAL_TYPES, MEAL_LABEL, type Meal, type FoodFavorite, type WaterRecord } from '../domain/types';

const emptyEnergy: EnergyData = { meals: [], days: {}, settlements: {}, currentMetabolism: null };
const errorText = (e: unknown) => e instanceof Error ? e.message : '操作失败，请重试';
const netColor = (n:number|null) => n===null||n===0?C.text:n>0?'#38704C':'#B54536';
const kcal = (n: number | null) => n === null ? '—' : formatKcal(n);
type Editor = { date: string; id: string | null; input: MealInput; photo: string | null; photoChanged: boolean };
type Panel = 'burn' | 'water' | 'quick' | 'favorites' | null;
const blank = (): MealInput => ({ name: '', kcal: '', mealType: 'breakfast', time: localTime(), note: '' });
export default function FoodScreen() {
  const { ctx, today, revision, refresh } = useApp();
  const confirm = useConfirm();
  const dialog = useDialog();
  const params=useLocalSearchParams<{date?:string;recordId?:string;kind?:string}>();
  const [date, setDate] = useState(today);
  const [targetDate, setTargetDate] = useState(today);
  const displayedDate = useRef(today);
  const [energy, setEnergy] = useState<EnergyData>(emptyEnergy);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [water, setWater] = useState<WaterRecord[]>([]);
  const [quick, setQuick] = useState<[number,number]>([250,500]);
  const [favorites, setFavorites] = useState<FoodFavorite[]>([]);
  const [recent, setRecent] = useState<Meal[]>([]);
  const [detail, setDetail] = useState<Meal | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draft, setDraft] = useState<Editor | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [panelDate, setPanelDate] = useState(today);
  const [burn, setBurn] = useState('');
  const [amount, setAmount] = useState('');
  const [waterTime, setWaterTime] = useState(localTime());
  const [quickInputs, setQuickInputs] = useState(['250','500']);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Permission dialogs trigger foreground reloads; keep photo feedback independent.
  const [photoError, setPhotoError] = useState('');
  useEffect(() => { if (!editor) setPhotoError(''); }, [editor]);
  const coordinator = useRef(new DateViewCoordinator(today));
  const [navigationRevision,setNavigationRevision]=useState(0);
  const waterReads = useRef(new WaterReadCoordinator());
  const draftChain = useRef<Promise<void>>(Promise.resolve());
  const draftBlocked = useRef(false);
  const actionLock = useRef(false);
  const readOnly = date !== today;
  const day = dailyEnergy(energy, date, today);
  const load = useCallback(async () => {
    const token = coordinator.current.begin();
    const requestedDate = token.date;
    let waterVersion = waterReads.current.version(requestedDate);
    try {
      const [e,m,initialWater,q,f,r,d] = await Promise.all([loadEnergyData(ctx.db,requestedDate,requestedDate),listMeals(ctx.db,requestedDate),listWater(ctx.db,requestedDate),getSetting(ctx.db,'waterAmounts'),listFavorites(ctx.db),listRecentMeals(ctx.db),getDraft<Editor>(ctx.db,'meal:editor')]);
      let w=initialWater;
      if (!coordinator.current.current(token)) return;
      while (!waterReads.current.current(requestedDate,waterVersion)) { waterVersion=waterReads.current.version(requestedDate); w=await waterReads.current.read(requestedDate,()=>listWater(ctx.db,requestedDate)); }
      if (!coordinator.current.accept(token)) return;
      displayedDate.current = requestedDate; setDate(requestedDate);
      setEnergy(e); setMeals(m); setWater(w); setQuick(q); setFavorites(f); setRecent(r); setDraft(d?.payload ?? null); setError('');
    } catch(e) { if (coordinator.current.fail(token)) {setTargetDate(coordinator.current.displayed);setError(errorText(e));setLoading(false);} } finally { if (coordinator.current.current(token)) {setLoading(false);} }
  }, [ctx]);
  useEffect(()=>{if(coordinator.current.rollover(today)){setTargetDate(coordinator.current.target);setNavigationRevision(v=>v+1);}},[today]);
  const navigateDate=(delta:number)=>{setTargetDate(coordinator.current.step(delta));setNavigationRevision(v=>v+1);};
  useEffect(() => {const controller=coordinator.current;void load();return()=>controller.cancel();}, [load,revision,navigationRevision]);
  useEffect(()=>{let live=true;const target=params.date;if(!target||!isValidDate(target)||target>todayOf(ctx.clock))return;coordinator.current.select(target);setTargetDate(target);setNavigationRevision(v=>v+1);if(params.recordId&&params.kind==='meal'){getMeal(ctx.db,params.recordId).then(m=>{if(!live)return;if(m&&m.date===target)setDetail(m);else setError('原始记录已删除或变更，仍可在 AI 历史中查看授权快照。');}).catch(e=>live&&setError(errorText(e)));}else if(params.kind==='water'){setPanelDate(target);setPanel('water');}return()=>{live=false;};},[params.date,params.recordId,params.kind,ctx]);

  useEffect(() => { if(editor && !draftBlocked.current) { draftChain.current=draftChain.current.catch(()=>{}).then(()=>saveDraft(ctx,'meal:editor',editor.date,editor)); void draftChain.current.catch(e=>setError(errorText(e))); } },[ctx,editor]);
  const clearEditorDraft = async () => { draftBlocked.current=true; try { await draftChain.current.catch(() => {}); await deleteDraft(ctx,'meal:editor'); } catch(e) { draftBlocked.current=false; throw e; } };
  const act = async (fn: () => Promise<unknown>) => { if(actionLock.current)return; actionLock.current=true; setBusy(true); setError(''); try { await fn(); refresh(); } catch(e) { setError(errorText(e)); } finally { actionLock.current=false; setBusy(false); } };
  // Water mutations only refresh water, never replace the meal list with a loader.
  const actWater = async (fn: () => Promise<unknown>) => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError('');
    const waterDate = date;
    try {
      waterReads.current.changed(waterDate);
      await fn();
      waterReads.current.changed(waterDate);
      const records = await waterReads.current.read(waterDate,()=>listWater(ctx.db, waterDate));
      if (displayedDate.current === waterDate) setWater(records);
    } catch (e) { waterReads.current.changed(waterDate); setError(errorText(e)); }
    finally { actionLock.current = false; setBusy(false); }
  };
  const openEditor = async (meal?: Meal | FoodFavorite, force = false, copy = false) => {
    if(draft && !force) {
      const choice=await dialog({title:'有未保存的饮食草稿',actions:[{label:'取消',value:'cancel'},{label:'继续草稿',value:'resume'},{label:'丢弃并继续',value:'discard',destructive:true}]});
      if(choice==='resume'){draftBlocked.current=false;setDetail(null);setPanel(null);setEditor(draft);}
      if(choice==='discard')await act(async()=>{await clearEditorDraft();await openEditor(meal,true,copy);});
      return;
    }
    draftBlocked.current=false; setError(''); setDetail(null); setPanel(null);
    const existing = meal && 'date' in meal && !copy ? meal : null;
    setEditor({ date: existing?.date ?? today, id: existing?.id ?? null, input: meal ? { name: meal.name, kcal:String(meal.kcal), mealType:meal.mealType ?? 'breakfast', time:existing?.time ?? localTime(),note:existing?.note ?? '' } : blank(),photo:meal && 'photo' in meal && meal.photo ? ctx.photos.uri(meal.photo) : null,photoChanged:false });
  };
  const change = (key: keyof MealInput,v: string) => !busy && setEditor(e=>e?{...e,input:{...e.input,[key]:v}}:e);
  const closeEditor = async () => {
    if(actionLock.current)return;
    const choice=await dialog({title:'保留未保存的饮食？',actions:[{label:'继续填写',value:'continue'},{label:'保留草稿',value:'keep'},{label:'丢弃草稿',value:'discard',destructive:true}]});
    if(choice==='keep')await act(async()=>{if(editor){await draftChain.current;await saveDraft(ctx,'meal:editor',editor.date,editor);}setEditor(null);});
    if(choice==='discard')await act(async()=>{await clearEditorDraft();setEditor(null);});
  };
  const pick = async (camera: boolean) => { setPhotoError(''); try { if(camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted){setPhotoError('相机权限未开启，可以选择相册或直接填写热量。');return;} const result=camera?await ImagePicker.launchCameraAsync({mediaTypes:['images'],quality:.8,allowsEditing:true}):await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:.8,allowsEditing:true});if(!result.canceled){const name=await ctx.photos.importFromUri(result.assets[0].uri);setEditor(e=>e?{...e,photo:ctx.photos.uri(name),photoChanged:true}:e);} }catch(e){setPhotoError(errorText(e));} };
  const openPanel = (which:Panel) => { setError(''); setPanelDate(date); setPanel(which); if(which==='burn')setBurn(String(day.expenditure??0));if(which==='water'){setAmount('');setWaterTime(localTime());}if(which==='quick')setQuickInputs(quick.map(String)); };
  const closeDetail=()=>{if(!actionLock.current)setDetail(null)};
  const closePanel=()=>{if(!actionLock.current)setPanel(null)};
  const mealMore=async()=>{if(!detail||actionLock.current)return;const record=detail;const choice=await dialog({title:'餐食操作',actions:[{label:'删除餐食',value:'delete',destructive:true},{label:'取消',value:'cancel'}]});if(choice==='delete'&&await confirm({title:`删除「${record.name}」？`,message:'删除后热量会自动重新计算，无法撤销。',confirmText:'删除',destructive:true}))await act(async()=>{await deleteMeal(ctx,record.id);setDetail(null);});};
  return <>
    <Screen title=""><MotionSection transitionKey={date}>
      <Hero module="food" date={date} title="饮食" subtitle={dateText(date)} onPrevious={()=>navigateDate(-1)} onNext={targetDate<today?()=>navigateDate(1):undefined} />
      <View style={s.summary}>
        <View style={[s.metrics,s.energyRow]}><Text style={[s.energyMetric,{flex:1}]}>摄入 {kcal(day.intake ?? 0)} kcal</Text><Text style={[s.energyMetric,{flex:1,textAlign:'right'}]}>总消耗 {kcal(day.total ?? 0)} kcal</Text></View>
        <View style={[s.energyRow,s.energyInset]}><Text style={s.energySecondary}>基础代谢 {kcal(day.metabolism ?? 0)} kcal</Text></View>
        <View style={[s.energyNet,s.energyInset]}><Text style={[s.energyMetric,{color:netColor(day.net)}]}>{netLabel(day.net ?? 0)}</Text><Text style={[s.energyNetValue,{color:netColor(day.net)}]}>{kcal(Math.abs(day.net ?? 0))} <Text style={s.energySecondary}>kcal</Text></Text></View>
        {!readOnly&&<Pressable accessibilityRole="button" accessibilityLabel="填写活动消耗" onPress={()=>openPanel('burn')} style={({pressed})=>[s.energyEdit,{opacity:pressed?.6:1}]}><Feather name="edit-2" size={18} color={C.accent}/></Pressable>}
      </View>
      {error!==''&&<Text style={s.error} accessibilityRole="alert">{error}</Text>}
      {error!==''&&<Button title="重试读取" secondary onPress={()=>void load()} />}
      {draft&&<Button title={`继续${draft.date===today?'':'历史'}饮食草稿`} secondary onPress={()=>{draftBlocked.current=false;setEditor(draft);}} />}
      <View style={{marginTop:-6}}><View style={{flexDirection:'row',alignItems:'center',minHeight:48}}><Text style={[s.heading,{flex:1}]}>{readOnly?'当日饮食':'今日饮食'}</Text>{!readOnly&&<Pressable accessibilityRole="button" accessibilityLabel="常用与最近食品" onPress={()=>openPanel('favorites')} style={[s.smallLink,{width:48,alignItems:'center'}]}><Feather name="more-horizontal" size={22} color={C.muted} /></Pressable>}</View>
      {loading?<Text style={s.hint}>正在读取记录…</Text>:meals.length===0?(readOnly?<Text style={s.hint}>这天没有饮食记录。</Text>:null):MEAL_TYPES.map(type=>{const rows=meals.filter(m=>m.mealType===type);return rows.length?<View key={type}>{rows.map(m=><Pressable accessibilityRole="button" key={m.id} onPress={()=>setDetail(m)} style={s.meal}>{m.photo&&<Image source={{uri:ctx.photos.uri(m.photo)}} style={s.thumb} />}<View style={{flex:1}}><Text style={s.name}>{m.name}</Text><Text style={s.hint}>{MEAL_LABEL[m.mealType]} · {m.time??'未填写时间'}</Text></View><Text style={s.body}>{formatKcal(m.kcal)} kcal</Text></Pressable>)}</View>:null;})}
      </View>
      {!readOnly&&<Button title="记热量" onPress={()=>openEditor()} />}
      <View style={s.water}>
        <View style={s.waterHeading}><View style={s.waterTotal}><Text style={s.waterLabel}>饮水</Text><Text style={s.waterValue}>{water.reduce((n,w)=>n+w.amountMl,0)} <Text style={s.energySecondary}>ml</Text></Text></View><IconButton name="clock" label="饮水记录" onPress={()=>openPanel('water')}/>{!readOnly&&<IconButton name="sliders" label="设置饮水快捷量" disabled={busy} onPress={()=>openPanel('quick')}/>}</View>
        {!readOnly&&<View style={s.waterShortcuts}>{quick.map((q,i)=><Pressable key={i} accessibilityRole="button" accessibilityLabel={`添加${q}毫升饮水`} accessibilityState={{disabled:busy}} disabled={busy} onPress={()=>void actWater(()=>addWater(ctx,date,q,localTime()))} style={({pressed})=>[s.waterQuick,{opacity:busy?.45:pressed?.65:1}]}><Text style={s.linkText}>+{q} ml</Text></Pressable>)}<Pressable accessibilityRole="button" accessibilityLabel="自定义饮水量" accessibilityState={{disabled:busy}} disabled={busy} onPress={()=>openPanel('water')} style={({pressed})=>[s.waterQuick,{opacity:busy?.45:pressed?.65:1}]}><Text style={s.linkText}>自定义</Text></Pressable></View>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="查看热量概览" onPress={()=>router.push('/energy-overview')} style={({pressed})=>[s.overviewLink,{opacity:pressed?.65:1}]}><Text style={s.overviewText}>热量概览</Text><Feather name="arrow-right" size={16} color={C.muted}/></Pressable>
    </MotionSection></Screen>
    <Modal visible={!!editor} animationType="fade" onRequestClose={closeEditor}>{editor&&<Screen title="" topBar={<PageBar backDisabled={busy} title={editor.id?'修改餐食':'记下这一餐'} onBack={()=>void closeEditor()}/>} footer={editor.date===today?<Button title={busy?'保存中…':'保存餐食'} disabled={busy} onPress={()=>void act(async()=>{const value=validateMeal(editor.input);const photo:PhotoChange=editor.photoChanged?editor.photo?{kind:'replace',uri:editor.photo}:{kind:'remove'}:{kind:'keep'};const saved=editor.id?await updateMeal(ctx,editor.id,value,photo):await createMeal(ctx,editor.date,value,editor.photo);setEditor({...editor,id:saved.id});await clearEditorDraft();setEditor(null);})} />:undefined}>
      <Text style={s.hint}>{dateText(editor.date)}{editor.date!==today?' · 历史草稿':''}</Text>{error!==''&&<Text style={s.error}>{error}</Text>}{photoError!==''&&<Text style={s.error} accessibilityRole="alert">{photoError}</Text>}
      {editor.photo&&<Image source={{uri:editor.photo}} style={s.photo} resizeMode="cover" />}
      {editor.date===today?<><Row><Button title="拍照" secondary onPress={()=>void pick(true)} /><Button title="选择照片" secondary onPress={()=>void pick(false)} />{editor.photo&&<Button title="移除照片" secondary onPress={()=>setEditor({...editor,photo:null,photoChanged:true})} />}</Row>
      <Field label="食品名称" value={editor.input.name} onChangeText={v=>change('name',v)} placeholder="例如：鸡肉饭" /><Field label="热量（kcal）" value={editor.input.kcal} onChangeText={v=>change('kcal',v)} keyboardType="decimal-pad" />
      <Text style={s.hint}>餐次</Text><View style={s.wrap}>{MEAL_TYPES.map(t=><Button key={t} title={MEAL_LABEL[t]} secondary={editor.input.mealType!==t} onPress={()=>change('mealType',t)} />)}</View>
      <TimeField label="时间（选填）" value={editor.input.time} onChange={v=>change('time',v)} optional /><Field label="备注（选填）" value={editor.input.note} onChangeText={v=>change('note',v)} multiline />
      {editor.photo&&<Button title="照片分析说明" secondary onPress={()=>void dialog({title:'照片分析暂不可用',message:'照片保存在本机，请直接填写热量。不会自动发送或覆盖数值。',actions:[{label:'知道了',value:'ok'}]})} />}

      </>:<Card><Text style={s.heading}>{editor.input.name||'未命名食品'}</Text><Text style={s.body}>{editor.input.kcal||'未填写'} kcal · {MEAL_LABEL[editor.input.mealType]}</Text><Text style={s.body}>{editor.input.note}</Text></Card>}
    </Screen>}</Modal>
    <Modal visible={!!detail} animationType="fade" onRequestClose={closeDetail}>{detail&&<Screen title="" topBar={<PageBar backDisabled={busy} title="餐食记录" onBack={closeDetail} actions={detail.date===today?<IconButton name="more-horizontal" label="餐食更多操作" disabled={busy} onPress={()=>void mealMore()}/>:undefined}/>}>
      {detail.photo&&<Image source={{uri:ctx.photos.uri(detail.photo)}} style={s.photo} resizeMode="cover" />}<Text style={s.number}>{detail.name}</Text><Text style={s.number}>{kcal(detail.kcal)} kcal</Text><Text style={s.hint}>{dateText(detail.date)} · {MEAL_LABEL[detail.mealType]} · {detail.time??'时间未填写'}</Text><Text style={s.body}>{detail.note??'没有备注'}</Text>{error!==''&&<Text style={s.error}>{error}</Text>}
      <Button title={favorites.some(f=>f.name===detail.name&&f.kcal===detail.kcal)?'已加入常用':'加入常用食品'} secondary disabled={busy||favorites.some(f=>f.name===detail.name&&f.kcal===detail.kcal)} onPress={()=>void act(()=>addFavorite(ctx,detail.name,detail.kcal,detail.mealType))} />
      {detail.date===today?<><Button title="修改餐食" onPress={()=>openEditor(detail)} /></>:<><Button title="复制到今天" secondary onPress={()=>openEditor(detail,false,true)} /></>}
    </Screen>}</Modal>
    <Modal visible={panel!==null} animationType="fade" onRequestClose={closePanel}><Screen title="" topBar={<PageBar backDisabled={busy} title={{burn:'活动消耗',water:'饮水记录',quick:'饮水快捷量',favorites:'常用与最近'}[panel??'water']} onBack={closePanel}/>} footer={panel==='quick'?<Button title="保存快捷量" disabled={busy} onPress={()=>void act(async()=>{await setSetting(ctx.db,'waterAmounts',[validateWaterAmount('first',quickInputs[0]),validateWaterAmount('second',quickInputs[1])]);setPanel(null);})} />:undefined}>
      {error!==''&&<Text style={s.error}>{error}</Text>}
      {panel==='burn'&&<><Text style={s.hint}>{dateText(panelDate)}</Text><EnergyDetails day={day} showNet={false} />{panelDate===today?<><Field label="活动消耗（kcal）" value={burn} onChangeText={setBurn} keyboardType="decimal-pad" /><Button title="保存活动消耗" disabled={busy} onPress={()=>void act(async()=>{await setExpenditure(ctx,panelDate,parseNumber('burn',burn,'活动消耗',0,100000));setPanel(null);})} /><Button title="基础代谢" secondary onPress={()=>{setPanel(null);router.push('/settings?section=profile');}} /></>:null}</>}
      {panel==='water'&&<><Text style={s.heading}>{dateText(panelDate)} · {water.reduce((n,w)=>n+w.amountMl,0)} ml</Text>{panelDate===today&&<><Field label="饮水量（ml）" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" /><TimeField label="时间" value={waterTime} onChange={setWaterTime} /><Button title="记录饮水" disabled={busy} onPress={()=>void actWater(async()=>{await addWater(ctx,panelDate,validateWaterAmount('water',amount),requiredTime('time',waterTime));setAmount('');})} />{water.length>0&&<Button title="撤销最近一次饮水" secondary disabled={busy} onPress={()=>void actWater(()=>undoLastWater(ctx,panelDate))} />}</>}{water.length===0?<Text style={s.hint}>还没有饮水记录</Text>:water.map(w=><View key={w.id} style={s.meal}><View style={{flex:1}}><Text style={s.body}>{w.amountMl} ml</Text><Text style={s.hint}>{w.time}</Text></View>{panelDate===today&&<Button title="删除" secondary onPress={()=>void (async()=>{if(await confirm({title:'删除这次饮水？',message:`${w.time} · ${w.amountMl} ml`,confirmText:'删除',destructive:true}))await actWater(()=>deleteWater(ctx,w.id));})()} />}</View>)}</>}
      {panel==='quick'&&<>{quickInputs.map((q,i)=><Field key={i} label={`快捷量 ${i+1}（ml）`} value={q} keyboardType="decimal-pad" onChangeText={v=>setQuickInputs(a=>a.map((x,j)=>i===j?v:x))} />)}</>}
      {panel==='favorites'&&<><Text style={s.heading}>常用食品</Text>{favorites.length===0&&<Text style={s.hint}>暂无常用食品</Text>}{favorites.map(f=><Card key={f.id}><Text style={s.heading}>{f.name}</Text><Text style={s.hint}>{f.kcal} kcal · {f.mealType?MEAL_LABEL[f.mealType]:'未指定餐次'}</Text><Row><Button title="复制到今天" onPress={()=>openEditor(f,false,true)} /><Button title="移出常用" secondary onPress={()=>void act(()=>deleteFavorite(ctx,f.id))} /></Row></Card>)}<Text style={s.heading}>最近记录</Text>{recent.length===0&&<Text style={s.hint}>暂无最近记录</Text>}{recent.map(m=><Pressable key={m.id} style={s.meal} accessibilityRole="button" onPress={()=>openEditor(m,false,true)}><View style={{flex:1}}><Text style={s.name}>{m.name}</Text><Text style={s.hint}>{m.date} · {m.kcal} kcal</Text></View><Text style={s.hint}>复制到今天 ›</Text></Pressable>)}</>}
    </Screen></Modal>
  </>;
}

function EnergyDetails({day,showNet=true}:{day:DailyEnergy;showNet?:boolean}) { return <Card>{[['摄入',day.intake],['基础代谢',day.metabolism],['活动消耗',day.expenditure],['总消耗',day.total]].map(([label,value])=><View key={String(label)} style={s.detailRow}><Text style={s.body}>{label}</Text><Text style={s.body}>{kcal(value as number|null)} kcal</Text></View>)}{showNet&&<Text style={[s.number,{color:netColor(day.net)}]}>{day.net===null?'—':`${netLabel(day.net)} ${signedKcal(day.net)}`} <Text style={s.hint}>kcal</Text></Text>}</Card>; }
export function EnergyOverview() {
  const {ctx,today,revision}=useApp();
  const [month,setMonth]=useState(monthOf(today));
  const [data,setData]=useState<EnergyData>(emptyEnergy);
  const [chosen,setChosen]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{let current=true;setLoading(true);const dates=monthDates(month);loadEnergyData(ctx.db,dates[0],dates[dates.length-1]).then(d=>{if(current){setData(d);setError('');}}).catch(e=>current&&setError(errorText(e))).finally(()=>current&&setLoading(false));return()=>{current=false;};},[ctx,month,revision]);
  const result=monthEnergy(data,month,today);
  const selected=chosen?dailyEnergy(data,chosen,today):null;
  return <Screen title="热量概览" action={<Button title="返回" secondary onPress={()=>router.back()} />}>
    <Row><Button title="上一月" secondary onPress={()=>{setMonth(shiftMonth(month,-1));setChosen(null);}} /><Text style={s.heading}>{monthText(month)}</Text>{month<monthOf(today)&&<Button title="下一月" secondary onPress={()=>{setMonth(shiftMonth(month,1));setChosen(null);}} />}</Row>
    <Text style={s.hint}>每日净差＝摄入 − 总消耗 · 单位 kcal</Text>{error!==''&&<Text style={s.error}>{error}</Text>}
    <View style={s.calendar}>{['一','二','三','四','五','六','日'].map(d=><Text key={d} style={s.week}>{d}</Text>)}{Array.from({length:mondayOffset(month)},(_,i)=><View key={`gap${i}`} style={s.day} />)}{result.days.map(d=><Pressable key={d.date} accessibilityRole="button" accessibilityLabel={`${d.date}，${d.net===null?'未记录完整':signedKcal(d.net)+'卡路里'}，${d.eligible?'已计入':'未计入'}`} disabled={d.date>today} onPress={()=>setChosen(d.date)} style={[s.day,chosen===d.date&&s.selected,d.date>today&&{opacity:.3}]}><Text style={s.body}>{Number(d.date.slice(-2))}</Text><Text style={[s.tiny,{color:netColor(d.net),fontWeight:d.net===null?'400':'700'}]}>{d.date>today?'':d.net===null?'—':signedKcal(d.net)}</Text></Pressable>)}</View>
    {selected&&!loading&&<><Text style={s.heading}>{dateText(selected.date)}</Text><EnergyDetails day={selected}/></>}
    {loading?<Text style={s.hint}>正在读取…</Text>:<Card><Text style={s.hint}>本月累计{result.net===null?'净差':netLabel(result.net)}</Text><Text style={[s.number,{color:netColor(result.net)}]}>{result.net===null?'—':`${kcal(Math.abs(result.net))} kcal`}</Text></Card>}
  </Screen>;
}
const s=StyleSheet.create({headerSettings:{width:48,height:48,alignItems:'center',justifyContent:'center'},headerDates:{position:'absolute',right:0,bottom:2,flexDirection:'row'},headerArrow:{width:48,height:48,alignItems:'center',justifyContent:'center'},heading:{fontSize:17,fontWeight:'600',color:C.text,flexShrink:1},hint:{fontSize:13,color:C.muted,lineHeight:21},body:{fontSize:15,color:C.text,lineHeight:24},number:{fontSize:25,fontWeight:'600',color:C.text},error:{fontSize:14,color:'#A83224'},metrics:{flexDirection:'row',alignItems:'center',gap:16},metric:{flex:1,gap:6},summary:{backgroundColor:'#F2E9DC',borderRadius:14,paddingHorizontal:12,paddingVertical:8,gap:0},energyMetric:{fontSize:15,lineHeight:23,color:C.text,flexShrink:1},energySecondary:{fontSize:14,lineHeight:22,color:C.muted},energyNet:{minHeight:32,flexDirection:'row',alignItems:'baseline',flexWrap:'wrap',gap:8},energyNetValue:{fontSize:20,lineHeight:28,fontWeight:'600'},energyRow:{minHeight:28,justifyContent:'center'},energyInset:{paddingRight:40},energyEdit:{position:'absolute',right:0,bottom:0,width:44,height:44,alignItems:'center',justifyContent:'center'},water:{paddingTop:2,gap:2},waterHeading:{flexDirection:'row',alignItems:'center'},waterTotal:{flex:1,flexDirection:'row',alignItems:'baseline',gap:8,flexWrap:'wrap'},waterLabel:{fontSize:15,lineHeight:23,fontWeight:'600',color:C.water},waterQuick:{flex:1,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:10,borderWidth:1,borderColor:'#D8E5EC',paddingHorizontal:6},waterShortcuts:{flexDirection:'row',gap:8},overviewLink:{minHeight:44,flexDirection:'row',alignItems:'center',gap:8,alignSelf:'flex-start'},overviewText:{fontSize:15,lineHeight:23,color:C.muted},smallLink:{minHeight:48,justifyContent:'center',paddingHorizontal:4},linkText:{color:C.water,fontSize:15,fontWeight:'600'},waterValue:{fontSize:19,fontWeight:'600',color:C.water},wrap:{flexDirection:'row',flexWrap:'wrap',gap:8},mealHeading:{fontSize:14,color:C.accent,fontWeight:'600',marginTop:8},meal:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12,borderBottomWidth:1,borderColor:C.line,minHeight:66},name:{fontSize:15,color:C.text,fontWeight:'600',lineHeight:24},thumb:{height:48,width:48,borderRadius:10},photo:{height:240,width:'100%',borderRadius:16,backgroundColor:C.surface},detailRow:{flexDirection:'row',justifyContent:'space-between',gap:8},calendar:{flexDirection:'row',flexWrap:'wrap'},week:{width:'14.2857%',textAlign:'center',color:C.muted,paddingVertical:10},day:{width:'14.2857%',minHeight:70,alignItems:'center',justifyContent:'center',borderRadius:10},selected:{backgroundColor:'#EADACC'},tiny:{fontSize:10,color:C.muted}});
