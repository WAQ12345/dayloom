import React, { useState } from 'react';
import { FlatList, Keyboard, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button, C, s } from './kit';
import { isValidTime, localTime, localDate } from '../domain/dates';
import { solarToLunar } from '../domain/bazi/civil';
import { dateBounds, normalizePickerDate, pickerDate, pickerMonths, pickerYears, type CalendarKind, type DateSelection } from '../domain/datePicker';

type Base={label:string;value:string;disabled?:boolean;optional?:boolean};
type DateProps=Base&{onChange:(value:string,leap:boolean)=>void;calendar?:CalendarKind;leap?:boolean;min?:string;max?:string};
type TimeProps=Base&{onChange:(value:string)=>void};

function Column({label,options,value,onChange}:{label:string;options:{key:string;label:string}[];value:string;onChange:(key:string)=>void}){
 const {fontScale}=useWindowDimensions();const rowHeight=Math.max(48,Math.ceil(30*fontScale+16));
 return <View style={{flex:1,minWidth:0,gap:6}}><Text style={p.columnLabel}>{label}</Text><FlatList key={options.map(o=>o.key).join(',')} data={options} extraData={value} keyExtractor={o=>o.key} initialScrollIndex={Math.max(0,options.findIndex(o=>o.key===value)-1)} getItemLayout={(_,index)=>({length:rowHeight,offset:rowHeight*index,index})} renderItem={({item})=><Pressable accessibilityRole="radio" accessibilityLabel={`${label} ${item.label}`} accessibilityState={{selected:item.key===value}} onPress={()=>onChange(item.key)} style={({pressed})=>[p.option,{minHeight:rowHeight,backgroundColor:item.key===value?C.apricot:undefined,opacity:pressed?.65:1}]}><Text style={{color:item.key===value?C.accent:C.text,fontSize:16,fontWeight:item.key===value?'700':'400'}}>{item.label}</Text></Pressable>}/></View>;
}
function Sheet({label,children,onCancel,onConfirm,onClear}:{label:string;children:React.ReactNode;onCancel:()=>void;onConfirm:()=>void;onClear?:()=>void}){
 const insets=useSafeAreaInsets(),{height}=useWindowDimensions();
 return <Modal transparent animationType="none" onRequestClose={onCancel} statusBarTranslucent><View style={p.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="取消选择" accessibilityRole="button"/><View accessibilityViewIsModal style={[p.sheet,{paddingBottom:Math.max(20,insets.bottom),maxHeight:height-insets.top-24}]}><Text accessibilityRole="header" style={p.title}>{label}</Text><View style={{height:Math.min(270,height*.38),flexDirection:'row',gap:12}}>{children}</View><View style={p.actions}><Button title="取消" secondary onPress={onCancel}/>{onClear&&<Button title="清空" secondary onPress={onClear}/>}<View style={{flex:1}}/><Button title="确定" onPress={onConfirm}/></View></View></View></Modal>;
}
function Trigger({label,value,disabled,kind,onPress}:{label:string;value:string;disabled?:boolean;kind:'calendar'|'clock';onPress:()=>void}){
 return <View style={{gap:6}}><Text style={s.label}>{label}</Text><Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={`${label}，${value||'请选择'}`} accessibilityState={{disabled}} onPress={()=>{Keyboard.dismiss();onPress();}} style={({pressed})=>[s.input,p.trigger,{opacity:disabled?.45:pressed?.7:1}]}><Text style={{flex:1,color:value?C.text:C.muted,fontSize:15}}>{value||'请选择'}</Text><Feather name={kind} size={17} color={C.muted}/></Pressable></View>;
}
export function DateField({label,value,onChange,calendar='solar',leap=false,min,max,disabled,optional}:DateProps){
 const [draft,setDraft]=useState<DateSelection|null>(null);const bounds=dateBounds(min,max);
 const normalized=draft?normalizePickerDate(draft,calendar,bounds.min,bounds.max):null;
 const [year,month,day]=normalized?normalized.value.split('-').map(Number):[0,0,0];
 const months=normalized?pickerMonths(year,calendar,bounds.min,bounds.max):[];
 const selected=months.find(m=>m.month===month&&m.leap===normalized?.leap);
 const change=(v:DateSelection)=>setDraft(normalizePickerDate(v,calendar,bounds.min,bounds.max));
 const open=()=>{if(value){change({value,leap});return;}const today=localDate();if(calendar==='lunar'){const d=solarToLunar(today);change({value:pickerDate(d.year,d.month,d.day),leap:d.leap});}else change({value:today,leap:false});};
 return <><Trigger label={label} value={value?`${calendar==='lunar'?'农历 ':''}${value.replace(/-/g,' / ')}${leap?'（闰月）':''}`:''} disabled={disabled} kind="calendar" onPress={open}/>{normalized&&selected&&<Sheet label={`${label}${calendar==='lunar'?' · 农历':''}`} onCancel={()=>setDraft(null)} onConfirm={()=>{onChange(normalized.value,normalized.leap);setDraft(null);}} onClear={optional?()=>{onChange('',false);setDraft(null);}:undefined}>
 <Column label="年" value={String(year)} options={pickerYears(calendar,bounds.min,bounds.max).map(y=>({key:String(y),label:String(y)}))} onChange={y=>change({value:pickerDate(Number(y),month,day),leap:normalized.leap})}/>
 <Column label="月" value={selected.key} options={months} onChange={key=>{const m=months.find(m=>m.key===key)!;change({value:pickerDate(year,m.month,day),leap:m.leap});}}/>
 <Column label="日" value={String(day)} options={selected.days.map(d=>({key:String(d),label:`${d}日`}))} onChange={d=>change({value:pickerDate(year,month,Number(d)),leap:normalized.leap})}/>
 </Sheet>}</>;
}
export function TimeField({label,value,onChange,disabled,optional}:TimeProps){
 const [draft,setDraft]=useState<string|null>(null);const [hour,minute]=(draft??'00:00').split(':');
 const values=(n:number)=>Array.from({length:n},(_,i)=>({key:String(i).padStart(2,'0'),label:String(i).padStart(2,'0')}));
 return <><Trigger label={label} value={value} disabled={disabled} kind="clock" onPress={()=>setDraft(isValidTime(value)?value:localTime())}/>{draft!==null&&<Sheet label={label} onCancel={()=>setDraft(null)} onConfirm={()=>{onChange(draft);setDraft(null);}} onClear={optional?()=>{onChange('');setDraft(null);}:undefined}><Column label="时" value={hour} options={values(24)} onChange={h=>setDraft(`${h}:${minute}`)}/><Column label="分" value={minute} options={values(60)} onChange={m=>setDraft(`${hour}:${m}`)}/></Sheet>}</>;
}
const p=StyleSheet.create({trigger:{flexDirection:'row',alignItems:'center',gap:8,minHeight:48},overlay:{flex:1,justifyContent:'flex-end',backgroundColor:'#382F2B66'},sheet:{backgroundColor:C.bg,padding:20,borderTopLeftRadius:22,borderTopRightRadius:22,gap:18},title:{fontSize:18,fontWeight:'600',color:C.text},columnLabel:{fontSize:12,color:C.muted,textAlign:'center'},option:{alignItems:'center',justifyContent:'center',borderRadius:10},actions:{flexDirection:'row',gap:10,alignItems:'center'},});
