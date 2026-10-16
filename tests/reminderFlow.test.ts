import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileReminderWith, persistReminderSelection, updateReminderWith, createReminderQueue, type ReminderPort, type ReminderRequest } from '../src/services/reminderFlow.ts';
import type { ReminderSettings } from '../src/domain/types.ts';
const daily=(id:string):ReminderRequest=>({identifier:id,content:{data:{dailyLifeReminder:true}},trigger:{type:'daily',hour:21,minute:30}});
function fixture(enabled=true, available=true, requests:ReminderRequest[]=[]){
 let settings:ReminderSettings={enabled,time:'21:30',notificationId:'old'};
 const cancelled:string[]=[];let schedules=0;
 const port:ReminderPort={read:async()=>settings,write:async value=>{settings=value},list:async()=>requests,cancel:async id=>{cancelled.push(id);requests=requests.filter(n=>n.identifier!==id)},available:async()=>available,schedule:async()=>{schedules++;requests.push(daily('new'));return 'new'}};
 return {port,cancelled,settings:()=>settings,schedules:()=>schedules};
}
test('existing opt-in with lost schedule is restored exactly once',async()=>{const f=fixture();await reconcileReminderWith(f.port);await reconcileReminderWith(f.port);assert.equal(f.schedules(),1);assert.equal(f.settings().notificationId,'new')});
test('disabled reminder cancels stale daily without enabling or scheduling',async()=>{const f=fixture(false,true,[daily('old')]);await reconcileReminderWith(f.port);assert.deepEqual(f.cancelled,['old']);assert.equal(f.schedules(),0);assert.equal(f.settings().enabled,false)});
test('blocked permission or channel does not schedule or rewrite preferences',async()=>{const f=fixture(true,false);await reconcileReminderWith(f.port);assert.equal(f.schedules(),0);assert.equal(f.settings().notificationId,'old')});
test('duplicates removed but matching repeating iOS calendar retained',async()=>{const request=daily('ios');request.trigger={type:'calendar',repeats:true,dateComponents:{hour:21,minute:30}};const f=fixture(true,true,[request,daily('duplicate')]);await reconcileReminderWith(f.port);assert.deepEqual(f.cancelled,['duplicate']);assert.equal(f.schedules(),0);assert.equal(f.settings().notificationId,'ios')});
test('wrong time is replaced, unrelated notifications are preserved',async()=>{const wrong=daily('old');wrong.trigger={type:'daily',hour:20,minute:30};const unrelated={...daily('other'),content:{data:{}}};const f=fixture(true,true,[wrong,unrelated]);await reconcileReminderWith(f.port);assert.deepEqual(f.cancelled,['old']);assert.equal(f.schedules(),1)});

test('persistence failure cancels only newly scheduled notification',async()=>{const f=fixture();f.port.write=async()=>{throw new Error('disk full')};await assert.rejects(reconcileReminderWith(f.port),/disk full/);assert.deepEqual(f.cancelled,['new']);assert.equal(f.settings().notificationId,'old');const retained=fixture(true,true,[daily('existing')]);retained.port.write=f.port.write;await assert.rejects(reconcileReminderWith(retained.port),/disk full/);assert.deepEqual(retained.cancelled,[])});

test('auto-save applies confirmed selection and rolls back the displayed value on failure',async()=>{
 const previous={enabled:true,time:'23:30'},next={enabled:false,time:'22:00'};let shown=previous;let writes=0;
 const apply=(value:typeof previous)=>{shown=value};
 assert.deepEqual(shown,previous);assert.equal(writes,0);
 await assert.rejects(persistReminderSelection(previous,next,async()=>{writes++;throw new Error('denied')},apply),/denied/);
 assert.deepEqual(shown,previous);assert.equal(writes,1);
 await persistReminderSelection(previous,next,async()=>{writes++},apply);assert.deepEqual(shown,next);assert.equal(writes,2);
});
test('failed preference write restores previous enabled schedule without permission request',async()=>{
 const f=fixture(true,true,[daily('old')]);const write=f.port.write;let writes=0;f.port.write=async value=>{if(++writes===1)throw new Error('write failed');await write(value)};
 await assert.rejects(updateReminderWith(f.port,true,'22:00'),/write failed/);
 assert.equal(f.settings().enabled,true);assert.equal(f.settings().time,'21:30');assert.equal(f.schedules(),2);
});
test('rapid changes serialize and a rejected edit does not block subsequent save',async()=>{
 const enqueue=createReminderQueue();const events:string[]=[];let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});
 const first=enqueue(async()=>{events.push('first');await pending;throw new Error('first failed')});
 const rejected=assert.rejects(first,/first failed/);const second=enqueue(async()=>{events.push('second')});
 await Promise.resolve();assert.deepEqual(events,['first']);release();await rejected;await second;assert.deepEqual(events,['first','second']);
});
