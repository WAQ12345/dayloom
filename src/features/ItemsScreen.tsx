import { ListScreen } from '../ui/ListScreen';
import { DateField } from '../ui/DateTimeField';
/* eslint-disable react-hooks/set-state-in-effect -- Effects synchronize the screen with the asynchronous SQLite repository. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, RefreshControl, StyleSheet, Switch, Text, TextInput, View, ScrollView, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Screen, Button, Field, Card, Row, C } from '../ui/kit';
import { useConfirm, useDialog } from '../ui/confirm';
import { useApp } from '../ui/context';
import { listItems, createItem, updateItem, deleteItem, listCategories, addCategory, renameCategory, deleteCategory } from '../data/itemRepo';
import { getDraft, saveDraft, deleteDraft } from '../data/draftRepo';
import { validateItem, formatPrice, centsToInput, type ItemInput } from '../domain/validation';
import type { Item } from '../domain/types';
import type { PhotoChange } from '../data/foodRepo';
import LifeHeader from './LifeHeader';

const empty = (category: string): ItemInput => ({ name: '', category, purchaseDate: '', unknownDate: true, price: '', unknownPrice: true, location: '', brand: '', note: '' });
type Editor = { id: string | null; input: ItemInput; photo: string | null; originalPhoto: string | null; photoChanged: boolean };
const errorText = (e: unknown) => e instanceof Error ? e.message : '操作失败，请重试';
export default function ItemsScreen({navigation,active=true}:{navigation?:React.ReactNode;active?:boolean}) {
  const confirm = useConfirm();
  const dialog = useDialog();
  const { ctx, revision, refresh } = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState('recent');
  const [loading, setLoading] = useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const refreshLock=useRef(false);
  const loaded=useRef(false);
  const request = useRef(0);
  const draftChain = useRef<Promise<void>>(Promise.resolve());
  const draftBlocked = useRef(false);
  const actionLock = useRef(false);
  const [error, setError] = useState('');
  // Permission dialogs trigger foreground reloads; keep photo feedback independent.
  const [photoError, setPhotoError] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Item | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  useEffect(() => { if (!editor) setPhotoError(''); }, [editor]);
  const [draft, setDraft] = useState<Editor | null>(null);
  const [manage, setManage] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [rename, setRename] = useState<string | null>(null);
  const load = useCallback(async (quiet=false) => {
    const run = ++request.current;
    if(!quiet&&!loaded.current)setLoading(true);
    try { const [is, cs, ds] = await Promise.all([listItems(ctx.db, query, category), listCategories(ctx.db), getDraft<Editor>(ctx.db, 'item:editor')]); if (run !== request.current) return; loaded.current=true; setItems(is); setCategories(cs); setDraft(ds?.payload ?? null); setError(''); } catch(e) { if (run === request.current) setError(errorText(e)); } finally { if (run === request.current) {setLoading(false);} }
  }, [ctx, query, category]);
  const pullRefresh=async()=>{if(refreshLock.current)return;refreshLock.current=true;setRefreshing(true);try{await load(true);}finally{refreshLock.current=false;setRefreshing(false);}};
  useEffect(() => { void load(); }, [load, revision]);
  useEffect(() => { if (editor && !draftBlocked.current) { draftChain.current=draftChain.current.catch(()=>{}).then(()=>saveDraft(ctx,'item:editor',null,editor)); void draftChain.current.catch(e=>setError(errorText(e))); } },[ctx,editor]);
  const clearEditorDraft = async () => { draftBlocked.current=true; try { await draftChain.current.catch(() => {}); await deleteDraft(ctx,'item:editor'); } catch(e) { draftBlocked.current=false; throw e; } };
  const act = async (work: () => Promise<unknown>) => { if (actionLock.current) return; actionLock.current = true; setBusy(true); setError(''); try { await work(); refresh(); await load(); } catch(e) { setError(errorText(e)); } finally { actionLock.current = false; setBusy(false); } };
  const edit = async (item?: Item, replace = false):Promise<void> => {
    if (busy) return;
    if (draft && !replace) {
      const choice=await dialog({title:'有未保存的草稿',actions:[{label:'取消',value:'cancel'},{label:'继续草稿',value:'continue'},{label:'丢弃并继续',value:'discard',destructive:true}]});
      if(choice==='continue'){draftBlocked.current=false;setDetail(null);setEditor(draft);}
      if(choice==='discard')await act(async()=>{await clearEditorDraft();await edit(item,true);});
      return;
    }
    draftBlocked.current=false;setDetail(null);setError('');setEditor({id:item?.id??null,input:item?{name:item.name,category:item.category,purchaseDate:item.purchaseDate??'',unknownDate:item.purchaseDate===null,price:centsToInput(item.priceCents),unknownPrice:item.priceCents===null,location:item.location??'',brand:item.brand??'',note:item.note??''}:empty(categories[0]??''),photo:item?.photo?ctx.photos.uri(item.photo):null,originalPhoto:item?.photo??null,photoChanged:false});
  };
  const change = (key: keyof ItemInput, value: string | boolean) => !busy && setEditor(e => e ? { ...e, input: { ...e.input, [key]: value } } : e);
  const close = async () => {
    if (busy) return;
    const choice=await dialog({title:'保留未保存的物品？',actions:[{label:'继续填写',value:'continue'},{label:'保留草稿',value:'keep'},{label:'丢弃草稿',value:'discard',destructive:true}]});
    if(choice==='keep')await act(async()=>{if(editor){await draftChain.current;await saveDraft(ctx,'item:editor',null,editor);}setEditor(null);});
    if(choice==='discard')await act(async()=>{await clearEditorDraft();setEditor(null);});
  };
  const photo = async (camera: boolean) => {
    setPhotoError(''); try {
      if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) { setPhotoError('未获得相机权限，可选择相册照片或继续填写。'); return; }
      const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: .8, allowsEditing: true }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: .8, allowsEditing: true });
      if (!result.canceled) {
        // Persist the selection immediately: a draft must not depend on a temporary picker URI.
        const name = await ctx.photos.importFromUri(result.assets[0].uri);
        setEditor(e => e ? { ...e, photo: ctx.photos.uri(name), photoChanged: true } : e);
      }
    } catch(e) { setPhotoError(errorText(e)); }
  };
  const displayed = [...items].sort((a,b) => sort === 'price' ? (b.priceCents ?? -1) - (a.priceCents ?? -1) : sort === 'created' ? b.createdAt - a.createdAt : (b.purchaseDate ?? '').localeCompare(a.purchaseDate ?? ''));
  return <>
    <ListScreen data={loading ? [] : displayed} keyExtractor={item=>item.id} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>void pullRefresh()} colors={[C.accent]} tintColor={C.accent}/>} header={<>
      <LifeHeader navigation={navigation} addLabel="添加物品" onAdd={()=>void edit()} disabled={busy}/>
      <View style={s.searchToolbar}>
        <TextInput accessibilityLabel="搜索物品" value={query} onChangeText={setQuery} placeholder="搜索物品" autoCapitalize="none" returnKeyType="search" placeholderTextColor={C.muted} style={s.searchInput}/>
        <Dropdown active={active} label="排序" value={sort} options={[{value:'recent',label:'最近购入'},{value:'price',label:'价格从高到低'},{value:'created',label:'最近添加'}]} onChange={setSort} compact />
        <Pressable accessibilityRole="button" accessibilityLabel="管理分类" onPress={()=>{setError('');setManage(true);}} style={({pressed})=>[s.toolbarIcon,{opacity:pressed?.65:1}]}><Feather name="grid" size={18} color={C.muted}/></Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categoryNav}>{[null,...categories].map(c => <Pressable key={c===null?'all':`category:${c}`} accessibilityRole="tab" accessibilityState={{ selected: category === c }} onPress={() => setCategory(c)} style={[s.categoryTab,category === c && s.categoryTabActive]}><Text style={[s.categoryLabel,category === c && s.categoryLabelActive]}>{c ?? '全部'}</Text></Pressable>)}</ScrollView>
      <Text style={s.hint}>{items.length} 件物品</Text>
      {draft && <Button title="继续未保存的草稿" secondary onPress={() => { draftBlocked.current=false; setEditor(draft); }} />}
      {error !== '' && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
      {loading ? <Text style={s.hint}>正在读取物品…</Text> : !displayed.length ? <Card><Text style={s.heading}>{query || category ? '没有找到物品' : '暂无物品'}</Text><Text style={s.hint}>{query || category ? '试试其他关键词，或选择全部分类。' : '添加你的第一件物品。'}</Text></Card> : null}</>} renderItem={({item:i}) => <Pressable accessibilityRole="button" accessibilityLabel={`查看${i.name}`} onPress={() => setDetail(i)} style={s.item}>
        {i.photo ? <Image source={{ uri: ctx.photos.uri(i.photo) }} style={s.thumb} resizeMode="cover" /> : <View style={s.placeholder}><Text style={s.placeholderText}>{i.category.slice(0,1)}</Text></View>}
        <View style={{ flex: 1 }}><Text style={s.name}>{i.name}</Text><Text style={s.hint}>{i.category} · {i.purchaseDate ?? '购买日期未知'}</Text><Text style={s.price}>{formatPrice(i.priceCents)}</Text></View><Text style={s.hint}>›</Text>
      </Pressable>} />
    <Modal visible={active&&!!detail} animationType="fade" onRequestClose={() => setDetail(null)}>{detail && <Screen title="物品档案" action={<Button title="返回" secondary onPress={() => setDetail(null)} />}>
      {detail.photo && <Image source={{ uri: ctx.photos.uri(detail.photo) }} style={s.fullPhoto} resizeMode="contain" />}
      <Text style={s.title}>{detail.name}</Text><Text style={s.priceLarge}>{formatPrice(detail.priceCents)}</Text>
      <Card>{[['类型',detail.category],['购买日期',detail.purchaseDate ?? '未知'],['品牌 / 型号',detail.brand],['备注',detail.note]].filter(([,value])=>value!==null).map(([k,v]) => <View key={k} style={s.detailRow}><Text style={s.hint}>{k}</Text><Text style={s.body}>{v}</Text></View>)}</Card>
      {error !== '' && <Text style={s.error}>{error}</Text>}<Button title="编辑物品" onPress={() => edit(detail)} /><Button title="删除物品" secondary disabled={busy} onPress={() => void (async()=>{const item=detail;if(await confirm({title:`删除「${item.name}」？`,message:'此操作无法撤销。',confirmText:'删除',destructive:true}))await act(async()=>{await deleteItem(ctx,item.id);setDetail(null);});})()} />
    </Screen>}</Modal>
    <Modal visible={active&&!!editor} animationType="fade" onRequestClose={close}>{editor && <Screen title={editor.id ? '编辑物品' : '添加物品'} action={<Button title="返回" secondary onPress={close} />}>
      {error !== '' && <Text style={s.error} accessibilityRole="alert">{error}</Text>}{photoError!==''&&<Text style={s.error} accessibilityRole="alert">{photoError}</Text>}
      {editor.photo && <Image source={{ uri: editor.photo }} style={s.fullPhoto} resizeMode="contain" />}
      <Row><Button title="拍照" secondary onPress={() => void photo(true)} /><Button title="选择照片" secondary onPress={() => void photo(false)} />{editor.photo && <Button title="移除照片" secondary onPress={() => setEditor(e => e ? { ...e, photo: null, photoChanged: true } : e)} />}</Row>
      <Field label="物品名称" value={editor.input.name} onChangeText={v => change('name',v)} />
      <View style={{gap:4}}><Text style={s.body}>类型</Text><Dropdown active={active} label="物品类型" value={editor.input.category} options={categories.map(c=>({value:c,label:c}))} onChange={c=>change('category',c)} disabled={busy} /></View>
      {!categories.length && <Text style={s.error}>请先返回，在管理分类中添加分类。</Text>}
      <Row><Text style={s.body}>购买日期未知</Text><Switch accessibilityLabel="购买日期未知" value={editor.input.unknownDate} onValueChange={v => { change('unknownDate',v); }} trackColor={{ true: C.sage }} /></Row>
      {!editor.input.unknownDate && <DateField label="购买日期" value={editor.input.purchaseDate} onChange={v => change('purchaseDate',v)} max="2100-12-31" />}
      <Row><Text style={s.body}>购买价未知</Text><Switch accessibilityLabel="购买价未知" value={editor.input.unknownPrice} onValueChange={v => { change('unknownPrice',v); }} trackColor={{ true: C.sage }} /></Row>
      {!editor.input.unknownPrice && <Field label="购买价（元）" value={editor.input.price} onChangeText={v => change('price',v)} keyboardType="decimal-pad" placeholder="免费物品填 0" />}
      <Field label="品牌 / 型号（选填）" value={editor.input.brand} onChangeText={v => change('brand',v)} />
      <Field label="备注（选填）" value={editor.input.note} onChangeText={v => change('note',v)} multiline />
      <Button title={busy ? '保存中…' : '保存物品'} disabled={busy} onPress={() => void act(async () => { const value = validateItem({...editor.input,location:''}, categories); const p: PhotoChange = editor.photoChanged ? editor.photo ? { kind: 'replace', uri: editor.photo } : { kind: 'remove' } : { kind: 'keep' }; const saved = editor.id ? await updateItem(ctx, editor.id, value, p) : await createItem(ctx, value, editor.photo); setEditor({...editor,id:saved.id}); await clearEditorDraft(); setEditor(null); })} />
    </Screen>}</Modal>
    <Modal visible={active&&manage} animationType="fade" onRequestClose={() => setManage(false)}><Screen title="管理分类" action={<Button title="返回" secondary onPress={() => setManage(false)} />}>
      {error !== '' && <Text style={s.error}>{error}</Text>}
      <Field label={rename ? `重命名「${rename}」` : '新分类名称'} value={categoryName} onChangeText={setCategoryName} />
      <Button title={rename ? '保存分类名称' : '添加分类'} disabled={busy} onPress={() => void act(async () => { if (rename) { await renameCategory(ctx,rename,categoryName); if(category === rename) setCategory(categoryName.trim()); } else await addCategory(ctx,categoryName); setCategoryName(''); setRename(null); })} />
      {rename && <Button title="取消重命名" secondary onPress={() => { setRename(null); setCategoryName(''); }} />}
      {categories.map(c => <View key={c} style={s.categoryManage}><Text style={[s.body,{flex:1}]}>{c}</Text><Row><Button title="重命名" secondary onPress={() => { setRename(c); setCategoryName(c); }} /><Button title="删除分类" secondary disabled={busy} onPress={() => void (async()=>{if(await confirm({title:`删除分类「${c}」？`,message:'只有未被物品使用的分类可以删除。',confirmText:'删除',destructive:true}))await act(async()=>{await deleteCategory(ctx,c);if(category===c)setCategory(null);});})()} /></Row></View>)}
    </Screen></Modal>
  </>;
}
type DropdownOption={value:string;label:string};
function Dropdown({label,value,options,onChange,compact=false,disabled=false,active=true}:{label:string;value:string;options:DropdownOption[];onChange:(value:string)=>void;compact?:boolean;disabled?:boolean;active?:boolean}){
 const anchor=useRef<View>(null);const [position,setPosition]=useState<{x:number;y:number;width:number;height:number}|null>(null);const viewport=useWindowDimensions();
 useEffect(()=>{if(!active)setPosition(null);},[active]);
 const open=()=>anchor.current?.measureInWindow((x,y,width,height)=>setPosition({x,y,width,height}));
 const maxHeight=Math.min(320,Math.max(96,viewport.height-80));
 const width=Math.min(Math.max(position?.width??180,compact?180:0),viewport.width-32);
 const menuHeight=Math.min(options.length*48,maxHeight);
 const top=position?Math.max(24,position.y+position.height+menuHeight<viewport.height-24?position.y+position.height:position.y-menuHeight):0;
 return <View ref={anchor} collapsable={false} style={compact?s.compactAnchor:{alignSelf:'stretch'}}><Pressable accessibilityRole="button" accessibilityLabel={`${label}：${options.find(o=>o.value===value)?.label??'请选择'}`} accessibilityState={{expanded:!!position,disabled}} disabled={disabled||!options.length} hitSlop={compact?{top:6,bottom:6,left:0,right:0}:0} onPress={open} style={({pressed})=>[s.dropdown,compact&&s.dropdownCompact,{opacity:pressed?.7:1}]}><Text style={[s.body,compact&&s.sortLabel]} numberOfLines={1}>{options.find(o=>o.value===value)?.label??'请选择'}</Text>{!compact&&<Feather name="chevron-down" size={14} color={C.muted}/>}</Pressable><Modal transparent visible={active&&!!position} animationType="fade" onRequestClose={()=>setPosition(null)}><Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="关闭选项" onPress={()=>setPosition(null)}/><View style={[s.dropdownMenu,{top,left:Math.min(position?.x??16,viewport.width-width-16),width,maxHeight}]}><ScrollView keyboardShouldPersistTaps="handled">{options.map(o=><Pressable key={o.value} accessibilityRole="radio" accessibilityState={{checked:o.value===value}} onPress={()=>{onChange(o.value);setPosition(null);}} style={[s.dropdownOption,o.value===value&&{backgroundColor:C.apricot}]}><Text style={[s.body,{flex:1}]}>{o.label}</Text>{o.value===value&&<Text style={s.link}>✓</Text>}</Pressable>)}</ScrollView></View></Modal></View>;
}
const s = StyleSheet.create({
 heading:{color:C.text,fontSize:17,fontWeight:'600'},title:{color:C.text,fontSize:23,fontWeight:'600'},hint:{color:C.muted,fontSize:13,lineHeight:18},body:{color:C.text,fontSize:15,lineHeight:21},error:{color:'#A83224',fontSize:13,lineHeight:19},
 searchToolbar:{flexDirection:'row',alignItems:'center',gap:2,minHeight:48},searchInput:{flex:1,minWidth:0,minHeight:36,paddingHorizontal:10,paddingVertical:7,fontSize:13,color:C.text,backgroundColor:C.surface,borderWidth:1,borderColor:C.line,borderRadius:10},toolbarIcon:{width:44,height:48,alignItems:'center',justifyContent:'center'},compactAnchor:{height:48,justifyContent:'center'},
 categoryNav:{gap:24,borderBottomWidth:1,borderBottomColor:C.line},categoryTab:{minHeight:48,justifyContent:'center',borderBottomWidth:2,borderBottomColor:'transparent'},categoryTabActive:{borderBottomColor:C.accent},categoryLabel:{fontSize:15,color:C.muted},categoryLabelActive:{color:C.accent,fontWeight:'600'},
 listToolbar:{minHeight:48,flexDirection:'row',alignItems:'center',gap:8},itemCount:{flex:1,minWidth:0},addAction:{width:48,height:48,alignItems:'center',justifyContent:'center'},addLabel:{fontSize:14,fontWeight:'600',color:C.accent},resetAction:{width:48,height:48,alignItems:'center',justifyContent:'center'},sortLabel:{fontSize:12,fontWeight:'500',flex:1},link:{fontSize:13,color:C.accent},
 dropdown:{minHeight:48,paddingHorizontal:12,borderWidth:1,borderColor:C.line,borderRadius:10,flexDirection:'row',gap:12,alignItems:'center',justifyContent:'space-between',backgroundColor:C.surface},dropdownCompact:{width:86,minHeight:36,borderWidth:1,borderRadius:8,paddingHorizontal:7,gap:0,backgroundColor:C.surface,borderColor:C.line},dropdownMenu:{position:'absolute',backgroundColor:C.surface,borderColor:C.line,borderWidth:1,borderRadius:12,overflow:'hidden',elevation:7,shadowColor:'#382F2B',shadowOpacity:.12,shadowRadius:12},dropdownOption:{minHeight:48,paddingHorizontal:16,paddingVertical:12,flexDirection:'row',alignItems:'center',gap:12},
 item:{minHeight:88,flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12,borderBottomWidth:1,borderColor:C.line},thumb:{width:64,height:64,borderRadius:10,backgroundColor:C.surface},placeholder:{width:64,height:64,borderRadius:10,backgroundColor:'#EFE4D5',alignItems:'center',justifyContent:'center'},placeholderText:{fontSize:21,color:C.muted},name:{color:C.text,fontSize:16,fontWeight:'600',lineHeight:22},price:{color:C.accent,fontSize:16,fontWeight:'600',marginTop:3},priceLarge:{color:C.accent,fontSize:28,fontWeight:'600'},fullPhoto:{width:'100%',height:220,backgroundColor:C.surface,borderRadius:12},detailRow:{gap:3,paddingVertical:6},categoryManage:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:10,borderBottomWidth:1,borderColor:C.line}
});
