import * as T from './tables.ts';
const mod=(n:number,m:number)=>((n%m)+m)%m;
export interface Shensha {name:string;positions:string[];method:string}
export function computeShensha(gans:(string|null)[],zhis:(string|null)[],sex:'男'|'女'):Shensha[]{
 const [yg,,dg]=gans as string[],[yz,mz,dz]=zhis as string[];
 const gl=['年干','月干','日干','时干'],zl=['年支','月支','日支','时支'];const result:Shensha[]=[];
 const add=(name:string,need:string|string[],method:string,values=zhis,labels=zl)=>{const needles=Array.isArray(need)?need:[need];const positions=values.flatMap((v,i)=>v!==null&&needles.includes(v)?[labels[i]]:[]);if(positions.length)result.push({name,positions,method});};
 add('天乙贵人',[...T.TIANYI[yg],...T.TIANYI[dg]],'年干/日干查地支');
 const [kind,word]=T.TIANDE[mz];add('天德',word,kind==='gan'?'月支查天干':'月支查地支',kind==='gan'?gans:zhis,kind==='gan'?gl:zl);
 add('月德',T.YUEDE[mz],'月支三合',gans,gl);add('文昌',[T.WENCHANG[yg],T.WENCHANG[dg]],'年干/日干查地支');
 add('学堂',T.XUETANG[dg],'日干长生');add('词馆',T.CIGUAN[dg],'日干临官');
 const sanhe=(name:string,table:Record<string,string>,method='年支/日支')=>add(name,[table[T.SANHE[yz]],table[T.SANHE[dz]]],method);
 sanhe('将星',T.JIANGXING,'年支/日支三合');sanhe('华盖',T.HUAGAI);sanhe('驿马',T.YIMA);
 add('天医',T.ZHI[mod(T.ZHI.indexOf(mz)-1,12)],'月支前一位');add('禄神',T.CIGUAN[dg],'日干');add('金舆',T.JINYU[dg],'日干');add('羊刃',T.YANGBLADE[dg],'日干');
 sanhe('劫煞',T.JIESHA);sanhe('灾煞',T.ZAISHA);sanhe('亡神',T.WANGSHEN);sanhe('桃花/咸池',T.TAOHUA);
 add('孤辰',T.GUCHEN[yz],'年支');add('寡宿',T.GUASU[yz],'年支');
 const start=mod(T.ZHI.indexOf(dz)-T.GAN.indexOf(dg),12);add('空亡/旬空',[T.ZHI[mod(start-2,12)],T.ZHI[mod(start-1,12)]],'日柱旬空');
 const yuan=(T.GAN.indexOf(yg)%2===0)===(sex==='男')?T.YUANCHEN_FORWARD:T.YUANCHEN_REVERSE;
 add('元辰',yuan[yz],'年支阴阳男女',zhis.slice(1),zl.slice(1));add('血刃',T.XUEREN[mz],'月支');return result;
}
