import { DateField } from '../ui/DateTimeField';
/* eslint-disable react-hooks/set-state-in-effect -- Synchronizes persisted SQLite lists and editor drafts. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Screen, Button, Field, Card, C } from '../ui/kit';
import { useApp } from '../ui/context';
import { useConfirm, useDialog } from '../ui/confirm';
import { getDraft, saveDraft, deleteDraft } from '../data/draftRepo';
import { listShopping, createShopping, updateShopping, setShoppingStatus, deleteShopping } from '../data/shoppingRepo';
import { listLifeRecords, createLifeRecord, updateLifeRecord, deleteLifeRecord } from '../data/lifeRepo';
import { centsToInput, formatPrice, validateShopping, validateLifeRecord, type LifeRecordInput, type ShoppingInput } from '../domain/validation';
import { startedDays, todayOf } from '../domain/dates';
import type { LifeKind, LifeRecord, ShoppingItem } from '../domain/types';
import LifeHeader from './LifeHeader';
import { ListScreen } from '../ui/ListScreen';
type Kind='shopping'|LifeKind;
type Editor={id:string|null;input:ShoppingInput|LifeRecordInput};
const labels:Record<Kind,string>={shopping:'购物',membership:'会员',fixed:'固定支出'};
const message=(error:unknown)=>error instanceof Error?error.message:'操作失败，请重试';
export default function LifeToolsScreen({kind,navigation,active=true}:{kind:Kind;navigation:React.ReactNode;active?:boolean}){
 const {ctx,today,revision,refresh}=useApp();const confirm=useConfirm(),dialog=useDialog();
 const label=labels[kind],key=`${kind}:editor`;
 const [shopping,setShopping]=useState<ShoppingItem[]>([]),[records,setRecords]=useState<LifeRecord[]>([]);
 const [status,setStatus]=useState<ShoppingItem['status']>('pending');
 const [displayedStatus,setDisplayedStatus]=useState<ShoppingItem['status']>('pending');
 const [statusRevision,setStatusRevision]=useState(0);
 const [editor,setEditor]=useState<Editor|null>(null),[draft,setDraft]=useState<Editor|null>(null);
 const [error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false);
 const request=useRef(0),lock=useRef(false),draftBlocked=useRef(false),savedId=useRef<string|null>(null);
 const draftChain=useRef<Promise<void>>(Promise.resolve());
 const load=useCallback(async()=>{
  const token=++request.current;
  try{const [rows,saved]=await Promise.all([kind==='shopping'?listShopping(ctx.db,status):listLifeRecords(ctx.db,kind),getDraft<Editor>(ctx.db,key)]);if(token!==request.current)return;if(kind==='shopping'){setShopping(rows as ShoppingItem[]);setDisplayedStatus(status);}else setRecords(rows as LifeRecord[]);setDraft(saved?.payload??null);}
  catch(e){if(token===request.current)setError(message(e));}finally{if(token===request.current)setLoading(false);}
 },[ctx,kind,status,key]);
 useEffect(()=>{const requests=request;void load();return()=>{requests.current++;};},[load,revision,statusRevision]);
 useEffect(()=>{if(!editor||draftBlocked.current)return;draftChain.current=draftChain.current.catch(()=>{}).then(()=>saveDraft(ctx,key,null,editor));void draftChain.current.catch(e=>setError(message(e)));},[ctx,key,editor]);
 const act=async(work:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work();await load();}catch(e){draftBlocked.current=false;setError(message(e));}finally{lock.current=false;setBusy(false);}};
 const freeze=async()=>{draftBlocked.current=true;await draftChain.current.catch(()=>{});};
 const clear=async()=>{await freeze();try{await deleteDraft(ctx,key);setDraft(null);}catch(e){draftBlocked.current=false;throw e;}};
 const resume=(value:Editor)=>{draftBlocked.current=false;savedId.current=value.id;setError('');setEditor(value);};
 const open=async(row?:ShoppingItem|LifeRecord)=>{
  if(lock.current)return;
  if(draft){const choice=await dialog({title:'有未保存的草稿',actions:[{label:'取消',value:'cancel'},{label:'继续草稿',value:'resume'},{label:'丢弃并继续',value:'discard',destructive:true}]});if(choice==='resume'){resume(draft);return;}if(choice!=='discard')return;let discarded=false;await act(async()=>{await clear();discarded=true;});if(!discarded)return;}
  const input:ShoppingInput|LifeRecordInput=kind==='shopping'?{name:row?.name??'',note:row?.note??''}:{name:row?.name??'',startDate:row&&'startDate' in row?row.startDate:todayOf(ctx.clock),amount:row&&'amountCents' in row?centsToInput(row.amountCents):'',note:row?.note??''};
  resume({id:row?.id??null,input});
 };
 const close=async()=>{
  if(lock.current)return;
  const choice=await dialog({title:`保留未保存的${label}？`,actions:[{label:'继续填写',value:'continue'},{label:'保留草稿',value:'keep'},{label:'丢弃草稿',value:'discard',destructive:true}]});
  if(choice==='keep')await act(async()=>{await freeze();if(editor)await saveDraft(ctx,key,null,{...editor,id:savedId.current??editor.id});setEditor(null);});
  if(choice==='discard')await act(async()=>{await clear();setEditor(null);savedId.current=null;});
 };
 const save=()=>void act(async()=>{
  if(!editor)return;
  const id=savedId.current??editor.id;
  const saved=kind==='shopping'?(id?await updateShopping(ctx,id,validateShopping(editor.input)):await createShopping(ctx,validateShopping(editor.input))):(id?await updateLifeRecord(ctx,id,kind,validateLifeRecord(editor.input as LifeRecordInput,todayOf(ctx.clock))):await createLifeRecord(ctx,kind,validateLifeRecord(editor.input as LifeRecordInput,todayOf(ctx.clock))));
  savedId.current=saved.id;await freeze();const updated={...editor,id:saved.id};setEditor(updated);
  // Persist the new ID before draft removal. Retry must update the successful insert.
  await saveDraft(ctx,key,null,updated);await clear();setEditor(null);savedId.current=null;refresh();
 });
 const change=(field:string,value:string)=>{if(!lock.current)setEditor(old=>old?{...old,input:{...old.input,[field]:value}}:old);};
 const remove=async(row:ShoppingItem|LifeRecord)=>{if(await confirm({title:`删除「${row.name}」？`,message:'此操作无法撤销。',confirmText:'删除',destructive:true}))await act(async()=>{if(kind==='shopping')await deleteShopping(ctx,row.id);else await deleteLifeRecord(ctx,row.id,kind);});};
 const pull=()=>void act(async()=>{setRefreshing(true);try{await load();}finally{setRefreshing(false);}});
 return <>
  <ListScreen<ShoppingItem|LifeRecord> compact={kind==='shopping'} data={loading?[]:kind==='shopping'?shopping:records} keyExtractor={row=>row.id} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} colors={[C.accent]}/>} header={<>
   <LifeHeader navigation={navigation} addLabel={`添加${label}`} onAdd={()=>void open()} disabled={busy}/>
   {kind==='shopping'&&<View style={{flexDirection:'row',gap:24}}>{(['pending','done'] as const).map(value=><Pressable key={value} accessibilityRole="tab" accessibilityState={{selected:displayedStatus===value}} onPress={()=>{request.current++;setStatus(value);setStatusRevision(v=>v+1);}} style={{minHeight:48,justifyContent:'center'}}><Text style={{fontSize:14,color:displayedStatus===value?C.accent:C.muted}}>{value==='pending'?'待买':'已买'}</Text></Pressable>)}</View>}
   {draft&&<Button title="继续未保存的草稿" secondary disabled={busy} onPress={()=>resume(draft)}/>}
   {!!error&&<><Text accessibilityRole="alert" style={lifeStyles.error}>{error}</Text><Button title="重试读取" secondary disabled={busy} onPress={()=>void act(load)}/></>}
   {loading?<Text style={lifeStyles.hint}>正在读取{label}…</Text>:!(kind==='shopping'?shopping:records).length?<Card><Text style={lifeStyles.name}>{kind==='shopping'&&displayedStatus==='done'?'暂无已买记录':`暂无${label}记录`}</Text></Card>:null}
  </>} renderItem={({item:row})=>'status' in row?<View style={[lifeStyles.row,{paddingVertical:3}]}>
    <Pressable accessibilityRole="checkbox" accessibilityLabel={`${row.name}，${row.status==='done'?'已买':'待买'}`} accessibilityState={{checked:row.status==='done',disabled:busy}} disabled={busy} onPress={()=>void act(()=>setShoppingStatus(ctx,row.id,row.status==='done'?'pending':'done'))} style={lifeStyles.icon}><Feather name={row.status==='done'?'check-circle':'circle'} color={row.status==='done'?C.sage:C.muted} size={22}/></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`编辑${row.name}`} disabled={busy} onPress={()=>void open(row)} style={{flex:1,minHeight:48,justifyContent:'center',gap:4}}><Text style={[lifeStyles.name,row.status==='done'&&{color:C.muted,textDecorationLine:'line-through'}]}>{row.name}</Text>{row.note&&<Text style={lifeStyles.hint}>{row.note}</Text>}</Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`删除${row.name}`} disabled={busy} onPress={()=>void remove(row)} style={lifeStyles.icon}><Feather name="trash-2" color={C.muted} size={17}/></Pressable>
   </View>:<View style={lifeStyles.row}><Pressable accessibilityRole="button" accessibilityLabel={`编辑${row.name}`} disabled={busy} onPress={()=>void open(row)} style={{flex:1,minHeight:48,gap:4}}><Text style={lifeStyles.name}>{row.name}</Text><Text style={lifeStyles.hint}>{row.startDate} · 已开始 {startedDays(row.startDate,today)} 天</Text>{row.amountCents!==null&&<Text style={lifeStyles.amount}>{formatPrice(row.amountCents)}</Text>}{row.note&&<Text style={lifeStyles.hint}>{row.note}</Text>}</Pressable><Pressable accessibilityRole="button" accessibilityLabel={`删除${row.name}`} disabled={busy} onPress={()=>void remove(row)} style={lifeStyles.icon}><Feather name="trash-2" color={C.muted} size={17}/></Pressable></View>} />
  <Modal visible={active&&!!editor} animationType="fade" onRequestClose={()=>void close()}>{editor&&<Screen title={`${editor.id?'编辑':'添加'}${label}`} action={<Button title="返回" secondary disabled={busy} onPress={()=>void close()}/>}>
   {!!error&&<Text accessibilityRole="alert" style={lifeStyles.error}>{error}</Text>}
   <Field label="名称" value={editor.input.name} onChangeText={v=>change('name',v)}/>
   {kind!=='shopping'&&<><DateField label="开始日期" value={(editor.input as LifeRecordInput).startDate} onChange={v=>change('startDate',v)} max={today}/><Field label="金额（元，选填）" keyboardType="decimal-pad" value={(editor.input as LifeRecordInput).amount} onChangeText={v=>change('amount',v)}/></>}
   <Field label="备注（选填）" multiline value={editor.input.note} onChangeText={v=>change('note',v)}/>
   <Button title={busy?'保存中…':`保存${label}`} disabled={busy} onPress={save}/>
  </Screen>}</Modal>
 </>;
}
const lifeStyles=StyleSheet.create({icon:{width:48,minHeight:48,alignItems:'center',justifyContent:'center'},row:{flexDirection:'row',alignItems:'center',gap:4,paddingVertical:12,borderBottomWidth:1,borderColor:C.line},name:{fontSize:16,lineHeight:23,color:C.text,fontWeight:'600'},hint:{fontSize:13,lineHeight:20,color:C.muted},amount:{fontSize:16,lineHeight:23,fontWeight:'600',color:C.accent},error:{fontSize:14,lineHeight:21,color:C.accent}});
