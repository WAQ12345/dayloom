import { Feather } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { C } from './kit';
import { useReducedMotion } from './motion';

export type SwipeRowAction = { key: string; label: string; onPress: () => void; destructive?: boolean; icon?: React.ComponentProps<typeof Feather>['name'] };
/** Controlled ownership keeps at most one row open in the containing list. */
export function SwipeTaskRow({ children, label, open, onOpenChange, onPress, actions, disabled = false, onLongPress, reorderActions = [] }: {
  children: React.ReactNode; label: string; open: boolean; onOpenChange: (open: boolean) => void;
  onPress: () => void; actions: SwipeRowAction[]; disabled?: boolean;
  onLongPress?: (pageY: number) => void; reorderActions?: SwipeRowAction[];
}) {
  const width = actions.length * 48;
  const reduced = useReducedMotion();
  const [offset] = useState(() => new Animated.Value(0));
  const current = useRef({ open, disabled, width, onOpenChange, reduced });
  useEffect(() => { current.current = { open, disabled, width, onOpenChange, reduced }; }, [open, disabled, width, onOpenChange, reduced]);
  const start = useRef(0);
  const dragged = useRef(false);
  const dragging = useRef(false);
  useEffect(() => {
    if (dragging.current && open && !disabled) return;
    dragging.current = false;
    Animated.timing(offset, { toValue: open && !disabled ? -width : 0, duration: reduced ? 0 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => offset.stopAnimation();
  }, [offset, open, disabled, width, reduced]);
  // PanResponder stores these callbacks; refs are read only when native gesture events arrive.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => {
      if (Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx) && current.current.open) current.current.onOpenChange(false);
      return !current.current.disabled && current.current.width > 0 && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8 && (g.dx < 0 || current.current.open);
    },
    onPanResponderGrant: () => { dragged.current = true; dragging.current = true; offset.stopAnimation(value => { start.current = value; }); current.current.onOpenChange(true); },
    onPanResponderMove: (_, g) => offset.setValue(Math.max(-current.current.width, Math.min(0, start.current + g.dx))),
    onPanResponderRelease: (_, g) => {
      dragging.current = false;
      const next = g.vx < -.5 || (g.vx <= .5 && start.current + g.dx < -current.current.width * .35);
      current.current.onOpenChange(next);
      Animated.timing(offset, { toValue: next ? -current.current.width : 0, duration: current.current.reduced ? 0 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    },
    onPanResponderTerminate: () => { dragging.current = false; current.current.onOpenChange(false); Animated.timing(offset, { toValue: 0, duration: current.current.reduced ? 0 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(); },
    onPanResponderTerminationRequest: () => true,
  }));
  return <View style={s.clip}>
    <View style={s.content} {...responder.panHandlers}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={onLongPress ? '长按后在同档内拖动排序，左滑显示操作，也可使用无障碍操作菜单' : actions.length ? '左滑显示操作，也可使用无障碍操作菜单' : '查看详情'}
        accessibilityActions={[{name:'activate',label:'查看详情'}, ...(!disabled ? [...actions,...reorderActions].map(a=>({name:a.key,label:a.label})) : [])]}
        onAccessibilityAction={event => { const key=event.nativeEvent.actionName; if(key==='activate')onPress();else if(!disabled){onOpenChange(false);[...actions,...reorderActions].find(a=>a.key===key)?.onPress();} }}
        delayLongPress={400} onLongPress={onLongPress&&!disabled?event=>{dragged.current=true;onOpenChange(false);onLongPress(event.nativeEvent.pageY);}:undefined}
        onPressIn={() => { dragged.current = false; }} onPress={() => { if(dragged.current)return; if(open)onOpenChange(false);else onPress(); }} style={s.body}>{children}</Pressable>
    </View>
    <Animated.View style={[s.actions, { width: width > 0 ? offset.interpolate({ inputRange: [-width, 0], outputRange: [width, 0], extrapolate: 'clamp' }) : 0, opacity: width > 8 ? offset.interpolate({ inputRange: [-width, -8, 0], outputRange: [1, 0, 0], extrapolate: 'clamp' }) : 0 }]} pointerEvents={open && !disabled ? 'auto' : 'none'} accessibilityElementsHidden={!open || disabled} importantForAccessibility={open && !disabled ? 'auto' : 'no-hide-descendants'}>
      <View style={[s.actionButtons, {width}]}>{actions.map(action => <Pressable key={action.key} accessibilityRole="button" accessibilityLabel={`${action.label}：${label}`} disabled={disabled} style={s.action} onPress={() => { onOpenChange(false); action.onPress(); }}><Feather name={action.icon ?? (action.destructive ? 'trash-2' : action.key==='edit' ? 'edit-2' : 'check')} size={19} color={action.destructive ? C.accent : C.muted}/></Pressable>)}</View>
    </Animated.View>
  </View>;
}
const s=StyleSheet.create({clip:{flexDirection:'row',alignItems:'stretch',overflow:'hidden',borderBottomWidth:1,borderColor:C.line},content:{flex:1,minWidth:0},actions:{overflow:'hidden',flexShrink:0,justifyContent:'center'},actionButtons:{flexDirection:'row',alignItems:'center'},action:{width:48,minHeight:48,alignItems:'center',justifyContent:'center'},body:{minHeight:56,justifyContent:'center',paddingVertical:12,paddingHorizontal:4,backgroundColor:C.bg}});
