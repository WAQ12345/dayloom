import {PlanContentTree} from '../ui/PlanContentTree';
import { PlanFields } from '../ui/PlanFields';
/* eslint-disable react-hooks/set-state-in-effect -- Effects synchronize the screen with the asynchronous SQLite repository. */
import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, Modal, Pressable, StyleSheet, Text, View, type ScrollView } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SwipeTaskRow } from '../ui/SwipeTaskRow';
import { ReorderPlanList, type PlanScrollMetrics } from '../ui/ReorderPlanList';
import { Screen, Button, Card, Row, Hero, C, PageBar, IconButton } from '../ui/kit';
import { DateViewCoordinator } from '../domain/asyncView';
import { useDateTransition } from '../ui/motion';
import { useApp } from '../ui/context';
import { useConfirm, useDialog } from '../ui/confirm';
import { createTask, updateTask, deleteTask, listTasks, listTasksInRange, reorderTasks, setTaskStatus } from '../data/taskRepo';
import { getDraft, saveDraft, deleteDraft } from '../data/draftRepo';
import { dateText, monthOf, monthDates, shiftMonth, monthText, mondayOffset, todayOf } from '../domain/dates';
import { reorderTaskLevel, taskProgress } from '../domain/tasks';
import { validateTask, type TaskInput } from '../domain/validation';
import { STATUS_LABEL, type Task } from '../domain/types';

const blank = (): TaskInput => ({ name: '', orderLevel: 2, project: '', note: '' });
type Draft = { input: TaskInput; id: string | null };
const message = (e: unknown) => e instanceof Error ? e.message : '操作失败，请重试';

export default function PlansScreen() {
  const {showToday}=useLocalSearchParams<{showToday?:string}>();
  const handledTodayRequest=useRef('');
  const { ctx, today, revision, refresh } = useApp();
  const confirm = useConfirm();
  const dialog = useDialog();
  const [date, setDate] = useState(today);
  const [targetDate, setTargetDate] = useState(today);
  const animateDate = useDateTransition();
  const displayedDate = useRef(today);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const coordinator = useRef(new DateViewCoordinator(today));
  const [navigationRevision,setNavigationRevision]=useState(0);
  const draftChain = useRef<Promise<void>>(Promise.resolve());
  const draftBlocked = useRef(false);
  const actionLock = useRef(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrollMetrics = useRef<PlanScrollMetrics>({ top: 0, height: 0, offset: 0, contentHeight: 0 });
  const [openRow, setOpenRow] = useState<string | null>(null);
  const openRowRef = useRef(openRow);
  useEffect(() => { openRowRef.current = openRow; }, [openRow]);
  useFocusEffect(useCallback(() => {
    const keyboard = Keyboard.addListener('keyboardDidShow', () => setOpenRow(null));
    const back = BackHandler.addEventListener('hardwareBackPress', () => { if (openRowRef.current) { setOpenRow(null); return true; } return false; });
    return () => { keyboard.remove(); back.remove(); setOpenRow(null); };
  }, []));
  useEffect(() => { setOpenRow(null); }, [today, targetDate]);
  const [detail, setDetail] = useState<Task | null>(null);
  const [editor, setEditor] = useState<{ date: string; id: string | null; input: TaskInput } | null>(null);
  const [draft, setDraft] = useState<{ date: string | null; payload: Draft } | null>(null);
  const readOnly = date !== today;
  const load = useCallback(async () => {
    if (actionLock.current) return;
    const token = coordinator.current.begin();
    const requestedDate = token.date;
    try {
      const [t, d] = await Promise.all([listTasks(ctx.db, requestedDate), getDraft<Draft>(ctx.db, 'task:editor')]);
      if (actionLock.current || !coordinator.current.current(token)) return;
      coordinator.current.accept(token);
      if (displayedDate.current !== requestedDate) animateDate();
      displayedDate.current = requestedDate; setDate(requestedDate);
      setTasks(t); setDraft(d); setError('');
    } catch (e) { if (coordinator.current.fail(token)) {setTargetDate(coordinator.current.displayed);setError(message(e));setLoading(false);} } finally { if (coordinator.current.current(token)) setLoading(false); }
  }, [ctx, animateDate]);
  useEffect(()=>{if(coordinator.current.rollover(today)){setTargetDate(coordinator.current.target);setNavigationRevision(v=>v+1);}},[today]);
  useEffect(()=>{if(showToday&&handledTodayRequest.current!==showToday){handledTodayRequest.current=showToday;coordinator.current.rollover(today);coordinator.current.select(today);setTargetDate(today);setNavigationRevision(v=>v+1);}},[showToday,today]);
  const navigateDate=(delta:number)=>{if(busy||dragging)return;setTargetDate(coordinator.current.step(delta));setNavigationRevision(v=>v+1);};
  useEffect(() => {const controller=coordinator.current;void load();return()=>controller.cancel();}, [load,revision,navigationRevision]);
  useEffect(() => {
    if (!editor || draftBlocked.current) return;
    draftChain.current = draftChain.current.catch(() => {}).then(() => saveDraft(ctx, 'task:editor', editor.date, { input: editor.input, id: editor.id }));
    void draftChain.current.catch(e => setError(message(e)));
  }, [ctx, editor]);
  const clearEditorDraft = async () => { draftBlocked.current = true; try { await draftChain.current.catch(() => {}); await deleteDraft(ctx,'task:editor'); } catch(e) { draftBlocked.current = false; throw e; } };
  const act = async (f: () => Promise<unknown>) => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError('');
    try { await f(); refresh(); } catch(e) { setError(message(e)); } finally { actionLock.current = false; setBusy(false); }
  };
  const reorder = async (level: Task['orderLevel'], ids: string[]) => {
    if (actionLock.current || readOnly || targetDate !== date) return;
    const before = tasks, expectedDate = date;
    actionLock.current = true; setBusy(true); setOpenRow(null); setError('');
    coordinator.current.cancel();
    try {
      setTasks(reorderTaskLevel(before, level, ids));
      const saved = await reorderTasks(ctx, expectedDate, level, ids);
      if (displayedDate.current === expectedDate) setTasks(saved);
    } catch (e) {
      if (displayedDate.current === expectedDate) setTasks(before);
      setError(`${message(e)} 排序未保存。`);
      if (todayOf(ctx.clock) !== expectedDate) refresh();
    } finally { actionLock.current = false; setBusy(false); }
  };
  const close = async () => {
    if(busy)return;
    const choice=await dialog({title:'保留未保存的计划？',actions:[{label:'继续填写',value:'continue'},{label:'保留草稿',value:'keep'},{label:'丢弃草稿',value:'discard',destructive:true}]});
    if(choice==='keep')await act(async()=>{if(editor){await draftChain.current;await saveDraft(ctx,'task:editor',editor.date,{input:editor.input,id:editor.id});}setEditor(null);});
    if(choice==='discard')await act(async()=>{await clearEditorDraft();setEditor(null);});
  };
  const openEdit = async (t?: Task, replace = false) => {
    if(draft&&!replace){
      const choice=await dialog({title:'有未保存的草稿',actions:[{label:'取消',value:'cancel'},{label:'继续草稿',value:'resume'},{label:'丢弃并继续',value:'discard',destructive:true}]});
      if(choice==='resume'){draftBlocked.current=false;setDetail(null);setEditor({date:draft.date??date,...draft.payload});}
      if(choice==='discard')await act(async()=>{await clearEditorDraft();await openEdit(t,true);});
      return;
    }
    draftBlocked.current=false;setError('');setDetail(null);setEditor({date,id:t?.id??null,input:t?{name:t.name,orderLevel:t.orderLevel,project:t.project,note:t.note??''}:blank()});
  };
  const measureScroll = () => {
    requestAnimationFrame(() => scrollRef.current?.getNativeScrollRef()?.measureInWindow((_x, y, _width, height) => {
      scrollMetrics.current.top = y; scrollMetrics.current.height = height;
    }));
  };
  const setInput = (key: keyof TaskInput, value: string | number) => !busy && setEditor(e => e ? { ...e, input: { ...e.input, [key]: value } } : e);
  return <>
    <Screen title="" footerSafeArea={false} footer={<Row><Pressable accessibilityRole="button" accessibilityLabel="想法" disabled={busy||dragging} onPress={()=>router.push('/ideas')} style={({pressed})=>[s.ideasHit,{opacity:pressed?.7:1}]}><View style={s.ideasPill}><Feather name="edit-3" size={16} color={C.accent}/><Text style={s.ideasLabel}>想法</Text></View></Pressable><Pressable accessibilityRole="button" accessibilityLabel="模板" disabled={busy||dragging} onPress={()=>router.push('/templates')} style={({pressed})=>[s.ideasHit,{opacity:pressed?.7:1}]}><View style={s.ideasPill}><Feather name="layers" size={16} color={C.accent}/><Text style={s.ideasLabel}>模板</Text></View></Pressable></Row>} scrollRef={scrollRef} scrollEnabled={!dragging} onContentSizeChange={(_width,height)=>{scrollMetrics.current.contentHeight=height;}} onLayout={measureScroll} onScroll={event => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; scrollMetrics.current.offset = contentOffset.y; scrollMetrics.current.contentHeight = contentSize.height; scrollMetrics.current.height = layoutMeasurement.height; }} onScrollBeginDrag={()=>setOpenRow(null)}>
      <Hero module="plans" date={date} title="计划" subtitle={dateText(date)} onPrevious={()=>navigateDate(-1)} onNext={targetDate<today?()=>navigateDate(1):undefined} />
      {error !== '' && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {error!==''&&<Button title="重试读取" secondary disabled={busy||dragging} onPress={()=>void load()} />}
      {draft && <Button title={`继续${draft.date === today ? '' : '历史'}草稿`} secondary onPress={() => { draftBlocked.current = false; setEditor({ date: draft.date ?? date, ...draft.payload }); }} />}
      <View style={{marginTop:-6}}><View style={{flexDirection:'row',alignItems:'center',minHeight:48}}><Text style={[s.heading,{flex:1}]}>{readOnly ? '当日计划' : '今日计划'}</Text>{!readOnly && <Pressable accessibilityRole="button" disabled={busy||dragging} style={{minHeight:48,justifyContent:'center',paddingHorizontal:4}} onPress={() => openEdit()}><Text style={{color:C.accent,fontSize:13}}>添加计划</Text></Pressable>}</View>
      {loading ? <Text style={s.hint}>正在读取计划…</Text> : tasks.length === 0 ? <Card><Text style={s.heading}>{readOnly ? '这天没有计划' : '今天，想完成哪件事？'}</Text></Card> : <ReorderPlanList key={date} tasks={tasks} disabled={readOnly||busy||targetDate!==date} scrollRef={scrollRef} scrollMetrics={scrollMetrics} onDragging={value=>{setDragging(value);if(value)setOpenRow(null);}} onReorder={(level,ids)=>void reorder(level,ids)} renderRow={(t,controls) => <SwipeTaskRow onLongPress={controls.onLongPress} reorderActions={controls.reorderActions} label={`${t.name}，${STATUS_LABEL[t.status]}，${['先做','随后','最后'][(t.orderLevel??2)-1]}`} open={openRow===t.id} onOpenChange={value=>setOpenRow(value?t.id:null)} onPress={()=>{if(busy||controls.dragging)return;setOpenRow(null);setDetail(t);}} disabled={readOnly||busy||controls.dragging} actions={readOnly?[]:[
        ...(t.status==='cancelled'?[]:[{key:'complete',icon:t.status==='done'?'rotate-ccw' as const:'check' as const,label:t.status==='done'?'撤销完成':'完成',onPress:()=>void act(()=>setTaskStatus(ctx,t.id,t.status==='done'?'todo':'done'))}]),
        {key:'edit',icon:'edit-2',label:'编辑',onPress:()=>{setOpenRow(null);void openEdit(t);}},
        {key:'delete',icon:'trash-2',label:'删除',destructive:true,onPress:()=>void (async()=>{if(await confirm({title:`删除「${t.name}」？`,message:'删除后无法撤销。',confirmText:'删除',destructive:true}))await act(()=>deleteTask(ctx,t.id));})()},
      ]}><Text style={[s.taskName,{color:['#9F4038','#806015','#46694B'][(t.orderLevel??2)-1]},t.status==='done'&&s.completed]}>{t.name}</Text></SwipeTaskRow>} />}
      </View>

    </Screen>
    <Modal visible={!!editor} animationType="fade" onRequestClose={close}>
      {editor && <Screen title="" topBar={<PageBar title={editor.id?'编辑计划':'添加计划'} backDisabled={busy} onBack={()=>{if(!busy)void close();}}/>} footer={editor.date===today?<Button title={busy ? '保存中…' : '保存计划'} disabled={busy} onPress={() => void act(async () => { const value = validateTask(editor.input); const saved = editor.id ? await updateTask(ctx, editor.id, value) : await createTask(ctx, editor.date, value); setEditor({...editor,id:saved.id}); await clearEditorDraft(); setEditor(null); })} />:undefined}>
        <Text style={s.hint}>{dateText(editor.date)}{editor.date !== today ? ' · 历史草稿只读' : ''}</Text>
        {error !== '' && <Text style={s.error}>{error}</Text>}
        {editor.date === today ? <>
          <PlanFields name={editor.input.name} note={editor.input.note} orderLevel={editor.input.orderLevel??2} disabled={busy} onName={v=>setInput('name',v)} onNote={v=>setInput('note',v)} onOrder={v=>setInput('orderLevel',v)}/>

        </> : <Card><Text style={s.heading}>{editor.input.name || '未命名计划'}</Text><PlanContentTree value={editor.input.note} /><Text style={s.hint}>跨天草稿保留供查看，不能写入今天。</Text></Card>}
      </Screen>}
    </Modal>
    <Modal visible={!!detail} animationType="fade" onRequestClose={() => setDetail(null)}>
      {detail && <Screen title="" topBar={<PageBar title="计划详情" onBack={()=>{if(!busy)setDetail(null);}} actions={<IconButton name="more-horizontal" label="计划操作" disabled={busy} onPress={()=>void (async()=>{const choice=await dialog({title:'计划操作',actions:[{label:'保存为模板',value:'template'},{label:'取消',value:'cancel'}]});if(choice==='template'){const id=detail.id;setDetail(null);router.push({pathname:'/templates',params:{sourceTaskId:id}});}})()}/>}/>}><Text style={s.big}>{detail.name}</Text><Text style={s.hint}>{dateText(detail.date)} · {STATUS_LABEL[detail.status]}</Text><View style={s.planTree}><PlanContentTree value={detail.note??''} /></View>{error !== '' && <Text style={s.error}>{error}</Text>}{detail.date !== today && <Text style={s.hint}>历史记录只读</Text>}</Screen>}
    </Modal>
  </>;
}

export function PlanOverview({ onClose }: { onClose?: () => void }) {
  const { ctx, today, revision } = useApp();
  const [month, setMonth] = useState(monthOf(today));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => { let current = true; setLoading(true); const ds = monthDates(month); listTasksInRange(ctx.db, ds[0], ds[ds.length - 1]).then(t => { if (current) { setTasks(t.filter(x => x.date <= today)); setError(''); } }).catch(e => current && setError(message(e))).finally(() => current && setLoading(false)); return () => { current = false; }; }, [ctx, month, revision, today]);
  return <Screen title="" topBar={<PageBar title="计划概览" onBack={onClose??(()=>router.back())}/>}>
    <Row><Button title="上一月" secondary onPress={() => { setMonth(shiftMonth(month, -1)); }} /><Text style={s.heading}>{monthText(month)}</Text>{month < monthOf(today) && <Button title="下一月" secondary onPress={() => { setMonth(shiftMonth(month, 1)); }} />}</Row>
    {loading&&<Text style={s.hint}>正在读取…</Text>}
    {error !== '' && <Text style={s.error}>{error}</Text>}
    <View style={s.calendar}>{['一','二','三','四','五','六','日'].map(d => <Text key={d} style={s.week}>{d}</Text>)}{Array.from({ length: mondayOffset(month) }, (_, i) => <View key={`empty${i}`} style={s.day} />)}{monthDates(month).map(d => { const dp = taskProgress((loading || error ? [] : tasks).filter(t => t.date === d)); return <View key={d} accessible accessibilityLabel={`${d}，${dp.done}件完成，共${dp.active}件`} style={[s.day, d > today && { opacity: .3 }]}><Text style={s.body}>{Number(d.slice(-2))}</Text><Text style={s.tiny}>{d > today ? '' : dp.active ? `${dp.done}/${dp.active}` : '—'}</Text></View>; })}</View>
  </Screen>;
}

const s = StyleSheet.create({ideasHit:{minWidth:72,minHeight:48,justifyContent:'center',paddingHorizontal:4},ideasPill:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,paddingHorizontal:12,paddingVertical:7,borderRadius:18,backgroundColor:C.apricot},ideasLabel:{fontSize:13,fontWeight:'500',color:C.accent},planTree:{paddingVertical:4},treeRow:{flexDirection:'row',alignItems:'stretch'},treeRail:{width:28,position:'relative'},treeTrunk:{position:'absolute',left:6,top:0,bottom:0,width:1,backgroundColor:C.line},treeLast:{bottom:'50%'},treeBranch:{position:'absolute',left:6,top:'50%',width:14,height:1,backgroundColor:C.line},treeDot:{position:'absolute',left:18,top:'50%',marginTop:-2,width:5,height:5,borderRadius:3,backgroundColor:C.accent},contentRow:{flexDirection:'row',alignItems:'flex-start',borderBottomWidth:1,borderColor:C.line},contentNumber:{width:24,paddingTop:13,color:C.accent,fontSize:14},contentInput:{flex:1,minHeight:48,paddingVertical:12,fontSize:15,color:C.text,textAlignVertical:'top'},removeLine:{width:48,height:48,alignItems:'center',justifyContent:'center'},addLine:{minHeight:44,flexDirection:'row',alignItems:'center',gap:6},levels:{flexDirection:'row',gap:8},level:{width:44,height:44,borderRadius:10,borderWidth:1,borderColor:'transparent',alignItems:'center',justifyContent:'center'},levelSelected:{backgroundColor:C.apricot,borderColor:C.accent},levelIcon:{width:25,height:25,borderRadius:13,borderWidth:1,borderColor:C.muted,alignItems:'center',justifyContent:'center'},levelIconSelected:{backgroundColor:C.accent,borderColor:C.accent},levelNumber:{fontSize:14,fontWeight:'600',color:C.muted},headerSettings:{width:48,height:48,alignItems:'center',justifyContent:'center'},headerDates:{position:'absolute',right:0,bottom:2,flexDirection:'row'},headerArrow:{width:48,height:48,alignItems:'center',justifyContent:'center'}, heading: { color: C.text, fontSize: 17, fontWeight: '600', flexShrink: 1 }, big: { color: C.text, fontSize: 25, fontWeight: '600' }, hint: { color: C.muted, fontSize: 13, lineHeight: 21 }, body: { color: C.text, fontSize: 15, lineHeight: 25 }, error: { color: '#A83224', fontSize: 14 }, taskName: { fontSize: 15, color: C.text, fontWeight: '600', lineHeight: 24 }, completed: { textDecorationLine: 'line-through' }, calendar: { flexDirection: 'row', flexWrap: 'wrap' }, week: { width: '14.2857%', textAlign: 'center', paddingVertical: 10, color: C.muted }, day: { width: '14.2857%', minHeight: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, selected: { backgroundColor: '#EADACC' }, tiny: { fontSize: 11, color: C.muted }, filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 } });
