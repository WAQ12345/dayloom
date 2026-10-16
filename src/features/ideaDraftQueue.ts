/** One IdeasScreen lifetime. Disposal cancels queued writes, never schedules a final write. */
export class IdeaDraftQueue {
 private generation=0;
 private pending:Promise<void>=Promise.resolve();
 enqueue(write:()=>Promise<void>):Promise<void>{
  const generation=this.generation;
  const work=this.pending.catch(()=>{}).then(async()=>{if(generation===this.generation)await write();});
  this.pending=work;
  return work;
 }
 flush():Promise<void>{return this.pending;}
 cancelPending():void{this.generation++;}
}
