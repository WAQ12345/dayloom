import { totalConsumption } from './energy.ts';
export type Meal = { id: string; date: string; name: string; kcal: number; photoUri: string | null };
export type BackupMeal = Omit<Meal, 'photoUri'> & { photoBase64: string | null };
export type Backup = { format: 'daily-life-probe'; version: 1; meals: BackupMeal[] };
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function assertToday(date: string, today = localDate()) {
  if(date!==today) throw new Error('历史记录只读，只能填写今天。');
}
export function energy(intake: number, metabolism: number | null, expenditure: number | null) {
  const total=totalConsumption(metabolism,expenditure);
  return { total, difference: total===null?null:intake-total };
}
export function validateMeal(name: string,kcalText: string) {
  const kcal=Number(kcalText);
  if(!name.trim()||name.trim().length>100) throw new Error('食品名称需为1—100个字符。');
  if(!kcalText.trim()||!Number.isFinite(kcal)||kcal<0||kcal>100000) throw new Error('请填写0—100000之间的热量。');
  return {name:name.trim(),kcal};
}
export function parseBackup(raw:string):Backup {
  if(raw.length>20*1024*1024) throw new Error('验证版备份上限20MB。');
  const data=JSON.parse(raw);
  if(data.format!=='daily-life-probe'||data.version!==1||!Array.isArray(data.meals)||data.meals.length>1000) throw new Error('不是支持的验证版备份。');
  const ids=new Set();
  const meals=data.meals.map((m:BackupMeal)=>{
    if(typeof m.id!=='string'||!m.id||ids.has(m.id)||typeof m.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(m.date)||!Number.isFinite(Date.parse(m.date))||typeof m.name!=='string'||typeof m.kcal!=='number') throw new Error('备份记录无效。');
    if(m.photoBase64!==null&&(typeof m.photoBase64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(m.photoBase64))) throw new Error('图片内容无效。');
    ids.add(m.id);const meal=validateMeal(m.name,String(m.kcal));
    return {id:m.id,date:m.date,...meal,photoBase64:m.photoBase64};
  });
  return {format:'daily-life-probe',version:1,meals};
}
