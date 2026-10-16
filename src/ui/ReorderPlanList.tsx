import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, BackHandler, Keyboard, PanResponder, StyleSheet, View, type ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Task } from '../domain/types';
import { taskDragTarget, type TaskRowFrame } from '../domain/tasks';
import { C } from './kit';
import { useReducedMotion } from './motion';
import type { SwipeRowAction } from './SwipeTaskRow';

export type PlanScrollMetrics = { top: number; height: number; offset: number; contentHeight: number };
type RowControls = { onLongPress?: (pageY: number) => void; reorderActions: SwipeRowAction[]; dragging: boolean };
type Drag = { task: Task; ids: string[]; source: number; target: number; height: number; startY: number; pointerY: number; startScroll: number; delta: number; tasks: Task[] };
type Props = {
  tasks: Task[]; disabled: boolean; scrollRef: React.RefObject<ScrollView | null>;
  scrollMetrics: React.RefObject<PlanScrollMetrics>; onDragging: (active: boolean) => void;
  onReorder: (level: Task['orderLevel'], ids: string[]) => void;
  renderRow: (task: Task, controls: RowControls) => React.ReactNode;
};

/** Keep native scroll ownership until a long press; measured rows support wrapped names. */
export function ReorderPlanList(props: Props) {
  const { tasks, disabled, renderRow } = props;
  const current = useRef(props);
  useEffect(() => { current.current = props; });
  const frames = useRef(new Map<string, TaskRowFrame>());
  const active = useRef<Drag | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [preview, setPreview] = useState<Drag | null>(null);
  const [translation] = useState(() => new Animated.Value(0));
  const reduced = useReducedMotion();

  const finish = useRef((commit: boolean) => {
    const drag = active.current;
    if (!drag) return;
    active.current = null;
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    translation.setValue(0); setPreview(null); current.current.onDragging(false);
    if (commit && !current.current.disabled && drag.tasks === current.current.tasks && drag.target !== drag.source) {
      const ids = [...drag.ids]; ids.splice(drag.source, 1); ids.splice(drag.target, 0, drag.task.id);
      current.current.onReorder(drag.task.orderLevel, ids);
    }
  });
  const move = useRef((pageY: number) => {
    const drag = active.current;
    if (!drag) return;
    drag.pointerY = pageY;
    const frame = frames.current.get(drag.task.id), first = frames.current.get(drag.ids[0]), last = frames.current.get(drag.ids[drag.ids.length - 1]);
    if (!frame || !first || !last) return;
    const raw = pageY - drag.startY + current.current.scrollMetrics.current.offset - drag.startScroll;
    const center = frame.y + frame.height / 2;
    drag.delta = Math.max(first.y + first.height / 2 - center, Math.min(last.y + last.height / 2 - center, raw));
    translation.setValue(drag.delta);
    const target = taskDragTarget(drag.ids, frames.current, drag.task.id, drag.delta);
    if (target !== drag.target) { drag.target = target; setPreview({ ...drag }); }
  });
  useEffect(() => {
    if (disabled || (active.current && active.current.tasks !== tasks)) finish.current(false);
  }, [disabled, tasks]);
  useFocusEffect(useCallback(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { if (!active.current) return false; finish.current(false); return true; });
    return () => { back.remove(); finish.current(false); };
  }, []));
  useEffect(() => {
    const app = AppState.addEventListener('change', state => { if (state !== 'active') finish.current(false); });
    const keyboard = Keyboard.addListener('keyboardDidShow', () => finish.current(false));
    return () => { app.remove(); keyboard.remove(); };
  }, []);
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    if (active.current) current.current.onDragging(false);
    active.current = null;
  }, []);
  // Gesture callbacks read current props only when native events arrive.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: () => !!active.current,
    onPanResponderGrant: event => move.current(event.nativeEvent.pageY),
    onPanResponderMove: (_, gesture) => move.current(gesture.moveY),
    onPanResponderRelease: () => finish.current(true),
    onPanResponderTerminate: () => finish.current(false),
    onPanResponderTerminationRequest: () => !active.current,
  }));

  const begin = (task: Task, pageY: number) => {
    if (current.current.disabled || active.current) return;
    const ids = tasks.filter(t => t.orderLevel === task.orderLevel).map(t => t.id);
    if (ids.length < 2 || ids.some(id => !frames.current.has(id))) return;
    const drag: Drag = { task, ids, source: ids.indexOf(task.id), target: ids.indexOf(task.id), height: frames.current.get(task.id)!.height, startY: pageY, pointerY: pageY, startScroll: current.current.scrollMetrics.current.offset, delta: 0, tasks };
    active.current = drag; setPreview({ ...drag }); current.current.onDragging(true);
    timer.current = setInterval(() => {
      const value = active.current;
      if (!value) return;
      const metrics = current.current.scrollMetrics.current;
      if (metrics.height <= 0) return;
      const edge = 64;
      const distance = value.pointerY < metrics.top + edge ? value.pointerY - metrics.top - edge : value.pointerY > metrics.top + metrics.height - edge ? value.pointerY - metrics.top - metrics.height + edge : 0;
      const step = Math.max(-12, Math.min(12, distance / 5));
      if ((step < 0 && value.target === 0) || (step > 0 && value.target === value.ids.length - 1)) return;
      const next = Math.max(0, Math.min(Math.max(0, metrics.contentHeight - metrics.height), metrics.offset + step));
      if (step && next !== metrics.offset) {
        metrics.offset = next; current.current.scrollRef.current?.scrollTo({ y: next, animated: false }); move.current(value.pointerY);
      }
    }, 20);
  };
  return <View {...responder.panHandlers} onTouchEnd={() => finish.current(true)} onTouchCancel={() => finish.current(false)}>
    {/* renderRow receives callbacks for native events; it never invokes them during rendering. */}
    {/* eslint-disable-next-line react-hooks/refs */}
    {tasks.map(task => {
      const group = tasks.filter(t => t.orderLevel === task.orderLevel), index = group.findIndex(t => t.id === task.id);
      const moveOne = (delta: number) => { if (disabled || active.current) return; const ids = group.map(t => t.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; current.current.onReorder(task.orderLevel, ids); };
      const reorderActions = disabled ? [] : [
        ...(index > 0 ? [{ key: 'moveUp', label: '同档上移', onPress: () => moveOne(-1) }] : []),
        ...(index < group.length - 1 ? [{ key: 'moveDown', label: '同档下移', onPress: () => moveOne(1) }] : []),
      ];
      const dragged = preview?.task.id === task.id;
      let shift = 0;
      if (preview && !dragged && preview.ids.includes(task.id)) {
        const i = preview.ids.indexOf(task.id), height = preview.height;
        if (preview.target > preview.source && i > preview.source && i <= preview.target) shift = -height;
        if (preview.target < preview.source && i >= preview.target && i < preview.source) shift = height;
      }
      return <View key={task.id} onLayout={event => { const { y, height } = event.nativeEvent.layout; frames.current.set(task.id, { y, height }); }} style={dragged ? s.raised : undefined}>
        <PlanDragFrame shift={shift} translation={dragged ? translation : undefined} reduced={reduced} active={dragged}>
          {renderRow(task, { onLongPress: !disabled && group.length > 1 ? y => begin(task, y) : undefined, reorderActions, dragging: !!preview })}
        </PlanDragFrame>
      </View>;
    })}
  </View>;
}
function PlanDragFrame({ children, shift, translation, reduced, active }: { children: React.ReactNode; shift: number; translation?: Animated.Value; reduced: boolean; active: boolean }) {
  const [offset] = useState(() => new Animated.Value(0));
  useEffect(() => { Animated.timing(offset, { toValue: shift, duration: reduced ? 0 : 100, useNativeDriver: true }).start(); return () => offset.stopAnimation(); }, [offset, shift, reduced]);
  return <Animated.View style={[active && s.active, { transform: [{ translateY: translation ?? offset }] }]}>{children}</Animated.View>;
}
const s = StyleSheet.create({ raised: { zIndex: 2, elevation: 3 }, active: { backgroundColor: C.surface, opacity: .9 } });
