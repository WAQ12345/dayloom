export type CollectionKind='text'|'link'|'account';
export type Collection={id:string;kind:CollectionKind;account:string;password:string;name:string;body:string;url:string;source:string;createdAt:number;updatedAt:number};
export type CollectionInput=Pick<Collection,'kind'|'name'|'body'|'url'|'source'|'account'|'password'>;
export type CollectionListItem=Omit<Collection,'password'>;
export function isCollectionUrl(value:string):boolean {
 if(!/^https?:\/\//i.test(value)||/\s|[\u0000-\u001f\u007f]/u.test(value)||Array.from(value).length>4096)return false;
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!!url.hostname&&!url.username&&!url.password;}catch{return false;}
}
export function validateCollection(value:unknown):CollectionInput {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('收藏格式无效');
 const v=value as Record<string,unknown>;
 if(typeof v.name!=='string'||Array.from(v.name.trim()).length>100)throw new Error('收藏名称最多100个字');
 if(typeof v.body!=='string'||Array.from(v.body).length>20000||/\u0000/.test(v.body))throw new Error('收藏正文最多20000个字');
 if(typeof v.source!=='string'||Array.from(v.source.trim()).length>200||/[\r\n\u0000]/.test(v.source))throw new Error('来源最多200个字');
 if(!['text','link','account'].includes(String(v.kind)))throw new Error('请选择收藏类型');
 const kind=v.kind as CollectionKind;
 let url='',account='',password='';
 if(kind!=='text'){
  if(typeof v.url!=='string')throw new Error('链接格式无效');url=v.url.trim();
  if(url&&!isCollectionUrl(url))throw new Error('请填写完整的 HTTP 或 HTTPS 链接');
 }
 if(kind==='text'&&!v.body.trim())throw new Error('请填写收藏正文');
 if(kind==='link'&&!url)throw new Error('请填写完整的 HTTP 或 HTTPS 链接');
 if(kind==='account'){
  if(typeof v.account!=='string'||Array.from(v.account.trim()).length>500||/[\u0000-\u001f\u007f]/.test(v.account))throw new Error('账号最多500个字，不能包含控制字符');
  if(typeof v.password!=='string'||Array.from(v.password).length>2000||/\u0000/.test(v.password))throw new Error('密码最多2000个字，不能包含空字符');
  account=v.account.trim();password=v.password;
  if(!account&&!password)throw new Error('账号和密码至少填写一项');
 }
 return{kind,name:v.name.trim(),body:v.body,url,source:v.source.trim(),account,password};
}
