import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState, ActivityIndicator, Text, View } from 'react-native';
import { getContext } from '../data/native';
import type { DataContext } from '../data/sql';
import { reconcileReminder } from '../services/native';
import { todayOf, msUntilNextMidnight } from '../domain/dates';
const Context = createContext<{ctx:DataContext;today:string;revision:number;refresh:()=>void}|null>(null);
export function AppProvider({children}:{children:React.ReactNode}) {
 const [ctx,setCtx]=useState<DataContext|null>(null),[error,setError]=useState(''),[today,setToday]=useState(todayOf()),[revision,setRevision]=useState(0);
 const refresh=useCallback(()=>{setToday(todayOf());setRevision(v=>v+1)},[]);
 useEffect(()=>{getContext().then(setCtx).catch(e=>setError(String(e.message)))},[]);
 useEffect(()=>{if(!ctx)return;const reconcile=()=>{void reconcileReminder(ctx).catch(()=>undefined)};reconcile();const sub=AppState.addEventListener('change',state=>{if(state==='active')reconcile()});return()=>sub.remove()},[ctx]);
 useEffect(()=>{const sub=AppState.addEventListener('change',s=>{if(s==='active')refresh()});let timer:ReturnType<typeof setTimeout>;const tick=()=>{refresh();timer=setTimeout(tick,msUntilNextMidnight())};timer=setTimeout(tick,msUntilNextMidnight());return()=>{sub.remove();clearTimeout(timer)}},[refresh]);
 if(!ctx)return <View style={{flex:1,justifyContent:'center',padding:24,backgroundColor:'#FAF5EC'}}>{error?<Text accessibilityRole="alert">无法打开本地记录：{error}。请重新启动；请勿清除应用数据。</Text>:<ActivityIndicator color="#A94F36"/>}</View>;
 return <Context.Provider value={{ctx,today,revision,refresh}}>{children}</Context.Provider>;
}
export function useApp(){const value=useContext(Context);if(!value)throw new Error('AppProvider missing');return value;}
