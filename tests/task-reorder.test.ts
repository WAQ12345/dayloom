import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testContext } from './helpers/sqlite.ts';
import { createTask, getPlanSettlement, listTasks, reorderTasks, savePlanSettlement, setTaskStatus, updateTask } from '../src/data/taskRepo.ts';
import { addTemplatesToToday, createTemplate } from '../src/data/templateRepo.ts';
import { reorderTaskLevel, taskDragTarget, taskProgress } from '../src/domain/tasks.ts';
const date = '2026-10-12';
const input = { name: '阅读', project: '', note: null, orderLevel: 2 as const };

test('same-level reorder persists exact slots, keeps other levels, status and settlement', async () => {
  const ctx = await testContext();
  try {
    const a = await createTask(ctx, date, input), early = await createTask(ctx, date, { ...input, orderLevel: 1 }), b = await createTask(ctx, date, input), c = await createTask(ctx, date, input);
    await setTaskStatus(ctx, b.id, 'done'); await setTaskStatus(ctx, c.id, 'cancelled');
    const settlement = await savePlanSettlement(ctx, date, '保留总结'), before = await listTasks(ctx.db, date);
    const saved = await reorderTasks(ctx, date, 2, [c.id, a.id, b.id]);
    assert.deepEqual(saved.map(t => t.id), [early.id, c.id, a.id, b.id]);
    assert.deepEqual(saved.filter(t => t.orderLevel === 2).map(t => t.sortOrder), [1, 3, 4]);
    assert.deepEqual(await listTasks(ctx.db, date), saved);
    assert.deepEqual(taskProgress(saved), taskProgress(before));
    assert.deepEqual(await getPlanSettlement(ctx.db, date), settlement);
    await setTaskStatus(ctx, b.id, 'todo');
    assert.deepEqual((await listTasks(ctx.db, date)).map(t => t.id), saved.map(t => t.id));
    await setTaskStatus(ctx, b.id, 'done');
    assert.deepEqual((await listTasks(ctx.db, date)).map(t => t.id), saved.map(t => t.id));
  } finally { ctx.close(); }
});

test('reorder rejects duplicate, missing, unknown, foreign-level IDs and invalid level without writes', async () => {
  const ctx = await testContext();
  try {
    const a = await createTask(ctx, date, input), b = await createTask(ctx, date, input), other = await createTask(ctx, date, { ...input, orderLevel: 1 });
    const before = await listTasks(ctx.db, date);
    for (const ids of [[a.id, a.id], [a.id], [a.id, 'missing'], [a.id, other.id], [b.id, a.id, other.id]]) {
      await assert.rejects(reorderTasks(ctx, date, 2, ids), /列表已变化/);
      assert.deepEqual(await listTasks(ctx.db, date), before);
    }
    await assert.rejects(reorderTasks(ctx, date, 4 as never, [a.id, b.id]), /执行档/);
    await assert.rejects(reorderTasks(ctx, '2026-10-11', 2, [a.id, b.id]), /历史记录只读/);
    await assert.rejects(reorderTasks(ctx, '2026-10-13', 2, [a.id, b.id]), /历史记录只读/);
    ctx.setDate('2026-10-13');
    const foreign = await createTask(ctx, '2026-10-13', input); ctx.setDate(date);
    await assert.rejects(reorderTasks(ctx, date, 2, [a.id, foreign.id]), /列表已变化/);
    assert.deepEqual(await listTasks(ctx.db, date), before);
  } finally { ctx.close(); }
});

test('reorder rolls back all writes on SQL failure and midnight after the first write', async () => {
  for (const failure of ['sql', 'midnight'] as const) {
    const ctx = await testContext();
    try {
      const a = await createTask(ctx, date, input), b = await createTask(ctx, date, input), before = await listTasks(ctx.db, date);
      const original = ctx.db.transaction.bind(ctx.db);
      ctx.db.transaction = fn => original(tx => fn({ ...tx, run: async (sql, params) => {
        const result = await tx.run(sql, params);
        if (sql.startsWith('UPDATE tasks SET sort_order')) {
          if (failure === 'sql') throw new Error('write fault');
          ctx.setDate('2026-10-13');
        }
        return result;
      } }));
      await assert.rejects(reorderTasks(ctx, date, 2, [b.id, a.id]), failure === 'sql' ? /write fault/ : /历史记录只读/);
      assert.deepEqual(await listTasks(ctx.db, date), before);
    } finally { ctx.close(); }
  }
});

test('midnight while waiting for a transaction rejects before reorder writes', async () => {
  const ctx = await testContext();
  try {
    const a = await createTask(ctx, date, input), b = await createTask(ctx, date, input), before = await listTasks(ctx.db, date);
    const original = ctx.db.transaction.bind(ctx.db);
    ctx.db.transaction = fn => { ctx.setDate('2026-10-13'); return original(fn); };
    await assert.rejects(reorderTasks(ctx, date, 2, [b.id, a.id]), /历史记录只读/);
    assert.deepEqual(await listTasks(ctx.db, date), before);
  } finally { ctx.close(); }
});

test('create, template add and changed level append to destination tail; same-level edit keeps position', async () => {
  const ctx = await testContext();
  try {
    const a = await createTask(ctx, date, input), b = await createTask(ctx, date, input), other = await createTask(ctx, date, { ...input, orderLevel: 1 });
    await reorderTasks(ctx, date, 2, [b.id, a.id]);
    await updateTask(ctx, b.id, { ...input, name: '修改名称' });
    const c = await createTask(ctx, date, input), template = await createTemplate(ctx, { name: '模板', note: '', orderLevel: 2 });
    const [added] = await addTemplatesToToday(ctx, [template.id], date);
    await updateTask(ctx, other.id, input);
    assert.deepEqual((await listTasks(ctx.db, date)).map(t => t.id), [b.id, a.id, c.id, added.id, other.id]);
    const tasks = await listTasks(ctx.db, date);
    assert.equal(new Set(tasks.map(t => t.sortOrder)).size, tasks.length);
  } finally { ctx.close(); }
});

test('variable-height drag chooses only crossed midpoints; reorder preview is immutable', () => {
  const frames = new Map([['a', { y: 0, height: 56 }], ['b', { y: 56, height: 104 }], ['c', { y: 160, height: 56 }]]);
  const ids = ['a', 'b', 'c'];
  assert.equal(taskDragTarget(ids, frames, 'a', 79), 0);
  assert.equal(taskDragTarget(ids, frames, 'a', 81), 1);
  assert.equal(taskDragTarget(ids, frames, 'a', 200), 2);
  assert.equal(taskDragTarget(ids, frames, 'c', -81), 1);
  assert.equal(taskDragTarget(ids, frames, 'c', -200), 0);
  assert.equal(taskDragTarget(ids, new Map(), 'a', 200), 0);
  const tasks = ids.map((id, i) => ({ id, sortOrder: i + 1, orderLevel: 2 as const, createdAt: i }));
  assert.deepEqual(reorderTaskLevel(tasks, 2, ['c', 'a', 'b']).map(t => t.id), ['c', 'a', 'b']);
  assert.deepEqual(tasks.map(t => t.id), ids);
});
