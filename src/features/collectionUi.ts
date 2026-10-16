import type {Collection,CollectionInput} from '../domain/collections.ts';
export type CollectionKind=CollectionInput['kind'];
export const EMPTY_COLLECTION:CollectionInput={kind:'text',name:'',body:'',url:'',source:'',account:'',password:''};
export {appendIdeaClipboard as appendCollectionBody} from './ideaPaste.ts';
/** Legacy draft adaptation does not validate incomplete text or alter password whitespace. */
export function normalizeCollectionInput(value:Partial<CollectionInput>):CollectionInput {
 const text=(key:keyof CollectionInput)=>typeof value[key]==='string'?value[key] as string:'';
 return {kind:['text','link','account'].includes(value.kind??'')?value.kind!:text('url')?'link':'text',name:text('name'),body:text('body'),url:text('url'),source:text('source'),account:text('account'),password:text('password')};
}
export function collectionTypeChange(value:CollectionInput,kind:CollectionKind):{input:CollectionInput;discarded:string[]} {
 if(kind===value.kind)return {input:{...value},discarded:[]};
 const input={...value,kind},discarded:string[]=[];
 const clear=(key:'url'|'account'|'password'|'source',label:string)=>{if(input[key]!=='')discarded.push(label);input[key]='';};
 if(kind==='text')clear('url','链接');
 if(kind!=='account'){clear('account','账号');clear('password','密码');}else clear('source','来源');
 return {input,discarded};
}
export function collectionDomain(url:string):string{try{return new URL(url).hostname;}catch{return url;}}
export function collectionLabel(value:Partial<CollectionInput>):string {
 const input=normalizeCollectionInput(value);
 if(input.kind==='account')return input.name.trim()||input.account.trim()||'账号收藏';
 if(input.kind==='text')return input.body.trim()||input.name.trim();
 return input.name.trim()||collectionDomain(input.url)||input.url;
}
/** Copy-all deliberately excludes password; the detail provides a separate explicit operation. */
export function collectionCopy(value:Collection):string {
 return [value.name,value.kind==='account'&&value.account?`账号：${value.account}`:'',value.body,value.url,value.source?`来源：${value.source}`:''].filter(x=>!!x.trim()).join('\n\n');
}
export function collectionHasSupplement(value:CollectionInput):boolean {
 return !!((value.kind==='text'&&value.name)||value.source||(value.kind!=='text'&&value.body)||(value.kind==='account'&&value.url));
}
export function collectionSummary(value:Partial<CollectionInput>):string {
 const input=normalizeCollectionInput(value);
 if(input.kind==='account')return input.name?input.account:'';
 if(input.kind==='link')return input.name?collectionDomain(input.url):input.body;
 return input.name.trim();
}
