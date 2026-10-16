import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { C } from '../ui/kit';
/** One shared row for the life section navigator and the active section's add action. */
export default function LifeHeader({navigation,addLabel,onAdd,disabled=false}:{navigation:React.ReactNode;addLabel:string;onAdd:()=>void;disabled?:boolean}){
 return <View style={headerStyles.row}><View style={headerStyles.navigation}>{navigation}</View><Pressable accessibilityRole="button" accessibilityLabel={addLabel} accessibilityState={{disabled}} disabled={disabled} onPress={onAdd} style={({pressed})=>[headerStyles.add,{opacity:disabled?.45:pressed?.65:1}]}><Feather name="plus" size={22} color={C.accent}/></Pressable></View>;
}
const headerStyles=StyleSheet.create({row:{flexDirection:'row',alignItems:'center',gap:8,minHeight:48},navigation:{flex:1,minWidth:0},add:{width:48,height:48,borderRadius:12,borderWidth:1,borderColor:C.line,backgroundColor:C.surface,alignItems:'center',justifyContent:'center'}});
