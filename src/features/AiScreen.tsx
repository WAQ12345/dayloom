import { Disclosure } from '../ui/Disclosure';
import { IdeaSelection } from '../ui/IdeaSelection';
import { getIdea, getIdeasByIds } from '../data/ideaRepo';
import { ideaQuestion, loadSelectedIdeas } from './aiIdeaFlow';
import { DateField } from '../ui/DateTimeField';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Modal, Pressable, Switch, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Screen, Button, Field, Card, Row, Choice, Note, C } from '../ui/kit';
import { MarkdownText } from '../ui/MarkdownText';
import { useConfirm } from '../ui/confirm';
import { useApp } from '../ui/context';
import { listMealsInRange } from '../data/foodRepo';
import { listWaterInRange } from '../data/waterRepo';
import { getAllSettings } from '../data/settingsRepo';
import { createAiPreview } from '../services/ai';
import { getApiKey, hasApiKey } from '../services/native';
import { isValidDate, shiftDate } from '../domain/dates';
import type { Meal, WaterRecord, AiModelSettings } from '../domain/types';
import { ModelChoices, THINKING_LABEL } from './ModelSettings';
import { BaziProfiles } from './BaziProfiles';
import { AI_TOOLS, foodScope, ideaScope, prepareTurn, inspectAnswer, type ToolId, type ToolScope, type ToolReference, type TurnPreview } from '../services/aiTools';
import { streamGenerate, validateModelConfig, ProviderError, type ModelCapability } from '../services/deepseek';
import { createConversation, getConversation, listConversations, listMessages, appendMessage, deleteConversation, type AiConversation, type AiMessage } from '../data/aiRepo';

const errorText=(e:unknown)=>e instanceof Error?e.message:'操作失败，请重试';
const body={color:C.text,fontSize:14,lineHeight:23};
export default function AiScreen(){
 const {ctx,today,revision}=useApp(),confirm=useConfirm();
 const [tool,setTool]=useState<ToolId|null>(null),[question,setQuestion]=useState(''),[scope,setScope]=useState<ToolScope|null>(null),[conversation,setConversation]=useState<AiConversation|null>(null),[messages,setMessages]=useState<AiMessage[]>([]);
 const [selectedIdeas,setSelectedIdeas]=useState<string[]>([]),[ideaLoading,setIdeaLoading]=useState(false),[previewReading,setPreviewReading]=useState(false),[referenceState,setReferenceState]=useState<{reference:ToolReference;status:'present'|'deleted'|'error'}|null>(null);
 const previewReadId=useRef(0),previewLock=useRef(false);
 const [config,setConfig]=useState<AiModelSettings|null>(null),[models,setModels]=useState<ModelCapability[]>([]),[keyReady,setKeyReady]=useState(false),[showConfig,setShowConfig]=useState(false);
 const [includeFood,setIncludeFood]=useState(false),[from,setFrom]=useState(shiftDate(today,-6)),[to,setTo]=useState(today),[meals,setMeals]=useState<Meal[]>([]),[water,setWater]=useState<WaterRecord[]>([]),[selected,setSelected]=useState<string[]>([]),[loadedRange,setLoadedRange]=useState('');
 const [preview,setPreview]=useState<TurnPreview|null>(null),[previewDetails,setPreviewDetails]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[partial,setPartial]=useState(''),[unsaved,setUnsaved]=useState('');
 const [history,setHistory]=useState<AiConversation[]>([]),[showHistory,setShowHistory]=useState(false),[hasMoreHistory,setHasMoreHistory]=useState(false),[reference,setReference]=useState<ToolReference|null>(null);
 const abortRef=useRef<AbortController|null>(null),active=useRef(false),readId=useRef(0),sendLock=useRef(false),historyPage=useRef(0),historyReadId=useRef(0),pageBusy=useRef(false);
 const clearSelection=useCallback(()=>{readId.current++;previewReadId.current++;setSelectedIdeas([]);setIdeaLoading(false);setPreviewReading(false);setIncludeFood(false);setSelected([]);setMeals([]);setWater([]);setLoadedRange('');setLoading(false);setPreview(null);},[]);
 // revision refreshes settings after backup restore, even when the screen remains mounted.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useFocusEffect(useCallback(()=>{active.current=true;let valid=true;void Promise.all([getAllSettings(ctx.db),hasApiKey()]).then(([s,k])=>{if(valid){setConfig(s.aiModel);setModels(s.modelCatalog?.models??[]);setKeyReady(k);}}).catch(e=>valid&&setError(errorText(e)));return()=>{valid=false;active.current=false;historyReadId.current++;abortRef.current?.abort();clearSelection();};},[ctx,revision,clearSelection]));
 const fresh=useCallback((next:ToolId|null=tool)=>{if(sendLock.current)return;historyReadId.current++;setTool(next);setScope(null);setConversation(null);setMessages([]);setQuestion('');setError('');setNotice('');setPartial('');setUnsaved('');clearSelection();},[tool,clearSelection]);
 useEffect(()=>{const handler=BackHandler.addEventListener('hardwareBackPress',()=>{if(!active.current)return false;if(sendLock.current){abortRef.current?.abort();return true;}if(tool){fresh(null);return true;}return false;});return()=>handler.remove();},[tool,fresh]);
 const updateRange=(which:'from'|'to',value:string)=>{if(which==='from')setFrom(value);else setTo(value);readId.current++;setLoadedRange('');setSelected([]);setMeals([]);setWater([]);setLoading(false);};
 const load=async()=>{const id=++readId.current;setError('');if(!isValidDate(from)||!isValidDate(to)||from>to||to>today){setError('请选择有效日期范围，不能选择未来。');return;}setLoading(true);try{const [m,w]=await Promise.all([listMealsInRange(ctx.db,from,to),listWaterInRange(ctx.db,from,to)]);if(id===readId.current&&active.current){setMeals(m);setWater(w);setSelected([]);setLoadedRange(`${from}/${to}`);}}catch(e){if(id===readId.current)setError(errorText(e));}finally{if(id===readId.current)setLoading(false);}};
 const makePreview=async()=>{if(previewLock.current)return;previewLock.current=true;const id=++previewReadId.current;setPreviewReading(true);try{setError('');setNotice('');if(!tool||!config)throw new Error('模型配置尚未读取');const capability=models.find(m=>m.id===config.model);if(!capability)throw new Error('请先在模型设置中检测连接，并选择可用模型');validateModelConfig(config,capability);
   let current=scope;if(!current&&tool==='food'){if(includeFood&&loadedRange!==`${from}/${to}`)throw new Error('请先加载此范围的记录');if(includeFood&&to>today)throw new Error('不能选择未来记录');current=foodScope(createAiPreview({question,includeFood,meals,water,selectedIds:selected,from:includeFood?from:today,to:includeFood?to:today}));}
   if(!current&&tool==='ideas'){if(ideaLoading)throw new Error('正在读取想法，请稍后重试');const ideas=await loadSelectedIdeas(selectedIdeas,ids=>getIdeasByIds(ctx.db,ids));if(id!==previewReadId.current||!active.current)return;current=ideaScope(ideas);}
   if(!current)throw new Error('请先选择出生档案并生成命盘');if(current.tool!==tool)throw new Error('工具范围已改变，请新建会话');setPreview(prepareTurn({question:tool==='ideas'?ideaQuestion(question):tool==='bazi'&&!conversation&&!question.trim()?'解读此命盘':question,scope:current,config,capability,history:messages}));setPreviewDetails(false);
  }catch(e){if(id===previewReadId.current&&active.current)setError(errorText(e));}finally{previewLock.current=false;if(id===previewReadId.current)setPreviewReading(false);}};
 const send=async()=>{if(!preview||sendLock.current)return;sendLock.current=true;const fixed=preview,controller=new AbortController();abortRef.current=controller;setBusy(true);setError('');setPartial('');setUnsaved('');let conv=conversation;let savedUser=false;
  try{
   const key=await getApiKey();if(controller.signal.aborted)throw new ProviderError('cancelled','已停止生成。');if(!key){setKeyReady(false);throw new Error('请先配置 DeepSeek Key');}
   if(conv){const still=await getConversation(ctx.db,conv.id);if(!still||still.snapshot!==fixed.scope.snapshot||still.tool!==fixed.scope.tool)throw new Error('会话已删除或恢复，请新建分析');}
   else{conv=await createConversation(ctx,{tool:fixed.scope.tool,profileId:fixed.scope.profileId,snapshot:fixed.scope.snapshot,refs:fixed.scope.references,promptVersion:fixed.scope.promptVersion});setConversation(conv);setScope(fixed.scope);}
   await appendMessage(ctx,{conversationId:conv.id,role:'user',content:fixed.question,settings:{...fixed.config},status:'success'});savedUser=true;
   const result=await streamGenerate({key,config:fixed.config,messages:[...fixed.messages],capability:fixed.capability,signal:controller.signal,onDelta:text=>{if(active.current)setPartial(text);}});
   const full=result.finishReason==='stop';
   try{await appendMessage(ctx,{conversationId:conv.id,role:'assistant',content:result.answer,settings:{...fixed.config,returnedModel:result.model,promptVersion:fixed.scope.promptVersion},usage:result.usage?{...result.usage}:null,status:full?'success':'error',error:full?null:'输出达到限制或被中断，回答未完成。'});}catch{setUnsaved(result.answer);throw new Error('回答已收到，但保存失败。请复制保留后再离开。');}
   setQuestion('');setPreview(null);setPartial('');clearSelection();if(!full)setNotice('回答未完成，已保留收到的内容。');
  }catch(e){
   if(savedUser&&conv&&e instanceof ProviderError){try{await appendMessage(ctx,{conversationId:conv.id,role:'assistant',content:e.partial,settings:{...fixed.config,promptVersion:fixed.scope.promptVersion},usage:e.usage?{...e.usage}:null,status:e.code==='cancelled'?'cancelled':'error',error:e.message});setPartial('');setPreview(null);}catch{setUnsaved(e.partial);}}
   if(active.current)setError(errorText(e));
  }finally{if(conv){try{const rows=await listMessages(ctx.db,conv.id);setMessages(rows);}catch{setError('无法读取会话记录，请稍后重试。');}}abortRef.current=null;sendLock.current=false;setBusy(false);}
 };
 const openHistory=async()=>{const id=++historyReadId.current;setError('');try{const rows=await listConversations(ctx.db);if(id!==historyReadId.current||!active.current)return;historyPage.current=0;setHistory(rows);setHasMoreHistory(rows.length===50);setShowHistory(true);}catch(e){if(id===historyReadId.current&&active.current)setError(errorText(e));}};
 const resume=async(c:AiConversation)=>{if(busy)return;const id=++historyReadId.current;try{const rows=await listMessages(ctx.db,c.id);if(id!==historyReadId.current||!active.current)return;fresh(c.tool);setConversation(c);setScope({tool:c.tool,profileId:c.profileId,snapshot:c.snapshot,references:c.refs as ToolReference[],promptVersion:c.promptVersion});setMessages(rows);setShowHistory(false);}catch(e){setError(errorText(e));}};
 useEffect(()=>{let live=true;if(!reference||reference.kind!=='idea')return;void getIdea(ctx.db,reference.recordId).then(value=>{if(live)setReferenceState({reference,status:value?'present':'deleted'});}).catch(()=>{if(live)setReferenceState({reference,status:'error'});});return()=>{live=false;};},[ctx,reference,revision]);
 const copy=async(text:string)=>{try{await Clipboard.setStringAsync(text);setNotice('已复制');}catch{setError('复制失败，请长按正文复制。');}};
 const toggle=(id:string)=>setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
 const modelConfigured=(()=>{if(!keyReady||!config)return false;const capability=models.find(model=>model.id===config.model);if(!capability)return false;try{validateModelConfig(config,capability);return true;}catch{return false;}})();
 const renderMessage=(m:AiMessage)=>{const checked=tool?inspectAnswer(tool,m.content,scope?.references??[]):null;return <Card key={m.id}>
  <Row><Text style={{...body,fontWeight:'600',flex:1}}>{m.role==='user'?'我的问题':'模型回答'}</Text>{m.role==='assistant'&&<Button title="复制" secondary onPress={()=>void copy(m.content)}/>}</Row>
  {m.role==='assistant'&&<Note>{String(m.settings.model??'')} · {THINKING_LABEL[m.settings.thinking as keyof typeof THINKING_LABEL]??'旧版配置'} · {new Date(m.createdAt).toLocaleString('zh-CN')}{'\n'}Token：{m.usage?.total==null?'未知':String(m.usage.total)}{m.status!=='success'?' · 未完成':''}</Note>}
  <MarkdownText text={m.content||'未收到正文'}/>{m.error&&<Note error>{m.error}</Note>}
  {m.role==='assistant'&&checked?.warning&&<Note>{checked.warning}</Note>}
  {m.role==='assistant'&&checked?.citations.map(c=><Button key={c.ref} title={c.valid?`[${c.ref}] 查看依据`:`[${c.ref}] 未授权引用`} secondary disabled={!c.valid} onPress={()=>setReference(scope?.references.find(r=>r.ref===c.ref)??null)}/>)}
 </Card>};
 return <>
 <Screen title={tool?AI_TOOLS[tool].name:'AI 工具'} action={<Row>{tool&&<Button title="返回" secondary disabled={busy} onPress={()=>fresh(null)}/>}<Button title="历史" secondary disabled={busy} onPress={()=>void openHistory()}/></Row>}>
  {!!error&&<Note error>{error}</Note>}{!!notice&&<Note>{notice}</Note>}
  {!tool?<><Card><Text style={{...body,fontWeight:'600'}}>饮食分析</Text><Note>选择记录，看看最近的变化。</Note><Button title="开始分析" onPress={()=>fresh('food')}/></Card><Card><Text style={{...body,fontWeight:'600'}}>八字解读</Text><Button title="出生档案与命盘" onPress={()=>fresh('bazi')}/></Card><Card><Text style={{...body,fontWeight:'600'}}>想法整理</Text><Button title="选择想法" onPress={()=>fresh('ideas')}/></Card></>:<>
  {tool==='bazi'&&!scope&&<BaziProfiles onAnalyze={s=>{setScope(s);setQuestion('');}}/>}
  {(tool==='food'||tool==='ideas'||scope)&&<>
  {tool==='ideas'&&!scope&&<IdeaSelection selectedIds={selectedIdeas} onChange={setSelectedIdeas} disabled={busy||previewReading} onLoadingChange={setIdeaLoading}/>}
  {scope&&<Row>{(scope.tool==='food'||scope.tool==='ideas')&&<Text style={{...body,flex:1}}>{`已授权 ${scope.references.length} 条记录`}</Text>}<Button title={scope.tool==='ideas'?'更换资料':'新会话'} secondary disabled={busy||previewReading} onPress={()=>fresh()}/></Row>}
  {scope?.tool==='ideas'&&<Disclosure title={`本次依据 · ${scope.references.length}条`}>{scope.references.map(r=><Button key={r.ref} title={`[${r.ref}] ${r.label}`} secondary onPress={()=>setReference(r)}/>)}</Disclosure>}
  {messages.map(renderMessage)}
  {unsaved&&<Card><Note error>尚未保存的回答</Note><MarkdownText text={unsaved}/><Button title="复制保留" secondary onPress={()=>void copy(unsaved)}/></Card>}
  {busy&&<Card><Note>{partial?'正在回答…':'正在思考，请稍候…'}</Note><MarkdownText text={partial}/><Button title="停止生成" secondary onPress={()=>abortRef.current?.abort()}/></Card>}
  <View pointerEvents={busy||previewReading?'none':'auto'} style={{gap:12,opacity:(busy||previewReading)?.5:1}}>
  <Field label={conversation?'继续追问':'你的问题'} value={question} onChangeText={setQuestion} multiline placeholder={tool==='food'?'这些饮食记录有哪些变化？':undefined}/>
  {tool==='food'&&!scope&&<>
    <Row><Text style={{...body,flex:1}}>允许引用饮食</Text><Switch accessibilityLabel="允许引用饮食" value={includeFood} trackColor={{true:C.sage}} onValueChange={v=>{clearSelection();setIncludeFood(v);}}/></Row>
    {includeFood&&<><Row><View style={{flex:1}}><DateField label="开始日期" value={from} max={to<today?to:today} onChange={v=>updateRange('from',v)}/></View><View style={{flex:1}}><DateField label="结束日期" value={to} min={from} max={today} onChange={v=>updateRange('to',v)}/></View></Row><Button title={loading?'读取中…':'加载记录'} secondary disabled={loading} onPress={()=>void load()}/>
    {loadedRange&&<><Note>已选 {selected.length} 条{!meals.length&&!water.length?' · 暂无记录':''}</Note>{[...meals.map(m=>({id:m.id,text:`${m.date} ${m.name} · ${m.kcal} kcal`})),...water.map(w=>({id:w.id,text:`${w.date} 饮水 · ${w.amountMl} ml`}))].map(r=><Choice key={r.id} title={r.text} selected={selected.includes(r.id)} onPress={()=>toggle(r.id)}/>)}</>}
    </>}
  </>}
  <Button title={modelConfigured&&config?`${config.model} · 思考${THINKING_LABEL[config.thinking]}`:'配置大模型'} secondary onPress={()=>{if(modelConfigured)setShowConfig(!showConfig);else router.push('/settings?section=model');}}/>
  {showConfig&&modelConfigured&&config&&<ModelChoices config={config} models={models} onChange={setConfig}/>}
  <Button title={previewReading?'读取资料中…':'预览发送内容'} disabled={busy||previewReading||ideaLoading} onPress={()=>void makePreview()}/>
  </View>
  </>}
 </>}
 </Screen>
 <Modal visible={!!preview&&!busy} animationType="fade" onRequestClose={()=>setPreview(null)}>{preview&&<Screen title="发送前确认" action={<Button title="返回" secondary onPress={()=>setPreview(null)}/>}>
  <Card><Text style={body}>{preview.question}</Text><Note>{preview.config.model} · 思考{THINKING_LABEL[preview.config.thinking]} · 输出上限 {preview.config.maxOutputTokens}{'\n'}{preview.scope.references.length} 条依据 · {preview.historyCount} 条历史消息</Note></Card>
  {preview.scope.references.map(r=><Card key={r.ref}><Text style={body}>[{r.ref}] {r.label}</Text><Note>{r.kind==='bazi'?'本地命盘与内置典籍摘要':r.summary}</Note><Button title="查看快照" secondary onPress={()=>setReference(r)}/></Card>)}
  <Button title={previewDetails?'收起完整发送内容':'查看完整发送内容'} secondary onPress={()=>setPreviewDetails(!previewDetails)}/>
  {previewDetails&&preview.messages.map((m,i)=><Card key={i}><Note>{m.role==='system'?'内置规则':m.role==='assistant'?'历史回答':'问题 / 授权资料'}</Note><Text selectable style={body}>{m.content}</Text></Card>)}
  <Note>本次仅向 DeepSeek 发送上述内容，可能计费，不自动重试。</Note><Button title="确认并发送" onPress={()=>void send()}/>
 </Screen>}</Modal>
 <Modal visible={showHistory} animationType="fade" onRequestClose={()=>{historyReadId.current++;setShowHistory(false);}}><Screen title="分析历史" action={<Button title="返回" secondary onPress={()=>{historyReadId.current++;setShowHistory(false);}}/>}>
  {!!error&&<Note error>{error}</Note>}{!history.length&&<Note>暂无分析记录。</Note>}{history.map(c=><Card key={c.id}><Pressable accessibilityRole="button" onPress={()=>void resume(c)} style={{minHeight:48,justifyContent:'center'}}><Text style={body}>{AI_TOOLS[c.tool].name}</Text><Note>{new Date(c.createdAt).toLocaleString('zh-CN')} · {c.refs.length} 条依据</Note></Pressable><Button title="删除会话" secondary onPress={()=>void (async()=>{try{if(await confirm({title:'删除这次分析？',message:'将删除这次分析的全部问题与回答。'})){await deleteConversation(ctx,c.id);setHistory(h=>h.filter(x=>x.id!==c.id));if(conversation?.id===c.id)fresh();}}catch(e){setError(errorText(e));}})()}/></Card>)}
  {hasMoreHistory&&<Button title="加载更多" secondary onPress={()=>void (async()=>{if(pageBusy.current)return;pageBusy.current=true;const id=historyReadId.current;try{const next=await listConversations(ctx.db,undefined,(historyPage.current+1)*50);if(id!==historyReadId.current||!active.current)return;historyPage.current++;setHasMoreHistory(next.length===50);setHistory(h=>[...h,...next]);}catch(e){if(id===historyReadId.current&&active.current)setError(errorText(e));}finally{pageBusy.current=false;}})()}/>}
 </Screen></Modal>
 <Modal visible={!!reference} animationType="fade" onRequestClose={()=>setReference(null)}>{reference&&<Screen title="发送时的依据" action={<Button title="返回" secondary onPress={()=>setReference(null)}/>}>{reference.kind==='idea'?<Text selectable style={body}>{reference.summary}</Text>:<MarkdownText text={reference.summary}/>}
 {reference.kind==='idea'&&referenceState?.reference===reference&&referenceState.status==='deleted'&&<Note>原记录已删除</Note>}{reference.kind==='idea'&&referenceState?.reference===reference&&referenceState.status==='error'&&<Note error>无法读取原记录状态，请稍后重试。</Note>}<Note>这是发送时快照，后续修改不会改变此依据。</Note></Screen>}</Modal>
 </>;
}
