import { router } from 'expo-router';
import { Button, Screen } from '../ui/kit';
import ModelSettings from '../features/ModelSettings';
export default function DeepSeekSettings(){return <Screen title="DeepSeek 配置" action={<Button title="返回" secondary onPress={()=>router.back()}/>}><ModelSettings/></Screen>;}
