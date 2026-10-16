import React, { useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { useReducedMotion } from './motion';

/** Only animates committed snapshots; ordinary local updates stay still. */
export function MotionSection({transitionKey,children,enter=false}:{transitionKey:string;children:React.ReactNode;enter?:boolean}){
 const reduced=useReducedMotion();
 const [opacity]=useState(()=>new Animated.Value(1));
 const [offset]=useState(()=>new Animated.Value(0));
 const previous=useRef(enter?'':transitionKey);
 useLayoutEffect(()=>{
  const old=previous.current;previous.current=transitionKey;
  opacity.stopAnimation();offset.stopAnimation();
  if(reduced||old===transitionKey){opacity.setValue(1);offset.setValue(0);return;}
  opacity.setValue(.45);offset.setValue(transitionKey>old?14:-14);
  const animation=Animated.parallel([
   Animated.timing(opacity,{toValue:1,duration:220,easing:Easing.out(Easing.cubic),useNativeDriver:true}),
   Animated.timing(offset,{toValue:0,duration:260,easing:Easing.out(Easing.cubic),useNativeDriver:true}),
  ]);
  animation.start();return()=>animation.stop();
 },[transitionKey,reduced,opacity,offset]);
 return <Animated.View style={{gap:12,opacity,transform:[{translateX:offset}]}}>{children}</Animated.View>;
}
