import test from 'node:test';
import assert from 'node:assert/strict';
import { foodDocument, foodRangeDocument, itemsDocument, baziDocument, renderHtml, renderMarkdown } from '../src/services/export/document.ts';
import { dailyEnergy } from '../src/domain/energy.ts';
import { calculateBazi } from '../src/domain/bazi/index.ts';
import type { Meal, Item } from '../src/domain/types.ts';
const now=new Date('2026-10-13T04:00:00Z'),date='2026-10-13';
const meal:Meal={id:'m',date,mealType:'lunch',name:'饭 <script>alert(1)</script>',kcal:1900,time:null,note:'长备注\n第二行 | 特殊字符',photo:'SECRET.jpg',createdAt:1,updatedAt:1};
const item:Item={id:'i',name:'耳机',category:'数码',purchaseDate:null,priceCents:null,brand:'型号',location:'抽屉',note:'备注',photo:'SECRET.jpg',createdAt:1,updatedAt:1};
test('food export keeps net direction, null values and no photo data',()=>{
 const day=dailyEnergy({meals:[meal],days:{[date]:{metabolism:1500,expenditure:800}},settlements:{},currentMetabolism:null},date,date);
 const doc=foodDocument(date,[meal],[],day,null,now);const md=renderMarkdown(doc),html=renderHtml(doc);
 assert.match(md,/-400 kcal/);assert.match(md,/已自动计入月累计/);assert.match(md,/无饮水记录/);assert.ok(!md.includes('SECRET'));assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);
 meal.note='changed';assert.ok(!renderMarkdown(doc).includes('changed'));
 assert.throws(()=>foodDocument('2026-10-12',[meal],[],day,null,now));
});
test('empty day exports missing rather than real zero, valid zero remains zero',()=>{
 const day=dailyEnergy({meals:[],days:{},settlements:{},currentMetabolism:null},date,date);
 assert.match(renderMarkdown(foodDocument(date,[],[],day,null,now)),/未记录/);
 const zero={...day,intake:0,total:0,net:0,eligible:true};assert.match(renderMarkdown(foodDocument(date,[],[],zero,null,now)),/0 kcal · 收支平衡/);
});
test('items export preserves filters, order, unknown versus zero and full notes',()=>{
 const md=renderMarkdown(itemsDocument([item,{...item,id:'z',name:'赠品',priceCents:0,note:'最后一行'.repeat(100)}],'耳','数码','price',now));
 assert.match(md,/搜索：耳/);assert.match(md,/未知/);assert.match(md,/¥0.00/);assert.ok(md.indexOf('赠品')<md.indexOf('耳机'));assert.ok(md.includes('最后一行'.repeat(100)));assert.ok(!md.includes('SECRET'));
 assert.ok(!md.includes('抽屉'));assert.ok(!renderHtml(itemsDocument([item],'',null,'recent',now)).includes('位置：'));
 assert.throws(()=>itemsDocument([],'',null,'recent',now));
});
test('bazi export uses fixed chart and retains unknown time, algorithm and lunar leap input',()=>{
 const chart=calculateBazi({calendar:'lunar',date:'2023-02-04',leapMonth:true,time:{kind:'unknown'},sex:'男'},now);
 const doc=baziDocument(chart,now),md=renderMarkdown(doc);assert.match(md,/闰月/);assert.match(md,/未知|不确定/);assert.ok(md.includes(chart.algorithmVersion));assert.match(renderHtml(doc),/<thead>/);chart.markdown='changed';assert.ok(!renderMarkdown(doc).includes('changed'));
});

test('food range is inclusive across leap day, excludes outside records and freezes document',()=>{
 const from='2024-02-28',to='2024-03-01';
 const rows=[{...meal,date:from,kcal:1900},{...meal,id:'m2',date:to,kcal:2200},{...meal,id:'private',date:'2024-03-02',name:'outside-range'}];
 const energy={meals:rows,days:{[from]:{metabolism:1500,expenditure:800},[to]:{metabolism:1500,expenditure:500}},settlements:{},currentMetabolism:null};
 const doc=foodRangeDocument(from,to,rows,[],energy,[],date,now),md=renderMarkdown(doc);
 assert.equal(doc.count,2);assert.match(doc.scope,/3 天/);
 assert.ok(md.indexOf('## 2024-02-28')<md.indexOf('## 2024-02-29'));assert.ok(md.indexOf('## 2024-02-29')<md.indexOf('## 2024-03-01'));
 assert.match(md,/-400 kcal/);assert.match(md,/\+200 kcal/);assert.match(md,/未记录/);assert.ok(!md.includes('outside-range'));
 rows[0].name='changed-after-range-snapshot';assert.ok(!renderMarkdown(doc).includes('changed-after-range-snapshot'));
 assert.throws(()=>foodRangeDocument(to,from,[],[],energy,[],date,now));
 assert.throws(()=>foodRangeDocument('2027-01-01','2027-01-02',[],[],energy,[],date,now));
});
test('same-day and cross-year food export keep empty dates rather than fabricate values',()=>{
 const energy={meals:[],days:{},settlements:{},currentMetabolism:null};
 assert.equal(foodRangeDocument(date,date,[],[],energy,[],date,now).scope,date);
 const md=renderMarkdown(foodRangeDocument('2025-12-31','2026-01-01',[],[],energy,[],date,now));
 assert.match(md,/2 天/);assert.match(md,/2026-01-01/);assert.match(md,/活动消耗 \| 0 kcal/);assert.match(md,/基础代谢 \| 未记录/);
});
