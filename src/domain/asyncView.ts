import { isValidDate, shiftDate } from './dates.ts';
/** A request token is invalidated immediately on intent, before a React effect can run. */
export class DateViewCoordinator {
 target:string;
 displayed:string;
 private today:string;
 private generation=0;
 constructor(today:string){this.today=today;this.target=today;this.displayed=today;}
 select(date:string):void{if(!isValidDate(date)||date>this.today)throw new Error('不能查看未来日期');this.target=date;this.generation++;}
 step(delta:number):string{const date=shiftDate(this.target,delta);if(date<=this.today)this.select(date);return this.target;}
 begin():{generation:number;date:string}{return {generation:++this.generation,date:this.target};}
 current(token:{generation:number;date:string}):boolean{return token.generation===this.generation&&token.date===this.target;}
 accept(token:{generation:number;date:string}):boolean{if(!this.current(token))return false;this.displayed=token.date;return true;}
 fail(token:{generation:number;date:string}):boolean{if(!this.current(token))return false;this.target=this.displayed;this.generation++;return true;}
 rollover(today:string):boolean{if(today===this.today)return false;const follow=this.target===this.today;this.today=today;if(follow){this.select(today);return true;}return false;}
 cancel():void{this.generation++;}
}
/** Per-date epochs prevent an old full read from overwriting a later local water mutation. */
export class WaterReadCoordinator {
 private versions=new Map<string,number>();
 version(date:string):number{return this.versions.get(date)??0;}
 changed(date:string):number{const version=this.version(date)+1;this.versions.set(date,version);return version;}
 current(date:string,version:number):boolean{return this.version(date)===version;}
 async read<T>(date:string,reader:()=>Promise<T>):Promise<T>{for(;;){const version=this.version(date);const value=await reader();if(this.current(date,version))return value;}}
}
