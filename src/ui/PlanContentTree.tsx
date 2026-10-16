import {StyleSheet,Text,View} from 'react-native';
import {C} from './kit';
export function PlanContentTree({value}:{value:string}) {
 const lines=value.split('\n').filter(line=>line.trim());
 return <View>{lines.map((line,i)=><View key={i} style={s.treeRow}>
   <View accessible={false} style={s.treeRail}><View style={[s.treeTrunk,i===lines.length-1&&s.treeLast]}/><View style={s.treeBranch}/><View style={s.treeDot}/></View>
   <Text style={[s.body,{flex:1,paddingVertical:8}]}>{line}</Text>
 </View>)}</View>;
}
const s=StyleSheet.create({body:{color:C.text,fontSize:15,lineHeight:25},treeRow:{flexDirection:'row',alignItems:'stretch'},treeRail:{width:28,position:'relative'},treeTrunk:{position:'absolute',left:6,top:0,bottom:0,width:1,backgroundColor:C.line},treeLast:{bottom:'50%'},treeBranch:{position:'absolute',left:6,top:'50%',width:14,height:1,backgroundColor:C.line},treeDot:{position:'absolute',left:18,top:'50%',marginTop:-2,width:5,height:5,borderRadius:3,backgroundColor:C.accent}});
