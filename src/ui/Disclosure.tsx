import React,{useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {C} from './kit';
export function Disclosure({title,children,initiallyOpen=false,open,onToggle}:{title:string;children:React.ReactNode;initiallyOpen?:boolean;open?:boolean;onToggle?:()=>void}){
 const [local,setLocal]=useState(initiallyOpen);const expanded=open??local;
 return <View style={s.section}><Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{expanded}} onPress={onToggle??(()=>setLocal(v=>!v))} style={({pressed})=>[s.header,pressed&&{backgroundColor:C.apricot}]}><Text style={s.title}>{title}</Text><Feather name={expanded?'chevron-up':'chevron-down'} size={18} color={C.muted}/></Pressable>{expanded&&<View style={s.content}>{children}</View>}</View>;
}
const s=StyleSheet.create({section:{borderBottomWidth:1,borderColor:C.line},header:{minHeight:48,paddingVertical:12,flexDirection:'row',alignItems:'center',gap:8},title:{flex:1,fontSize:16,fontWeight:'600',color:C.text},content:{gap:10,paddingBottom:16}});
