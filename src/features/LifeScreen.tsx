import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { C } from '../ui/kit';
import { useReducedMotion } from '../ui/motion';
import CollectionScreen from './CollectionScreen';
import ItemsScreen from './ItemsScreen';
import LifeToolsScreen from './LifeToolsScreen';
type Section='items'|'shopping'|'membership'|'fixed'|'collections';
const sections:readonly [Section,string][]=[['items','物品'],['shopping','购物'],['membership','会员'],['fixed','固定支出'],['collections','收藏']];
/** Every mounted panel owns its scroll position; selection remains visible after panel/font/width changes. */
function LifeNavigation({section,active,onSelect}:{section:Section;active:boolean;onSelect:(section:Section)=>void}){
 const scroll=useRef<ScrollView>(null),viewport=useRef(0),content=useRef(0),offset=useRef(0),tabs=useRef<Partial<Record<Section,{x:number;width:number}>>>({});
 const {width,fontScale}=useWindowDimensions();const reduced=useReducedMotion();
 const reveal=useCallback(()=>{
  if(!active)return;const selected=tabs.current[section],visible=viewport.current;if(!selected||visible<=0||content.current<=0)return;
  const current=offset.current,margin=4;
  let next=current;if(selected.width+2*margin>visible||selected.x<current+margin)next=selected.x-margin;else if(selected.x+selected.width>current+visible-margin)next=selected.x+selected.width-visible+margin;
  next=Math.max(0,Math.min(next,Math.max(0,content.current-visible)));
  if(Math.abs(next-current)>.5){offset.current=next;scroll.current?.scrollTo({x:next,y:0,animated:!reduced});}
 },[section,active,reduced]);
 useEffect(()=>{reveal()},[reveal,width,fontScale]);
 return <ScrollView ref={scroll} horizontal style={lifeStyles.scroll} showsHorizontalScrollIndicator={false} contentContainerStyle={lifeStyles.navigation} onLayout={event=>{viewport.current=event.nativeEvent.layout.width;reveal()}} onContentSizeChange={w=>{content.current=w;reveal()}} onScroll={event=>{offset.current=event.nativeEvent.contentOffset.x}} scrollEventThrottle={16}>{sections.map(([key,label])=><Pressable key={key} onLayout={event=>{tabs.current[key]=event.nativeEvent.layout;reveal()}} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{selected:section===key}} onPress={()=>onSelect(key)} style={({pressed})=>[lifeStyles.tab,{opacity:pressed?.7:1}]}><View style={[lifeStyles.pill,section===key&&lifeStyles.selected]}><Text style={[lifeStyles.label,section===key&&lifeStyles.selectedLabel]}>{label}</Text></View></Pressable>)}</ScrollView>;
}
export default function LifeScreen(){
 const [section,setSection]=useState<Section>('items');
 const select=(next:Section)=>{if(next!==section){Keyboard.dismiss();setSection(next);}};
 // Keep all five mounted at fixed sibling positions so their filters and content scroll survive switching.
 return <View style={lifeStyles.container}>{sections.map(([key])=>{const active=section===key,navigation=<LifeNavigation section={section} active={active} onSelect={select}/>;return <View key={key} collapsable={false} pointerEvents={active?'auto':'none'} accessibilityElementsHidden={!active} importantForAccessibility={active?'auto':'no-hide-descendants'} style={[StyleSheet.absoluteFill,{opacity:active?1:0,zIndex:active?1:0}]}>{key==='collections'?<CollectionScreen active={active} navigation={navigation}/>:key==='items'?<ItemsScreen active={active} navigation={navigation}/>:<LifeToolsScreen active={active} kind={key} navigation={navigation}/>}</View>;})}</View>;
}
const lifeStyles=StyleSheet.create({container:{flex:1,backgroundColor:C.bg},scroll:{flexGrow:0,minWidth:0},navigation:{gap:2,paddingHorizontal:2},tab:{minHeight:48,minWidth:48,justifyContent:'center'},pill:{paddingHorizontal:10,paddingVertical:7,borderRadius:16},selected:{backgroundColor:C.apricot},label:{fontSize:14,lineHeight:20,color:C.muted},selectedLabel:{color:C.accent,fontWeight:'600'}});
