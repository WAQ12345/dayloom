import { Tabs } from 'expo-router/js-tabs';
import { Feather } from '@expo/vector-icons';
import { Easing } from 'react-native';
import { useReducedMotion } from '../../ui/motion';
import { C } from '../../ui/kit';
const icons={index:'coffee',plans:'check-square',items:'grid',ai:'message-circle',preferences:'settings'} as const;
export default function Layout(){const reduced=useReducedMotion();return <Tabs screenOptions={{headerShown:false,tabBarShowLabel:false,animation:reduced?'none':'shift',transitionSpec:{animation:'timing',config:{duration:200,easing:Easing.out(Easing.cubic)}},tabBarActiveTintColor:C.accent,tabBarInactiveTintColor:C.muted,tabBarStyle:{backgroundColor:C.surface,borderTopColor:C.line},tabBarIconStyle:{flex:1},tabBarLabelStyle:{fontSize:12}}}>{Object.entries({index:'饮食',plans:'计划',items:'生活',ai:'AI 分析',preferences:'设置'}).map(([name,title])=><Tabs.Screen key={name} name={name} options={{title,tabBarAccessibilityLabel:title,tabBarIcon:({color,size})=><Feather name={icons[name as keyof typeof icons]} color={color} size={size}/>}}/>)}</Tabs>}
