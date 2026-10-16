import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { getSetting, setSetting } from '../data/settingsRepo.ts';
import type { DataContext } from '../data/sql.ts';
import { isValidTime } from '../domain/dates.ts';
import { REMINDER_ID, isDailyReminder, matchesDailyTime, reconcileReminderWith, updateReminderWith, createReminderQueue } from './reminderFlow.ts';

const KEY='daily-life.deepseek.key.v1';
export async function getApiKey():Promise<string|null>{return SecureStore.getItemAsync(KEY);}
export async function hasApiKey():Promise<boolean>{return !!(await getApiKey());}
export async function saveApiKey(key:string):Promise<void>{const k=key.trim();if(!k||k.length>500||/[\r\n]/.test(k))throw new Error('Key 格式无效');await SecureStore.setItemAsync(KEY,k,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});}
export async function deleteApiKey():Promise<void>{await SecureStore.deleteItemAsync(KEY);}
const CHANNEL='daily-life-settlement';
const TEST_IDENTIFIER='daily-life-reminder-test';
Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:false})});
// One queue for preference changes, restoration and reconciliation.
const serializeReminder=createReminderQueue();
async function ensureReminderChannel():Promise<void>{
 if(Platform.OS==='android'&&!await Notifications.getNotificationChannelAsync(CHANNEL))await Notifications.setNotificationChannelAsync(CHANNEL,{name:'晚间结算',importance:Notifications.AndroidImportance.HIGH,sound:'default'});
}
async function channelState():Promise<'allowed'|'quiet'|'blocked'|'missing'|'not-applicable'>{
 if(Platform.OS!=='android')return 'not-applicable';
 const channel=await Notifications.getNotificationChannelAsync(CHANNEL);
 if(!channel)return 'missing';
 if(channel.importance===Notifications.AndroidImportance.NONE)return 'blocked';
 return channel.importance<Notifications.AndroidImportance.HIGH?'quiet':'allowed';
}
async function canDeliver():Promise<boolean>{const permission=await Notifications.getPermissionsAsync();const channel=await channelState();return permission.granted&&channel!=='blocked'&&channel!=='missing';}
async function cancelDaily(ctx:DataContext):Promise<void>{
 const current=await getSetting(ctx.db,'reminder');
 for(const request of await Notifications.getAllScheduledNotificationsAsync())if(isDailyReminder(request,current))await Notifications.cancelScheduledNotificationAsync(request.identifier);
}
export function disableReminders(ctx:DataContext):Promise<void>{return serializeReminder(async()=>{
 await cancelDaily(ctx);await Notifications.cancelScheduledNotificationAsync(TEST_IDENTIFIER);
 const current=await getSetting(ctx.db,'reminder');await setSetting(ctx.db,'reminder',{...current,enabled:false,notificationId:null});
});}
async function scheduleDaily(time:string):Promise<string>{
 const [hour,minute]=time.split(':').map(Number);
 return Notifications.scheduleNotificationAsync({identifier:REMINDER_ID,content:{title:'给今天留一点回顾',body:'查看今天的记录，整理未完成的计划。',sound:'default',data:{dailyLifeReminder:true}},trigger:{type:Notifications.SchedulableTriggerInputTypes.DAILY,hour,minute,channelId:CHANNEL}});
}
export function updateReminder(ctx:DataContext,enabled:boolean,time:string):Promise<void>{return serializeReminder(async()=>{
 if(!isValidTime(time))throw new Error('请输入 HH:mm 格式的提醒时间');
 if(enabled){
  await ensureReminderChannel();let permission=await Notifications.getPermissionsAsync();
  if(!permission.granted)permission=await Notifications.requestPermissionsAsync();
  if(!permission.granted)throw new Error('通知权限未开启，可在系统设置中允许；日常记录不受影响');
  if(await channelState()==='blocked')throw new Error('晚间结算通知频道已关闭，请在系统通知设置中检查');
 }
 await updateReminderWith(reminderPort(ctx),enabled,time);
});}
function reminderPort(ctx:DataContext){return {read:()=>getSetting(ctx.db,'reminder'),write:(value:import('../domain/types.ts').ReminderSettings)=>setSetting(ctx.db,'reminder',value),list:()=>Notifications.getAllScheduledNotificationsAsync(),cancel:(id:string)=>Notifications.cancelScheduledNotificationAsync(id),available:canDeliver,schedule:scheduleDaily};}
export function reconcileReminder(ctx:DataContext):Promise<void>{return serializeReminder(async()=>{
 const current=await getSetting(ctx.db,'reminder');
 if(current.enabled)await ensureReminderChannel();
 await reconcileReminderWith(reminderPort(ctx));
});}
export async function reminderStatus(ctx:DataContext){
 const current=await getSetting(ctx.db,'reminder');const permission=await Notifications.getPermissionsAsync();const scheduled=await Notifications.getAllScheduledNotificationsAsync();const channel=await channelState();
 const active=current.enabled&&scheduled.some(n=>n.identifier===current.notificationId&&matchesDailyTime(n,current.time));
 const [hour,minute]=current.time.split(':').map(Number);
 const nextAt=active?await Notifications.getNextTriggerDateAsync({type:Notifications.SchedulableTriggerInputTypes.DAILY,hour,minute,channelId:CHANNEL}):null;
 return {enabled:current.enabled,permission:permission.status,channel,scheduled:active,deliverable:permission.granted&&channel!=='blocked'&&channel!=='missing',nextAt};
}
export function testReminder():Promise<void>{return serializeReminder(async()=>{
 await ensureReminderChannel();
 if(!await canDeliver())throw new Error('测试无法送达：请检查通知权限和晚间结算频道');
 await Notifications.cancelScheduledNotificationAsync(TEST_IDENTIFIER);
 await Notifications.scheduleNotificationAsync({identifier:TEST_IDENTIFIER,content:{title:'Dayloom提醒测试',body:'这是一条测试通知，晚间提醒偏好未改变。',sound:'default',data:{dailyLifeReminderTest:true}},trigger:{type:Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,seconds:5,channelId:CHANNEL}});
});}
export function onReminderTestReceived(listener:()=>void):()=>void{const sub=Notifications.addNotificationReceivedListener(n=>{if(n.request.content.data?.dailyLifeReminderTest===true)listener();});return()=>sub.remove();}
export type SavedBackup = { uri: string; filename: string; byteLength: number };
/** Android persists the directory grant; reuse it without asking on every backup. */
export async function chooseBackupDirectory():Promise<string|null>{
 try{return (await Directory.pickDirectoryAsync()).uri;}catch(error){
  const code=(error as {code?:unknown})?.code;
  const message=error instanceof Error?error.message:'';
  if(code==='ERR_PICKER_CANCELLED'||code==='ERR_PICKER_CANCELED'||/picker.*cancel(?:led|ed)/i.test(message))return null;
  throw new Error('无法打开保存位置，请重试或使用分享备份');
 }
}
export async function saveBackupToDirectory(bytes:Uint8Array,uri:string):Promise<SavedBackup>{
 if(bytes.length<4||bytes.length>100*1024*1024)throw new Error('备份大小无效');
 const directory=new Directory(uri);
 // A unique name avoids overwriting any existing user document.
 const timestamp=new Date().toISOString().replace(/[:.]/g,'-');
 const filename=`daily-life-${timestamp}-${Math.random().toString(36).slice(2,7)}.zip`;
 let file:File|null=null;
 try{
  // SAF content URIs require Directory.createFile; File.create is deliberately not used.
  file=directory.createFile(filename,'application/zip');
  file.write(bytes);
  const saved=await file.bytes();
  if(saved.length!==bytes.length||saved.some((value,index)=>value!==bytes[index]))throw new Error('readback mismatch');
  return {uri:file.uri,filename,byteLength:saved.length};
 }catch{
  let removed=true;
  if(file){try{file.delete();}catch{removed=false;}}
  throw new Error(removed?'备份保存失败，请更换保存位置或检查手机剩余空间后重试。':'备份保存失败，所选文件夹中可能留有不完整文件，请删除后重试。');
 }
}
export async function shareBackup(bytes:Uint8Array):Promise<void>{
 if(!await Sharing.isAvailableAsync())throw new Error('当前设备无法打开分享菜单');
 const file=new File(Paths.cache,`daily-life-${Date.now()}.zip`);file.write(bytes);
 try{await Sharing.shareAsync(file.uri,{mimeType:'application/zip',dialogTitle:'将Dayloom备份保存到文件'});}finally{if(file.exists)file.delete();}
}
export async function pickBackup():Promise<Uint8Array|null>{
 const result=await DocumentPicker.getDocumentAsync({type:['application/zip','application/octet-stream'],copyToCacheDirectory:true,multiple:false});
 if(result.canceled)return null;
 const asset=result.assets[0];if((asset.size??0)>100*1024*1024)throw new Error('备份超过 100 MB');
 const file=new File(asset.uri);try{if(file.size>100*1024*1024)throw new Error('备份超过 100 MB');return await file.bytes();}finally{if(file.exists&&file.uri.startsWith(Paths.cache.uri))file.delete();}
}
