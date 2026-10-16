import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { C } from './kit';
import { useReducedMotion } from './motion';
export type DialogAction={label:string;value:string;destructive?:boolean};
export type DialogOptions={title:string;message?:string;actions:DialogAction[]};
export type ConfirmOptions={title:string;message?:string;confirmText?:string;destructive?:boolean};
type ShowDialog=(options:DialogOptions)=>Promise<string|null>;
const Context=createContext<ShowDialog|null>(null);
/** One host for confirmation sheets across screens, including already-open form modals. */
export function ConfirmProvider({children}:{children:React.ReactNode}){
 const reduced=useReducedMotion();
 const {fontScale}=useWindowDimensions();
 const [options,setOptions]=useState<DialogOptions|null>(null);
 const pending=useRef<((value:string|null)=>void)|null>(null);
 const [progress]=useState(()=>new Animated.Value(0));
 const closing=useRef(false);
 const show=useCallback<ShowDialog>(input=>{if(pending.current)return Promise.resolve(null);closing.current=false;setOptions(input);return new Promise(resolve=>{pending.current=resolve})},[]);
 const finish=useCallback((value:string|null)=>{if(closing.current)return;closing.current=true;setOptions(null);pending.current?.(value);pending.current=null;progress.setValue(0)},[progress]);
 useEffect(()=>()=>{pending.current?.(null)},[]);
 const animate=()=>{Animated.timing(progress,{toValue:1,duration:reduced?0:190,easing:Easing.out(Easing.cubic),useNativeDriver:true}).start()};
 return <Context.Provider value={show}>{children}<Modal transparent visible={!!options} animationType={reduced?'none':'fade'} statusBarTranslucent onShow={animate} onRequestClose={()=>finish(null)}><View style={styles.overlay}><Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={()=>finish(null)}/><Animated.View accessibilityViewIsModal style={[styles.panel,{opacity:progress,transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[12,0]})},{scale:progress.interpolate({inputRange:[0,1],outputRange:[.985,1]})}]}]}><ScrollView contentContainerStyle={{gap:12,paddingHorizontal:Math.min(2,Math.max(0,fontScale-1))}} bounces={false}><Text accessibilityRole="header" style={styles.title}>{options?.title}</Text>{options?.message?<Text style={styles.message}>{options.message}</Text>:null}<View style={styles.actions}>{options?.actions.map(action=><Pressable key={action.value} hitSlop={2} accessibilityRole="button" onPress={()=>finish(action.value)} style={({pressed})=>[styles.action,{backgroundColor:action.destructive?C.accent:C.apricot,opacity:pressed?.75:1}]}><Text style={{fontSize:14,fontWeight:'600',color:action.destructive?'white':C.text}}>{action.label}</Text></Pressable>)}</View></ScrollView></Animated.View></View></Modal></Context.Provider>
}
export function useDialog(){const show=useContext(Context);if(!show)throw new Error('ConfirmProvider missing');return show;}
export function useConfirm(){const show=useDialog();return useCallback(async({title,message,confirmText='删除',destructive=true}:ConfirmOptions)=>(await show({title,message,actions:[{label:'取消',value:'cancel'},{label:confirmText,value:'confirm',destructive}]}))==='confirm',[show]);}
const styles=StyleSheet.create({overlay:{flex:1,backgroundColor:'#231A1659',justifyContent:'center',padding:28},panel:{width:'100%',maxHeight:'85%',maxWidth:380,alignSelf:'center',backgroundColor:C.surface,padding:22,borderRadius:20,borderWidth:1,borderColor:C.line,gap:12,shadowColor:'#382F2B',shadowOpacity:.1,shadowRadius:20,elevation:8},title:{fontSize:19,lineHeight:28,fontWeight:'600',color:C.text},message:{fontSize:14,lineHeight:22,color:C.muted},actions:{flexDirection:'row',gap:10,marginTop:8,flexWrap:'wrap'},action:{flexGrow:1,minHeight:44,paddingHorizontal:12,paddingVertical:10,alignItems:'center',justifyContent:'center',borderRadius:11}});
