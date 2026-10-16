import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { renderHtml, renderMarkdown, type ExportDocument } from './document';
export type ExportFormat='pdf'|'md';
const mime=(format:ExportFormat)=>format==='pdf'?'application/pdf':'text/markdown';
const prefix='zhaoxi-export-';
const legacyPrefix='chaoxi-export-';
export function cleanOldExports(){for(const item of new Directory(Paths.cache).list()){if(item instanceof File&&(item.name.startsWith(prefix)||item.name.startsWith(legacyPrefix))&&Date.now()-(item.modificationTime??Date.now())>86400000)item.delete();}}
export async function generateDocument(doc:ExportDocument,format:ExportFormat):Promise<File>{
 const filename=`${prefix}${doc.kind}-${new Date().toISOString().replace(/[:.]/g,'-')}-${Math.random().toString(36).slice(2,8)}.${format}`;
 const file=new File(Paths.cache,filename);
 try{if(format==='md')file.write(renderMarkdown(doc));else{const result=await Print.printToFileAsync({html:renderHtml(doc),width:595.28,height:841.89});const generated=new File(result.uri);try{await generated.copy(file);}finally{if(generated.exists)generated.delete();}}
 if(!file.exists||file.size===0)throw new Error('未生成有效文档');return file;
 }catch(e){if(file.exists)file.delete();throw e;}
}
export async function saveDocument(file:File,format:ExportFormat):Promise<string|null>{
 let dir:Directory;try{dir=await Directory.pickDirectoryAsync();}catch(e){if(/cancel/i.test(String((e as {code?:string})?.code)+' '+String(e)))return null;throw new Error('无法打开保存位置，请重试或使用分享');}
 let saved:File|undefined;try{saved=dir.createFile(file.name,mime(format));const bytes=await file.bytes();saved.write(bytes);const read=await saved.bytes();if(read.length!==bytes.length||read.some((v,i)=>v!==bytes[i]))throw new Error('文件校验失败');return saved.name;}catch{let removed=true;try{if(saved?.exists)saved.delete();}catch{removed=false;}throw new Error(removed?'文档保存失败，请重试':'保存失败，目标文件夹可能留下不完整文档');}
}
export async function shareDocument(file:File,format:ExportFormat):Promise<void>{if(!await Sharing.isAvailableAsync())throw new Error('当前设备无法打开分享菜单');await Sharing.shareAsync(file.uri,{mimeType:mime(format),dialogTitle:'分享Dayloom文档'});/* Keep cache for external readers; clean after 24h on next startup. */}
