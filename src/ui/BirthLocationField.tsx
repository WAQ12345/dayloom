import React,{useState} from 'react';
import {Modal,Text} from 'react-native';
import {Button,C,Field,Row,Screen} from './kit';
import {searchBirthLocations,birthLocationNote} from '../domain/bazi/locations';
import type {BirthLocation} from '../domain/bazi/birthTime';
export function BirthLocationField({value,onChange}:{value?:BirthLocation;onChange:(value?:BirthLocation)=>void}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState('');const results=searchBirthLocations(query);
 return <><Text style={{color:C.text}}>出生地点（江苏省）</Text><Button title={value?.name??'选择江苏出生地点'} secondary onPress={()=>{setQuery('');setOpen(true);}}/>{value&&<Text style={{color:C.muted,fontSize:12}}>{birthLocationNote(value)} · 经度 {value.longitude}°</Text>}
 <Modal visible={open} animationType="fade" onRequestClose={()=>setOpen(false)}><Screen title="选择江苏出生地点" action={<Button title="返回" secondary onPress={()=>setOpen(false)}/>}>
 <Field label="搜索地点" value={query} onChangeText={setQuery}/><Row>{!!query&&<Button title="清空搜索" secondary onPress={()=>setQuery('')}/>}<Button title="清除地点" secondary onPress={()=>{onChange(undefined);setOpen(false);}}/></Row>
 {!!query.trim()&&(!results.length?<Text style={{color:C.muted}}>未找到江苏地点</Text>:<><Text style={{color:C.muted,fontSize:12}}>{results.length} 条结果</Text>{results.map(item=><Button key={item.id} title={`${item.name} · ${item.longitude}°`} secondary onPress={()=>{onChange(item);setOpen(false);}}/>)}</>)}
 </Screen></Modal></>;
}
