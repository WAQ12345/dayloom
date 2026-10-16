import React,{useState} from 'react';
import {ScrollView,StyleSheet,Text,View,useWindowDimensions} from 'react-native';
import {C} from '../ui/kit';
import {Disclosure} from '../ui/Disclosure';
import {MarkdownText} from '../ui/MarkdownText';
import {currentCycleIndex,type BaziChart} from '../domain/bazi';
import {NOTES} from '../domain/bazi/explanations';
const keys=['year','month','day','hour'] as const;
const labels=['年柱','月柱','日柱','时柱'];
function Note({text}:{text:string}){return <Text style={s.note}>{text}</Text>;}
export function BaziChartView({chart,now}:{chart:BaziChart;now:Date}){
 const notes=chart.explanationNotes??NOTES;
 const current=currentCycleIndex(chart,now);const [selected,setSelected]=useState(current);
 const {width,fontScale}=useWindowDimensions();const gridWidth=Math.max(width-36,310*fontScale);
 // Recreate only the horizontal native subtree when its geometry changes.
 // This clears cached percentage measurements and scroll offset while keeping
 // Disclosure and the selected fortune cycle mounted.
 const pillarLayoutKey=`${width}-${fontScale}`;
 if(chart.schemaVersion!==2)return <><Note text="历史命盘 · 保留生成时的资料与口径，新字段未自动补算。"/><MarkdownText text={chart.markdown}/></>;
 return <>
  <Disclosure title="出生资料" initiallyOpen><View style={s.summary}>{!!chart.profileNickname&&<Text style={s.body}>{chart.profileNickname}</Text>}<Text style={s.body}>公历 {chart.solarDate} · {chart.input.sex}</Text><Note text={`农历 ${chart.lunarLabel} · ${chart.timeLabel}`}/>{!!chart.input.place&&<Note text={`出生地 ${chart.input.place}`}/>}</View>
  {chart.timeConversion&&<Note text={chart.timeConversion.summary}/>}
  {chart.warnings.map(w=><Text key={w} accessibilityRole="alert" style={s.warning}>{w}</Text>)}<Note text={notes.birth}/></Disclosure>
  <Disclosure title="四柱" initiallyOpen><ScrollView key={pillarLayoutKey} horizontal contentOffset={{x:0,y:0}} showsHorizontalScrollIndicator style={{flexGrow:0}}><View style={{width:gridWidth}}><View style={s.row}>{labels.map((label,i)=><View key={label} style={s.pillar}><Note text={label}/><Text style={[s.gan,i===2&&{color:C.accent}]}>{chart.pillars[keys[i]].gan}</Text><Text style={s.gan}>{chart.pillars[keys[i]].zhi}</Text><Text style={s.body}>{chart.pillars[keys[i]].tenGod}</Text></View>)}</View></View></ScrollView><Note text={notes.pillars}/></Disclosure>
  <Disclosure title="四柱详项">{keys.map((k,i)=>{const d=chart.details?.[k];return <View key={k} style={s.detail}><Text style={s.label}>{labels[i]} · {chart.pillars[k].label}</Text>{d?<><Text style={s.body}>藏干 {d.hidden.map(h=>`${h.gan}${h.element} · ${h.tenGod}`).join(' / ')}</Text><Text style={s.body}>五行 {d.wuxing} · 纳音 {d.nayin}</Text><Note text={`十二长生 ${d.growth} · 旬空 ${d.voids}`}/></>:<Note text="时辰未知，未计算"/>}</View>})}<Text style={s.body}>{Object.entries(chart.elements??{}).map(([k,v])=>`${k} ${v}`).join(' · ')}{chart.hourUnknown?'（已知六字）':''}</Text><Note text={notes.details}/></Disclosure>
  <View style={s.section}><Text style={s.heading}>大运与流年</Text><Text style={s.body}>{chart.forward?'顺排':'逆排'} · 出生后 {chart.qiyun.label} 起运</Text><Note text={`交运 ${chart.startSolar}${chart.input.time.kind!=='clock'?'（暂算）':''}`}/>{chart.cycles?.map((cycle,i)=><Disclosure key={cycle.step} title={`${cycle.step==='起运前'?'起运前':cycle.ganzhi} · ${cycle.startYear}—${cycle.endYear}${i===current?' · 当前':''}`} open={selected===i} onToggle={()=>setSelected(selected===i?-1:i)}><Note text={`${cycle.startAge}—${cycle.endAge}虚岁 · ${cycle.startDate} 至 ${cycle.endDate}（结束时刻不含）`}/>{cycle.annual.length?cycle.annual.map(a=><View key={a.year} style={s.annual}><Text style={s.body}>{a.year}</Text><Text style={s.body}>{a.ganzhi} · {a.age}虚岁</Text></View>):<Note text="此阶段无1900—2100范围内的流年资料"/>}</Disclosure>)}<Note text={notes.cycles}/></View>
  <Disclosure title="专业资料">{([['taiyuan','胎元'],['minggong','命宫'],['shengong','身宫']] as const).map(([key,label])=>{const p=chart.professional?.[key];return <Text key={key} style={s.body}>{label}　{p?`${p.ganzhi} · ${p.nayin}`:'时辰未知，未计算'}</Text>})}<Note text={notes.professional}/></Disclosure>
  <Disclosure title={`合冲刑害 · ${chart.relations?.length??0}组`}>{chart.relations?.length?chart.relations.map((r,i)=><View key={i}><Text style={s.label}>{r.name} · {r.symbols}</Text><Note text={r.positions.join('、')}/></View>):<Note text="未命中已收录关系"/>}<Note text={notes.relations}/></Disclosure>
  <Disclosure title={`神煞 · ${chart.shensha.length}项`}>{chart.shensha.map((x,i)=><View key={i}><Text style={s.label}>{x.name} · {x.positions.join('、')}</Text><Note text={x.method}/></View>)}{!chart.shensha.length&&<Note text="未命中已收录神煞"/>}<Note text={notes.shensha}/></Disclosure>
  <Disclosure title="排盘口径"><Note text={chart.calculationNotes}/><Note text={notes.rules}/><Note text={`算法 ${chart.algorithmVersion}\n规则 ${chart.ruleVersion}\n释义 ${chart.explanationVersion}`}/></Disclosure>
 </>;
}
const s=StyleSheet.create({summary:{gap:5},section:{gap:10,paddingVertical:8},heading:{fontSize:17,fontWeight:'600',color:C.text},body:{fontSize:14,lineHeight:23,color:C.text,flexShrink:1},note:{fontSize:12,lineHeight:20,color:C.muted,flexShrink:1},warning:{fontSize:12,lineHeight:20,color:C.accent},row:{flexDirection:'row',backgroundColor:C.surface,borderRadius:12},pillar:{width:'25%',paddingVertical:14,paddingHorizontal:5,alignItems:'center',gap:7},gan:{fontSize:25,fontWeight:'600',color:C.text},detail:{gap:4,paddingVertical:6},label:{fontSize:14,lineHeight:23,fontWeight:'600',color:C.text},annual:{flexDirection:'row',justifyContent:'space-between',paddingVertical:7,borderBottomWidth:1,borderColor:C.line}});
