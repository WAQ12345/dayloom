/* eslint-disable react-hooks/set-state-in-effect -- Effects synchronize local SQLite records and drafts. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Button, Card, Field, Note, Row, Screen, C, useAction, PageBar, SearchField, IconButton as Icon } from '../ui/kit';
import { appendIdeaClipboard } from './ideaPaste';
import { IdeaDraftQueue } from './ideaDraftQueue';
import { MarkdownText } from '../ui/MarkdownText';
import { ListScreen } from '../ui/ListScreen';
import { useApp } from '../ui/context';
import { useConfirm, useDialog } from '../ui/confirm';
import { createIdea, updateIdea, deleteIdea, listIdeas, setIdeaPinned, setIdeaArchived } from '../data/ideaRepo';
import { getDraft, saveDraft, deleteDraft } from '../data/draftRepo';
import { formatIdeaTime, validateIdea, type Idea } from '../domain/ideas';

type Editor={id:string|null;input:{body:string;tags:string[]};tagInput?:string};
export default function IdeasScreen(){
 const {ctx,revision,refresh}=useApp(),confirm=useConfirm(),dialog=useDialog();const {busy,error,setError,run}=useAction();
 const [query,setQuery]=useState(''),[page,setPage]=useState(0),[rows,setRows]=useState<Idea[]>([]),[more,setMore]=useState(false),[loading,setLoading]=useState(true),[editor,setEditor]=useState<Editor|null>(null),[detail,setDetail]=useState<Idea|null>(null),[draft,setDraft]=useState<Editor|null>(null),[tagInput,setTagInput]=useState(''),[notice,setNotice]=useState('');
 const [viewArchived,setViewArchived]=useState(false);
 const alive=useRef(true),editorGeneration=useRef(0),latestEditor=useRef(editor);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{latestEditor.current=editor;editorGeneration.current++;},[editor]);
 const [draftQueue]=useState(()=>new IdeaDraftQueue());const blocked=useRef(false);
 useEffect(()=>()=>draftQueue.cancelPending(),[draftQueue]);
 const load=useCallback(async()=>{const [ideas,saved]=await Promise.all([listIdeas(ctx.db,{query,limit:21,offset:page*20,archived:viewArchived,sort:'pinned'}),getDraft<Editor>(ctx.db,'idea:editor')]);return {ideas,saved};},[ctx,query,page,viewArchived]);
 useEffect(()=>{let live=true;setLoading(true);void load().then(({ideas,saved})=>{if(live){setRows(ideas.slice(0,20));setMore(ideas.length>20);setDraft(saved?.payload??null);setError('');}}).catch(e=>{if(live){setRows([]);setMore(false);setError(e instanceof Error?e.message:'读取想法失败');}}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[load,revision,setError]);
 useEffect(()=>{if(!editor||blocked.current)return;void draftQueue.enqueue(()=>saveDraft(ctx,'idea:editor',null,{...editor,tagInput})).catch(e=>setError(e instanceof Error?e.message:'草稿保存失败'));},[ctx,editor,tagInput,setError,draftQueue]);
 const clearDraft=async()=>{blocked.current=true;try{await draftQueue.flush().catch(()=>{});await deleteDraft(ctx,'idea:editor');setDraft(null);}catch(e){blocked.current=false;throw e;}};
 const closeEditor=async()=>{if(busy)return;const choice=await dialog({title:'保留未保存的想法？',actions:[{label:'继续填写',value:'continue'},{label:'保留草稿',value:'keep'},{label:'丢弃草稿',value:'discard',destructive:true}]});if(choice==='keep')await run(async()=>{await draftQueue.flush();if(editor){const saved={...editor,tagInput};await saveDraft(ctx,'idea:editor',null,saved);setDraft(saved);}setEditor(null);});if(choice==='discard')await run(async()=>{await clearDraft();setEditor(null);});};
 const openEditor=async(idea?:Idea)=>{if(busy||loading)return;setNotice('');if(draft){const answer=await dialog({title:'有未保存的草稿',actions:[{label:'取消',value:'cancel'},{label:'继续草稿',value:'resume'},{label:'丢弃并继续',value:'discard',destructive:true}]});if(answer==='resume'){blocked.current=false;setTagInput(draft.tagInput??'');setEditor(draft);return;}if(answer!=='discard')return;let cleared=false;await run(async()=>{await clearDraft();cleared=true;});if(!cleared)return;}blocked.current=false;setTagInput('');setEditor(idea?{id:idea.id,input:{body:idea.body,tags:[...idea.tags]}}:{id:null,input:{body:'',tags:[]}});};
 const save=()=>void run(async()=>{
  if(!editor)return;
  const input=validateIdea({...editor.input,tags:[...editor.input.tags,...(tagInput.trim()?[tagInput.trim()]:[])]});
  // Stop draft producers before the repository consumes the draft in the record transaction.
  blocked.current=true;
  try{
   await draftQueue.flush().catch(()=>{});
   const saved=editor.id?await updateIdea(ctx,editor.id,input,{consumeDraft:true}):await createIdea(ctx,input,{consumeDraft:true});
   setDraft(null);setEditor(null);setTagInput('');setDetail(saved);refresh();
  }catch(e){blocked.current=false;throw e;}
 });
 const paste=()=>void run(async()=>{if(!editor)return;const generation=editorGeneration.current;const pasted=await Clipboard.getStringAsync();if(!alive.current||!latestEditor.current)return;if(generation!==editorGeneration.current)throw new Error('正文已变化，请重新粘贴');const body=appendIdeaClipboard(latestEditor.current.input.body,pasted);setEditor({...latestEditor.current,input:{...latestEditor.current.input,body}});});
 const addTag=()=>{if(!editor||busy||!tagInput.trim())return;try{const input=validateIdea({body:editor.input.body.trim()||'占位',tags:[...editor.input.tags,tagInput.trim()]});setEditor({...editor,input:{...editor.input,tags:input.tags}});setTagInput('');setError('');}catch(e){setError(e instanceof Error?e.message:'标签无效');}};
 const switchArchiveView=()=>{setViewArchived(value=>!value);setPage(0);setNotice('');};
 const openListMenu=async()=>{if(busy||loading)return;const choice=await dialog({title:'想法',actions:[{label:viewArchived?'返回想法':'查看归档',value:'archive-view'},{label:'取消',value:'cancel'}]});if(choice==='archive-view')switchArchiveView();};
 const openDetailMenu=async()=>{
  if(!detail||busy)return;
  const current=detail;
  const choice=await dialog({title:'想法操作',actions:[
   ...(!current.archived?[{label:current.pinned?'取消置顶':'置顶',value:'pin'}]:[]),
   {label:current.archived?'恢复想法':'归档',value:'archive'},
   {label:'复制',value:'copy'},{label:'导出',value:'export'},
   {label:'删除',value:'delete',destructive:true},{label:'取消',value:'cancel'}
  ]});
  if(choice==='pin')await run(async()=>{const saved=await setIdeaPinned(ctx,current.id,!current.pinned);setDetail(saved);setNotice(saved.pinned?'已置顶':'已取消置顶');refresh();});
  if(choice==='archive')await run(async()=>{await setIdeaArchived(ctx,current.id,!current.archived);setDetail(null);setNotice(current.archived?'已恢复想法':'已归档，可从菜单查看归档');if(rows.length===1&&page>0)setPage(value=>value-1);refresh();});
  if(choice==='copy')await run(async()=>{await Clipboard.setStringAsync([current.body,...(current.tags.length?[current.tags.map(t=>`#${t}`).join(' ')]:[]),`编写时间 ${formatIdeaTime(current.createdAt)}`].join('\n\n'));setNotice('已复制');});
  if(choice==='export'){setDetail(null);router.push({pathname:'/export-overview',params:{kind:'ideas',ideaId:current.id}});}
  if(choice==='delete'&&await confirm({title:'删除这条想法？',message:'删除后无法撤销。',confirmText:'删除',destructive:true}))await run(async()=>{await deleteIdea(ctx,current.id);setDetail(null);setNotice('已删除想法');if(rows.length===1&&page>0)setPage(value=>value-1);refresh();});
 };
 const topBar=<PageBar backDisabled={busy} title={viewArchived?'归档想法':'想法'} onBack={()=>{if(viewArchived)switchArchiveView();else router.back();}} actions={<><Icon name="plus" label="添加想法" disabled={busy||loading} onPress={()=>void openEditor()}/><Icon name="more-horizontal" label="想法列表更多操作" disabled={busy||loading} onPress={()=>void openListMenu()}/></>}/>;
 const header=<><SearchField placeholder={viewArchived?'搜索归档正文':'搜索正文'} value={query} onChangeText={v=>{setQuery(v);setPage(0);}}/>{draft&&<Button title="继续草稿" secondary disabled={busy||loading} onPress={()=>{blocked.current=false;setTagInput(draft.tagInput??'');setEditor(draft);}}/>}{!!notice&&<Note>{notice}</Note>}{!!error&&<><Note error>{error}</Note><Button title="重试读取" secondary disabled={busy||loading} onPress={refresh}/></>}{loading&&<Note>正在读取…</Note>}{!loading&&!rows.length&&<Note>{query.trim()?'没有找到匹配的想法':viewArchived?'暂无归档想法':'暂无想法'}</Note>}</>;
 const footer=page>0||more?<Row>{page>0&&<Button title="上一页" secondary disabled={loading} onPress={()=>setPage(v=>v-1)}/>}<Note>第 {page+1} 页</Note>{more&&<Button title="下一页" secondary disabled={loading} onPress={()=>setPage(v=>v+1)}/>}</Row>:undefined;
 return <><ListScreen compact topBar={topBar} data={rows} header={header} footer={footer} keyExtractor={idea=>idea.id} renderItem={({item})=><Pressable accessibilityRole="button" accessibilityLabel={`查看${item.archived?'归档':item.pinned?'置顶':''}想法：${item.body}`} accessibilityState={{disabled:loading||busy}} disabled={loading||busy} onPress={()=>{setNotice('');setDetail(item);}} style={{paddingVertical:12,borderBottomWidth:1,borderColor:C.line}}>{(item.pinned||item.archived)&&<Text style={{fontSize:12,lineHeight:20,color:C.muted}}>{item.archived?'已归档':'已置顶'}</Text>}<Text numberOfLines={4} style={{fontSize:15,lineHeight:25,color:C.text}}>{item.body}</Text><Note>{formatIdeaTime(item.createdAt)}{item.tags.length?` · ${item.tags.join(' · ')}`:''}</Note></Pressable>}/>
 <Modal visible={!!editor||!!detail} animationType="fade" onRequestClose={()=>{if(editor)void closeEditor();else if(!busy)setDetail(null);}}>{editor?<Screen key="editor" title="" topBar={<PageBar backDisabled={busy} title={editor.id?'编辑想法':'添加想法'} onBack={()=>{if(!busy)void closeEditor();}}/>} footer={<Button title={busy?'保存中…':'保存想法'} disabled={busy} onPress={save}/>}><View style={{position:'relative'}}><Field label="正文" value={editor.input.body} multiline placeholder="记下此刻的想法" onChangeText={body=>{if(busy)return;if(Array.from(body.trim()).length>20000||body.includes('\u0000')){setError('想法正文最多20000个字，不能包含无效字符');return;}setEditor({...editor,input:{...editor.input,body}});}}/><View style={{position:'absolute',right:0,top:-14}}><Icon name="clipboard" label="粘贴正文" disabled={busy} onPress={paste}/></View></View><Row>{editor.input.tags.map(value=><Pressable key={value} accessibilityRole="button" accessibilityLabel={`移除标签 ${value}`} disabled={busy} onPress={()=>setEditor({...editor,input:{...editor.input,tags:editor.input.tags.filter(t=>t!==value)}})} style={{minHeight:48,justifyContent:'center',paddingHorizontal:10}}><Text style={{color:C.accent}}>#{value} ×</Text></Pressable>)}</Row><Field label="自定义标签（选填）" placeholder="输入标签" value={tagInput} onChangeText={v=>{if(!busy)setTagInput(v);}}/><Button title="添加标签" secondary disabled={busy||!tagInput.trim()} onPress={addTag}/>{!!error&&<Note error>{error}</Note>}</Screen>:detail?<Screen key="detail" title="" topBar={<PageBar backDisabled={busy} title="想法" onBack={()=>{if(!busy)setDetail(null);}} actions={<><Icon name="edit-2" label="编辑想法" disabled={busy} onPress={()=>void openEditor(detail)}/><Icon name="more-horizontal" label="想法更多操作" disabled={busy} onPress={()=>void openDetailMenu()}/></>}/>} >{(detail.pinned||detail.archived)&&<Note>{detail.archived?'已归档':'已置顶'}</Note>}<Card><View style={{paddingVertical:6,paddingHorizontal:2}}><MarkdownText text={detail.body}/></View></Card>{detail.tags.length>0&&<Row>{detail.tags.map(value=><View key={value} style={{paddingHorizontal:10,paddingVertical:5,borderRadius:16,backgroundColor:C.apricot}}><Text style={{fontSize:12,lineHeight:18,color:C.muted}}>#{value}</Text></View>)}</Row>}<View style={{gap:4,paddingHorizontal:4,paddingTop:2}}><Text style={{fontSize:12,lineHeight:20,color:C.muted}}>{formatIdeaTime(detail.createdAt)}</Text>{detail.updatedAt!==detail.createdAt&&<Text style={{fontSize:12,lineHeight:20,color:C.muted}}>修改于 {formatIdeaTime(detail.updatedAt)}</Text>}</View>{!!notice&&<Note>{notice}</Note>}{!!error&&<Note error>{error}</Note>}</Screen>:null}</Modal></>;
}
