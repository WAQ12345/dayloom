import { useEffect } from 'react';
import { cleanOldExports } from '../services/export/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProvider } from '../ui/context';
import { ConfirmProvider } from '../ui/confirm';
import { useReducedMotion } from '../ui/motion';
export default function Layout(){useEffect(()=>{try{cleanOldExports();}catch{/* Cache cleanup must not block startup. */}},[]);const reduced=useReducedMotion();return <AppProvider><ConfirmProvider><StatusBar style="dark"/><Stack screenOptions={{headerShown:false,animation:reduced?'none':'fade_from_bottom',animationDuration:220}}/></ConfirmProvider></AppProvider>}
