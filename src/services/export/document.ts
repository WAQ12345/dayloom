import { formatIdeaTime, type Idea } from '../../domain/ideas.ts';
import { dayNumber, fromDayNumber } from '../../domain/dates.ts';
import { dailyEnergy, type EnergyData, type DailyEnergy } from '../../domain/energy.ts';
import { MEAL_TYPES, MEAL_LABEL, type Meal, type WaterRecord, type Item, type FoodSettlement } from '../../domain/types.ts';
import type { BaziChart } from '../../domain/bazi/index.ts';
export type Block={kind:'heading'|'text'|'ideaBody';text:string}|{kind:'table';headers:string[];rows:string[][]};
export type ExportDocument={kind:'food'|'bazi'|'items'|'ideas';title:string;scope:string;count:number;createdAt:string;blocks:Block[]};
const text=(value:string):Block=>({kind:'text',text:value});
const heading=(value:string):Block=>({kind:'heading',text:value});
const table=(headers:string[],rows:string[][]):Block=>({kind:'table',headers,rows});
const amount=(value:number|null)=>value===null?'未记录':`${value} kcal`;
const plain=(value:string)=>value.replace(/\*\*/g,'').replace(/`/g,'');
export function foodDocument(date:string,meals:Meal[],water:WaterRecord[],day:DailyEnergy,settlement:FoodSettlement|null,now=new Date()):ExportDocument{
 if(day.date!==date||meals.some(m=>m.date!==date)||water.some(w=>w.date!==date))throw new Error('导出日期与记录不一致，请重新读取');
 const blocks:Block[]=[heading('当日热量'),table(['项目','数值'],[['摄入',amount(day.intake)],['基础代谢',amount(day.metabolism)],['活动消耗',amount(day.expenditure)],['总消耗',amount(day.total)],['净差',day.net===null?'未记录':`${day.net>0?'+':''}${day.net} kcal · ${day.net>0?'净摄入':day.net<0?'净消耗':'收支平衡'}`]]),text('总消耗＝基础代谢＋活动消耗（未填写按 0）；净差＝摄入－总消耗。'),text(day.eligible?'已自动计入月累计':'热量数据缺失，未计入月累计')];
 for(const type of MEAL_TYPES){const rows=meals.filter(m=>m.mealType===type);blocks.push(heading(MEAL_LABEL[type]));if(!rows.length)blocks.push(text('无记录'));else for(const m of rows){blocks.push(text(`${m.name} · ${m.kcal} kcal · ${m.time??'时间未填写'}`));if(m.note)blocks.push(text(`备注：${m.note}`));}}
 blocks.push(heading('饮水'),text(water.length?`累计 ${water.reduce((n,w)=>n+w.amountMl,0)} ml`:'无饮水记录'));
 if(water.length)blocks.push(table(['时间','饮水量','备注'],water.map(w=>[w.time,`${w.amountMl} ml`,w.note??'—'])));
 if(settlement?.note)blocks.push(heading('结算备注'),text(settlement.note));
 return {kind:'food',title:'每日饮食记录',scope:date,count:meals.length+water.length,createdAt:now.toISOString(),blocks};
}
/** A single immutable document, including empty days, in inclusive calendar order. */
export function foodRangeDocument(from:string,to:string,meals:Meal[],water:WaterRecord[],energy:EnergyData,settlements:FoodSettlement[],today:string,now=new Date()):ExportDocument{
 const first=dayNumber(from),last=dayNumber(to);
 if(first>last||to>today)throw new Error('请选择有效的起止日期');
 const mealDays=new Map<string,Meal[]>(),waterDays=new Map<string,WaterRecord[]>();
 for(const m of meals){if(m.date>=from&&m.date<=to)mealDays.set(m.date,[...(mealDays.get(m.date)??[]),m]);}
 for(const w of water){if(w.date>=from&&w.date<=to)waterDays.set(w.date,[...(waterDays.get(w.date)??[]),w]);}
 const settled=new Map(settlements.map(s=>[s.date,s]));
 const blocks:Block[]=[];let count=0;
 for(let n=first;n<=last;n++){
  const date=fromDayNumber(n),rows=mealDays.get(date)??[];
  const day=foodDocument(date,rows,waterDays.get(date)??[],dailyEnergy({...energy,meals:rows},date,today),settled.get(date)??null,now);
  blocks.push(heading(date),...day.blocks);count+=day.count;
 }
 return{kind:'food',title:'饮食记录',scope:from===to?from:`${from} 至 ${to} · ${last-first+1} 天`,count,createdAt:now.toISOString(),blocks};
}
export function sortExportItems(items:Item[],sort:string):Item[]{return [...items].sort((a,b)=>sort==='price'?(b.priceCents??-1)-(a.priceCents??-1):sort==='created'?b.createdAt-a.createdAt:(b.purchaseDate??'').localeCompare(a.purchaseDate??''));}
export function itemsDocument(items:Item[],query:string,category:string|null,sort:string,now=new Date()):ExportDocument{
 if(!items.length)throw new Error('没有可导出的物品');
 const scope=`${category??'全部分类'}${query?` · 搜索：${query}`:''} · ${sort==='price'?'价格从高到低':sort==='created'?'最近添加':'最近购入'}`;
 const blocks:Block[]=[table(['序号','名称','分类','购买日期','购买价'],sortExportItems(items,sort).map((i,n)=>[String(n+1),i.name,i.category,i.purchaseDate??'未知',i.priceCents===null?'未知':`¥${(i.priceCents/100).toFixed(2)}`]))];
 for(const [n,i] of sortExportItems(items,sort).entries()){if(i.brand||i.note){blocks.push(heading(`${n+1}. ${i.name}`));if(i.brand)blocks.push(text(`品牌／型号：${i.brand}`));if(i.note)blocks.push(text(`备注：${i.note}`));}}
 return {kind:'items',title:'物品列表',scope,count:items.length,createdAt:now.toISOString(),blocks};
}
export function ideasDocument(ideas:Idea[],now=new Date()):ExportDocument{
 if(!ideas.length)throw new Error('请选择想法');
 const sorted=[...ideas].sort((a,b)=>b.createdAt-a.createdAt||b.id.localeCompare(a.id));
 const blocks:Block[]=[];
 for(const [index,idea] of sorted.entries()){
  blocks.push(heading(`${index+1} · 编写时间 ${formatIdeaTime(idea.createdAt)}`),{kind:'ideaBody',text:idea.body});
  if(idea.tags.length)blocks.push(text(idea.tags.map(tag=>`#${tag}`).join(' · ')));
  if(idea.updatedAt!==idea.createdAt)blocks.push(text(`修改时间 ${formatIdeaTime(idea.updatedAt)}`));
 }
 return{kind:'ideas',title:'想法',scope:'所选想法 · 编写时间倒序',count:sorted.length,createdAt:now.toISOString(),blocks};
}
export function baziDocument(chart:BaziChart,now=new Date()):ExportDocument{
 const blocks:Block[]=[];const lines=chart.markdown.split('\n');
 for(let i=0;i<lines.length;i++){const line=lines[i].trim();if(!line)continue;if(line.startsWith('|')){const rows:string[][]=[];while(i<lines.length&&lines[i].trim().startsWith('|')){const cells=lines[i].trim().replace(/^\||\|$/g,'').split('|').map(c=>plain(c.trim()));if(!cells.every(c=>/^:?-+:?$/.test(c)))rows.push(cells);i++;}i--;if(rows.length)blocks.push(table(rows[0],rows.slice(1)));}else{const h=/^#{1,6}\s+(.+)$/.exec(line);blocks.push(h?heading(plain(h[1])):text(plain(line)));}}
 blocks.push(heading('计算版本'),text(chart.algorithmVersion),text('传统文化与娱乐参考。保留命盘生成时的资料与计算结果，未附 AI 解读。'));
 return {kind:'bazi',title:'八字命盘',scope:`${chart.input.calendar==='lunar'?'农历':'公历'} ${chart.input.date}${chart.input.leapMonth?'（闰月）':''} · ${chart.timeLabel}`,count:1,createdAt:now.toISOString(),blocks};
}
export const escapeHtml=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const md=(v:string)=>escapeHtml(v).replace(/([\\`*_[\]#|])/g,'\\$1').replace(/\r?\n/g,'<br>');
export function renderMarkdown(d:ExportDocument):string{return [`# ${md(d.title)}`,md(d.scope),`记录数量：${d.count} · 导出时间：${d.createdAt}`, ...d.blocks.map(b=>b.kind==='ideaBody'?b.text:b.kind==='table'?`| ${b.headers.map(md).join(' | ')} |\n| ${b.headers.map(()=>'---').join(' | ')} |\n${b.rows.map(row=>`| ${row.map(md).join(' | ')} |`).join('\n')}`:b.kind==='heading'?`## ${md(b.text)}`:md(b.text))].join('\n\n')+'\n';}
export function renderHtml(d:ExportDocument):string{
 const e=(v:string)=>escapeHtml(v).replace(/\r?\n/g,'<br>');
 return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family: sans-serif;color:#382F2B;font-size:11pt;line-height:1.65;margin:0}h1{font-size:22pt;color:#A94F36}h2{font-size:14pt;color:#A94F36;margin-top:20pt;break-after:avoid}p{white-space:normal;overflow-wrap:anywhere;orphans:3;widows:3}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:10pt;margin:12pt 0}thead{display:table-header-group}th,td{border:1px solid #E7DDCF;padding:6pt;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word}th{background:#F2E4D2}tr{break-inside:auto}.idea-body{white-space:pre-wrap}.meta{font-size:9pt;color:#756A5E}</style></head><body><h1>${e(d.title)}</h1><p>${e(d.scope)}</p><p class="meta">记录数量：${d.count} · 导出时间：${e(d.createdAt)}</p>${d.blocks.map(b=>b.kind==='ideaBody'?`<p class="idea-body">${escapeHtml(b.text)}</p>`:b.kind==='table'?`<table><thead><tr>${b.headers.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(row=>`<tr>${row.map(c=>`<td>${e(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`:b.kind==='heading'?`<h2>${e(b.text)}</h2>`:`<p>${e(b.text)}</p>`).join('')}</body></html>`;
}
