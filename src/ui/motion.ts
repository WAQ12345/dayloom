import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, LayoutAnimation } from 'react-native';
export function useReducedMotion(){const [reduced,setReduced]=useState(true);useEffect(()=>{let active=true;void AccessibilityInfo.isReduceMotionEnabled().then(v=>{if(active)setReduced(v)}).catch(()=>{if(active)setReduced(true)});const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);return()=>{active=false;sub.remove()}},[]);return reduced;}

// Apply one short layout transition only after the complete date snapshot is ready.
export function useDateTransition() {
 const reduced = useReducedMotion();
 return useCallback(() => {
  if (!reduced) LayoutAnimation.configureNext({duration:180,update:{type:'easeInEaseOut'},create:{type:'easeInEaseOut',property:'opacity'},delete:{type:'easeInEaseOut',property:'opacity'}});
 }, [reduced]);
}
