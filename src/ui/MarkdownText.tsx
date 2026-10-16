import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { C } from './kit';
/** Small native Markdown renderer. Text only: never executes HTML, links, or remote images. */
function inline(text:string):React.ReactNode[]{return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part,i)=>part.startsWith('**')?<Text key={i} style={{fontWeight:'600'}}>{part.slice(2,-2)}</Text>:part.startsWith('`')?<Text key={i} style={{backgroundColor:C.apricot}}>{part.slice(1,-1)}</Text>:part);}
export function MarkdownText({text}:{text:string}){
 const lines=text.replace(/\r\n/g,'\n').split('\n');const blocks:React.ReactNode[]=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(!line.trim())continue;
  if(line.trim().startsWith('|')){const rows:string[][]=[];while(i<lines.length&&lines[i].trim().startsWith('|')){const row=lines[i].trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());if(!row.every(c=>/^:?-+:?$/.test(c)))rows.push(row);i++;}i--;blocks.push(<ScrollView horizontal key={i} style={{flexGrow:0}}><View>{rows.map((row,r)=><View key={r} style={{flexDirection:'row',backgroundColor:r===0?C.apricot:C.surface}}>{row.map((cell,c)=><Text selectable key={c} style={[s.cell,r===0&&{fontWeight:'600'}]}>{inline(cell)}</Text>)}</View>)}</View></ScrollView>);continue;}
  if(/^```/.test(line)){const code:string[]=[];while(++i<lines.length&&!/^```/.test(lines[i]))code.push(lines[i]);blocks.push(<Text selectable key={i} style={[s.body,{backgroundColor:C.apricot,padding:10}]}>{code.join('\n')}</Text>);continue;}
  const heading=/^(#{1,6})\s+(.+)$/.exec(line);const bullet=/^\s*[-*+]\s+/.test(line);
  blocks.push(<Text selectable key={i} accessibilityRole={heading?'header':undefined} style={heading?s.heading:s.body}>{inline(heading?heading[2]:bullet?line.replace(/^\s*[-*+]\s+/,'• '):line)}</Text>);
 }
 return <View style={{gap:8}}>{blocks}</View>;
}
const s=StyleSheet.create({body:{fontSize:14,lineHeight:23,color:C.text},heading:{fontSize:17,lineHeight:26,fontWeight:'600',color:C.text,marginTop:8},cell:{width:130,padding:8,borderWidth:.5,borderColor:C.line,fontSize:13,lineHeight:21,color:C.text}});
