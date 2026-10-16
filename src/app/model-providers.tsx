import { Image, Pressable, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Button, C, Screen } from '../ui/kit';
export default function ModelProviders(){
 return <Screen title="大模型配置" action={<Button title="返回" secondary onPress={()=>router.back()}/>}>
  <Pressable accessibilityRole="button" accessibilityLabel="DeepSeek 配置" onPress={()=>router.push('/deepseek-settings')} style={({pressed})=>({flexDirection:'row',alignItems:'center',gap:12,minHeight:72,padding:14,borderRadius:14,backgroundColor:C.surface,borderWidth:1,borderColor:C.line,opacity:pressed?.65:1})}>
   <Image source={require('../../assets/providers/deepseek.png')} style={{width:34,height:34}} resizeMode="contain"/>
   <Text style={{flex:1,fontSize:16,fontWeight:'600',color:C.text}}>DeepSeek</Text><Feather name="chevron-right" size={19} color={C.muted}/>
  </Pressable>
 </Screen>;
}
