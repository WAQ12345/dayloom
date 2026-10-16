import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../../src/data/migrations.ts';
import type { DataContext, SqlDb, SqlExecutor, PhotoStore } from '../../src/data/sql.ts';
export function nodeDb(filename = ':memory:'):SqlDb & {close():void}{
  const native=new DatabaseSync(filename);
  const executor:SqlExecutor={exec:async s=>{native.exec(s);},run:async(s,p=[])=>({changes:Number(native.prepare(s).run(...p).changes)}),all:async<T>(s:string,p:readonly(string|number|null)[]=[])=>native.prepare(s).all(...p) as T[],first:async<T>(s:string,p:readonly(string|number|null)[]=[])=>native.prepare(s).get(...p) as T??null};
  let queue:Promise<unknown>=Promise.resolve();
  return{...executor,close:()=>native.close(),transaction<T>(fn:(tx:SqlExecutor)=>Promise<T>):Promise<T>{const work=queue.then(async()=>{native.exec('BEGIN IMMEDIATE');try{const result=await fn(executor);native.exec('COMMIT');return result;}catch(e){native.exec('ROLLBACK');throw e;}});queue=work.catch(()=>undefined);return work;}};
}
export function memoryPhotos():PhotoStore {const files=new Map<string,Uint8Array>();let count=0;return{importFromUri:async()=>{const key=`test_${count++}.jpg`;files.set(key,new Uint8Array([1,2,3]));return key;},write:async(n,b)=>{if(files.has(n))throw new Error('exists');files.set(n,b.slice());},read:async n=>{const b=files.get(n);if(!b)throw new Error('missing');return b.slice();},exists:n=>files.has(n),remove:n=>{files.delete(n);},list:()=>[...files.keys()],uri:n=>`memory://${n}`};}
export async function testContext(date='2026-10-12'):Promise<DataContext & {setDate(d:string):void;close():void}>{const db=nodeDb();await migrate(db);let current=new Date(date+'T12:00:00');return{db,photos:memoryPhotos(),clock:{now:()=>current},setDate:d=>{current=new Date(d+'T12:00:00');},close:()=>db.close()};}
