import * as SQLite from 'expo-sqlite';
import { Directory,File,Paths } from 'expo-file-system';
import { assertToday,localDate,validateMeal,type Meal,type Backup,parseBackup } from '../domain/records';
let pending:Promise<SQLite.SQLiteDatabase>|undefined;
export function database(){
  if(!pending)pending=(async()=>{const db=await SQLite.openDatabaseAsync('daily-life-probe.db');await db.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS meals(id TEXT PRIMARY KEY NOT NULL,date TEXT NOT NULL,name TEXT NOT NULL,kcal REAL NOT NULL,photoUri TEXT);');return db})().catch(e=>{pending=undefined;throw e});
  return pending;
}
export async function listMeals(){return (await database()).getAllAsync<Meal>('SELECT * FROM meals ORDER BY date DESC,id DESC');}
function photos(){const dir=new Directory(Paths.document,'meal-photos');dir.create({idempotent:true,intermediates:true});return dir;}
export async function addMeal(name:string,kcalText:string,photo:string|null,date:string){
 assertToday(date);const data=validateMeal(name,kcalText);const id=`${Date.now()}-${Math.random().toString(36).slice(2)}`;let photoUri:null|string=null;
 if(photo){const original=new File(photo);if(original.size>8*1024*1024)throw new Error('验证版照片上限8MB，请换一张较小的照片。');const target=new File(photos(),id+'.jpg');await original.copy(target);photoUri=target.uri;}
 try{assertToday(date);await (await database()).runAsync('INSERT INTO meals(id,date,name,kcal,photoUri) VALUES(?,?,?,?,?)',id,date,data.name,data.kcal,photoUri)}catch(e){if(photoUri)new File(photoUri).delete();throw e}
}
export async function exportBackup(){
 const rows=await listMeals();const meals=[];
 for(const {photoUri,...row} of rows)meals.push({...row,photoBase64:photoUri?await new File(photoUri).base64():null});
 const backup:Backup={format:'daily-life-probe',version:1,meals};const raw=JSON.stringify(backup);parseBackup(raw);
 const file=new File(Paths.cache,`daily-life-${localDate()}.json`);file.create({overwrite:true});file.write(raw);return file.uri;
}
export async function restoreBackup(raw:string){
 const backup=parseBackup(raw);const restored:Meal[]=[];const created:File[]=[];
 try{
  for(const meal of backup.meals){let photoUri:null|string=null;if(meal.photoBase64){const f=new File(photos(),`restore-${Date.now()}-${restored.length}.jpg`);f.create();created.push(f);f.write(meal.photoBase64,{encoding:'base64'});photoUri=f.uri;}const {photoBase64:_,...row}=meal;restored.push({...row,photoUri});}
  const db=await database();await db.withExclusiveTransactionAsync(async tx=>{await tx.runAsync('DELETE FROM meals');for(const m of restored)await tx.runAsync('INSERT INTO meals VALUES(?,?,?,?,?)',m.id,m.date,m.name,m.kcal,m.photoUri)});
 }catch(e){for(const file of created)if(file.exists)file.delete();throw e}
 // Old image files are retained in this validation build to avoid deleting user data on recovery.
 return restored.length;
}
