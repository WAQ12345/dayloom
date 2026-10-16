import type { ReminderSettings } from '../domain/types.ts';

export type ReminderRequest = { identifier: string; content: { data?: Record<string, unknown> }; trigger: unknown };
export type ReminderPort = {
 read(): Promise<ReminderSettings>;
 write(value: ReminderSettings): Promise<void>;
 list(): Promise<ReminderRequest[]>;
 cancel(id: string): Promise<void>;
 available(): Promise<boolean>;
 schedule(time: string): Promise<string>;
};
export const REMINDER_ID = 'daily-life-evening';
export function isDailyReminder(request: ReminderRequest, current: ReminderSettings): boolean {
 return request.identifier === REMINDER_ID || request.identifier === current.notificationId || request.content.data?.dailyLifeReminder === true;
}
export function matchesDailyTime(request: ReminderRequest, time: string): boolean {
 const trigger = request.trigger as { type?: string; hour?: number; minute?: number; dateComponents?: { hour?: number; minute?: number }; repeats?: boolean } | null;
 const [hour, minute] = time.split(':').map(Number);
 if (trigger?.type === 'daily') return trigger.hour === hour && trigger.minute === minute;
 // iOS returns a repeating calendar trigger for the DAILY input.
 return trigger?.type === 'calendar' && trigger.repeats === true && trigger.dateComponents?.hour === hour && trigger.dateComponents?.minute === minute;
}
/** Restores only an existing opt-in; never requests permission or changes system settings. */
export async function reconcileReminderWith(port: ReminderPort): Promise<void> {
 const current = await port.read();
 const owned = (await port.list()).filter(request => isDailyReminder(request, current));
 if (!current.enabled) {
  for (const request of owned) await port.cancel(request.identifier);
  return;
 }
 if (!await port.available()) return;
 const matching = owned.find(request => matchesDailyTime(request, current.time));
 for (const request of owned) if (request !== matching) await port.cancel(request.identifier);
 const id = matching?.identifier ?? await port.schedule(current.time);
 if (id !== current.notificationId) {
  try { await port.write({ ...current, notificationId: id }); }
  catch (error) { if (!matching) await port.cancel(id); throw error; }
 }
}

/** Preference edits are event driven; the picker cancel/load paths never call this. */
export async function persistReminderSelection(
 previous: Pick<ReminderSettings,'enabled'|'time'>,
 next: Pick<ReminderSettings,'enabled'|'time'>,
 persist: (value: Pick<ReminderSettings,'enabled'|'time'>) => Promise<void>,
 apply: (value: Pick<ReminderSettings,'enabled'|'time'>) => void,
): Promise<void> {
 apply(next);
 try { await persist(next); }
 catch (error) { apply(previous); throw error; }
}

/** Compensate a failed edit so the previous persisted preference remains authoritative. */
export async function updateReminderWith(port: ReminderPort, enabled: boolean, time: string): Promise<void> {
 const previous=await port.read();
 let created:string|null=null;
 try {
  for(const request of await port.list())if(isDailyReminder(request,previous))await port.cancel(request.identifier);
  if(enabled)created=await port.schedule(time);
  await port.write({enabled,time,notificationId:created});
 } catch(error) {
  try {
   if(created)await port.cancel(created);
   await port.write(previous);
   await reconcileReminderWith(port);
  } catch { throw new Error('提醒保存失败，原提醒恢复未完成，请重新打开应用后重试'); }
  throw error;
 }
}

export function createReminderQueue(){
 let queue:Promise<unknown>=Promise.resolve();
 return function enqueue<T>(action:()=>Promise<T>):Promise<T>{const task=queue.then(action);queue=task.catch(()=>undefined);return task;};
}
