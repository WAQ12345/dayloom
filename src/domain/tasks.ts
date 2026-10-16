import type { Task, TaskStatus } from './types.ts';

type Ordered = Pick<Task, 'id' | 'sortOrder' | 'createdAt'> & Partial<Pick<Task, 'orderLevel'>>;

export function sortTasks<T extends Ordered>(tasks: readonly T[]): T[] {
  return [...tasks].sort((a, b) => (a.orderLevel ?? 2) - (b.orderLevel ?? 2) || a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/**
 * Inserts (or moves) a task at the requested 1-based execution order and renumbers
 * all tasks of the day to 1..n. Returns the new order per id.
 */
export function placeTask(dayTasks: readonly Ordered[], taskId: string, desiredOrder: number): Map<string, number> {
  const others = sortTasks(dayTasks.filter((t) => t.id !== taskId));
  const index = Math.max(0, Math.min(Math.floor(desiredOrder) - 1, others.length));
  const ids = others.map((t) => t.id);
  ids.splice(index, 0, taskId);
  return new Map(ids.map((id, i) => [id, i + 1]));
}

/** Renumber after deletion so execution order stays contiguous. */
export function compactOrder(dayTasks: readonly Ordered[]): Map<string, number> {
  return new Map(sortTasks(dayTasks).map((t, i) => [t.id, i + 1]));
}

export function nextOrder(dayTasks: readonly Ordered[]): number {
  return dayTasks.reduce((n, t) => Math.max(n, t.sortOrder), 0) + 1;
}

/** A reorder replaces one complete level; other levels retain their original slots. */
export function reorderTaskLevel<T extends Ordered>(tasks: readonly T[], level: number, ids: readonly string[]): T[] {
  if (![1, 2, 3].includes(level)) throw new Error('无效的执行档');
  const group = sortTasks(tasks.filter(t => (t.orderLevel ?? 2) === level));
  if (ids.length !== group.length || new Set(ids).size !== ids.length || ids.some(id => !group.some(t => t.id === id))) {
    throw new Error('计划列表已变化，请刷新后重新排序');
  }
  const slots = group.map(t => t.sortOrder);
  const order = new Map(ids.map((id, index) => [id, slots[index]]));
  return sortTasks(tasks.map(t => order.has(t.id) ? { ...t, sortOrder: order.get(t.id)! } : t));
}

export type TaskRowFrame = { y: number; height: number };
/** Measure each row rather than assuming a single-line task name. */
export function taskDragTarget(ids: readonly string[], frames: ReadonlyMap<string, TaskRowFrame>, activeId: string, delta: number): number {
  const source = ids.indexOf(activeId), active = frames.get(activeId);
  if (source < 0 || !active) return source;
  const center = active.y + active.height / 2 + delta;
  let target = source;
  if (delta > 0) {
    for (let i = source + 1; i < ids.length; i++) { const row = frames.get(ids[i]); if (row && center >= row.y + row.height / 2) target = i; }
  } else {
    for (let i = source - 1; i >= 0; i--) { const row = frames.get(ids[i]); if (row && center <= row.y + row.height / 2) target = i; }
  }
  return target;
}

export function toggleDone(status: TaskStatus): TaskStatus {
  return status === 'done' ? 'todo' : 'done';
}

export function taskProgress(tasks: readonly Pick<Task, 'status'>[]) {
  const active = tasks.filter((t) => t.status !== 'cancelled');
  const done = active.filter((t) => t.status === 'done').length;
  return { done, active: active.length, cancelled: tasks.length - active.length, ratio: active.length ? done / active.length : 0 };
}

export type PlanFilter = 'all' | TaskStatus;
export function filterTasks<T extends Pick<Task, 'status' | 'date'>>(tasks: readonly T[], filter: PlanFilter, day: string | null): T[] {
  return tasks.filter((t) => (!day || t.date === day) && (filter === 'all' || t.status === filter));
}
