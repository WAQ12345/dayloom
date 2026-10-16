import type { AiModelSettings } from '../domain/types.ts';

export type Thinking = AiModelSettings['thinking'];
export type ModelCapability = { id:string; name:string; contextWindow:number|null; maxOutputTokens:number|null; thinking:Thinking[] };
export type ChatMessage = { role:'system'|'user'|'assistant'; content:string };
export type TokenUsage = { input:number|null; output:number|null; total:number|null };
export type Generation = { answer:string; usage:TokenUsage|null; finishReason:string|null; model:string };
export class ProviderError extends Error {
  code:string; partial:string; usage:TokenUsage|null;
  constructor(code:string,message:string,partial='',usage:TokenUsage|null=null){super(message);this.name='ProviderError';this.code=code;this.partial=partial;this.usage=usage;}
}
export const MAX_ANSWER_CHARS=2000000;
const BASE='https://api.deepseek.com';
const positive=(v:unknown):number|null=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?v:null;
const count=(v:unknown):number|null=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
const levels:Thinking[]=['off','low','high','max'];
// Official /models examples and thinking guide checked 2026-10-13. Never use this list to imply account availability.
const known=new Set(['deepseek-flash','deepseek-v4-pro']);
export function normalizeModel(row:Record<string,unknown>):ModelCapability|null{
  if(typeof row.id!=='string'||!row.id||row.id.length>160)return null;
  const effort=row.effort as {supported_levels?:unknown}|undefined;
  const declared=Array.isArray(effort?.supported_levels)?effort.supported_levels.filter((x):x is Thinking=>levels.includes(x as Thinking)&&x!=='off'):null;
  return {id:row.id,name:typeof row.name==='string'?row.name:row.id,contextWindow:positive(row.context_window)??(known.has(row.id)?1048576:null),maxOutputTokens:positive(row.max_output_tokens)??(known.has(row.id)?393216:null),thinking:declared?['off',...new Set(declared)]:known.has(row.id)?[...levels]:['off']};
}
function httpError(status:number){return new ProviderError(String(status),({400:'请求参数无效，请检查模型和输出上限。',401:'密钥无效，请重新保存。',402:'账户余额不足。',403:'当前密钥没有访问权限。',404:'所选模型或接口不可用，请更新模型列表。',413:'内容过长，请缩小范围或新建会话。',422:'模型不支持当前参数。',429:'请求过于频繁，请稍后手动重试。'} as Record<number,string>)[status]??`服务暂不可用（${status}），请稍后手动重试。`)}
function guardedSignal(external:AbortSignal|undefined,ms:number){const controller=new AbortController();let timedOut=false;const abort=()=>controller.abort();external?.addEventListener('abort',abort,{once:true});if(external?.aborted)abort();const timer=setTimeout(()=>{timedOut=true;abort()},ms);return {signal:controller.signal,timeout:()=>timedOut,dispose:()=>{clearTimeout(timer);external?.removeEventListener('abort',abort)}}}
export async function discoverModels(key:string,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<ModelCapability[]>{
 const guard=guardedSignal(signal,30000);try{if(guard.signal.aborted)throw new ProviderError('cancelled','已取消检测。');if(!key.trim())throw new ProviderError('key','请先保存密钥。');const r=await fetcher(`${BASE}/models`,{headers:{Authorization:`Bearer ${key.trim()}`},signal:guard.signal});if(!r.ok)throw httpError(r.status);const data=await r.json() as {data?:unknown};if(guard.signal.aborted)throw new ProviderError(guard.timeout()?'timeout':'cancelled',guard.timeout()?'连接检测超时。':'已取消检测。');if(!Array.isArray(data.data))throw new ProviderError('format','模型目录格式无效。');const models=data.data.filter(x=>x&&typeof x==='object').map(x=>normalizeModel(x)).filter((x):x is ModelCapability=>x!==null);if(!models.length)throw new ProviderError('empty','账户没有返回可用模型。');return models;}catch(e){if(e instanceof ProviderError)throw e;throw new ProviderError(guard.timeout()?'timeout':signal?.aborted?'cancelled':'network',guard.timeout()?'连接检测超时。':signal?.aborted?'已取消检测。':'无法连接，请检查网络。')}finally{guard.dispose()}
}
export function validateModelConfig(config:AiModelSettings,capability?:ModelCapability){
 if(!config.model.trim()||config.model.length>160)throw new ProviderError('model','请选择模型。');
 if(!Number.isInteger(config.maxOutputTokens)||config.maxOutputTokens<1||config.maxOutputTokens>(capability?.maxOutputTokens??393216))throw new ProviderError('output','输出上限超出模型支持范围。');
 if(!Number.isInteger(config.timeoutSeconds)||config.timeoutSeconds<10||config.timeoutSeconds>1800)throw new ProviderError('timeout','超时请填写 10—1800 秒。');
 if(!levels.includes(config.thinking)||(capability&&!capability.thinking.includes(config.thinking)))throw new ProviderError('thinking','模型不支持所选思考程度。');
 if(capability&&capability.id!==config.model)throw new ProviderError('model','模型配置与能力不一致。');
}
export async function streamGenerate(options:{key:string;config:AiModelSettings;messages:ChatMessage[];capability?:ModelCapability;signal?:AbortSignal;onDelta?:(answer:string)=>void;fetcher?:typeof fetch}):Promise<Generation>{
 const {key,config,messages,capability,signal,onDelta,fetcher=fetch}=options;validateModelConfig(config,capability);if(!key.trim())throw new ProviderError('key','请先保存密钥。');
 // UTF-8 byte upper bound is deliberately conservative; no paid hidden token-count request.
 if(capability?.contextWindow&&new TextEncoder().encode(messages.map(x=>x.content).join('\n')).length+messages.length*16+config.maxOutputTokens>capability.contextWindow)throw new ProviderError('context','内容可能超过上下文上限，请缩小范围或新建会话。');
 const guard=guardedSignal(signal,config.timeoutSeconds*1000);let answer='',usage:TokenUsage|null=null,finishReason:string|null=null,returnedModel=config.model,complete=false;
 try{
  if(guard.signal.aborted)throw new ProviderError('cancelled','已停止生成。');
  const response=await fetcher(`${BASE}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${key.trim()}`,'Content-Type':'application/json',Accept:'text/event-stream'},signal:guard.signal,body:JSON.stringify({model:config.model,messages,stream:true,stream_options:{include_usage:true},max_tokens:config.maxOutputTokens,thinking:{type:config.thinking==='off'?'disabled':'enabled'},...(config.thinking==='off'?{}:{reasoning_effort:config.thinking})})});
  if(!response.ok)throw httpError(response.status);if(!response.body)throw new ProviderError('stream','服务未返回数据流。');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  const parse=(block:string)=>{const payload=block.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');if(!payload)return;if(payload==='[DONE]'){complete=true;return;}let chunk;try{chunk=JSON.parse(payload)}catch{throw new ProviderError('format','返回数据格式不完整。')}
   if(!chunk||typeof chunk!=='object'||Array.isArray(chunk))throw new ProviderError('format','返回数据格式无效。');
   if(chunk.error)throw new ProviderError('remote','模型生成失败，请手动重试。');if(typeof chunk.model==='string')returnedModel=chunk.model;
   if(chunk.usage)usage={input:count(chunk.usage.prompt_tokens),output:count(chunk.usage.completion_tokens),total:count(chunk.usage.total_tokens)};
   const first=chunk.choices?.[0];if(first?.finish_reason)finishReason=String(first.finish_reason);if(typeof first?.delta?.content==='string'){const next=answer+first.delta.content;answer=next.slice(0,MAX_ANSWER_CHARS);onDelta?.(answer);if(next.length>MAX_ANSWER_CHARS)throw new ProviderError('length','回答超出本机保存上限，已停止接收并保留前面的内容。')}
  };
  try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let index;while((index=buffer.indexOf('\n\n'))!==-1){parse(buffer.slice(0,index));buffer=buffer.slice(index+2)}if(buffer.length>2000000)throw new ProviderError('format','数据流格式异常。')}buffer+=decoder.decode();if(buffer.trim())parse(buffer);}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  if(guard.signal.aborted)throw new ProviderError(guard.timeout()?'timeout':'cancelled',guard.timeout()?'生成超时。':'已停止生成。');
  if(!complete||!finishReason)throw new ProviderError('incomplete','连接中断，回答未完成。');if(!answer.trim())throw new ProviderError('empty','模型未返回正文。');
  return {answer,usage,finishReason,model:returnedModel};
 }catch(e){const error=e instanceof ProviderError?e:new ProviderError(guard.timeout()?'timeout':signal?.aborted?'cancelled':'network',guard.timeout()?'生成超时，已保留收到的内容。':signal?.aborted?'已停止生成。':'连接中断，请手动重试。');error.partial=answer;error.usage=usage;throw error;}finally{guard.dispose()}
}
export function testGeneration(key:string,config:AiModelSettings,capability:ModelCapability,signal?:AbortSignal,fetcher?:typeof fetch){return streamGenerate({key,config:{...config,maxOutputTokens:Math.min(config.maxOutputTokens,512)},capability,signal,fetcher,messages:[{role:'user',content:'连接测试，请只回复：连接成功。'}]})}
export const deepseekProvider={id:'deepseek',discoverModels,generate:streamGenerate,testGeneration};
