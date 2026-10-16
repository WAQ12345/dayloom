import { assertToday, todayOf, type DateString } from '../domain/dates.ts';
import { dailyEnergy, settlementConfirmable, type EnergyData } from '../domain/energy.ts';
import type { DayEnergy, FoodFavorite, FoodSettlement, Meal, MealType } from '../domain/types.ts';
import { validateMeal, type ValidMeal } from '../domain/validation.ts';
import { getSetting } from './settingsRepo.ts';
import { newId, type DataContext, type SqlExecutor } from './sql.ts';

type MealRow = {
  id: string; date: string; meal_type: MealType; name: string; kcal: number; time: string | null;
  note: string | null; photo: string | null; created_at: number; updated_at: number;
};
type SettlementRow = { date: string; confirmed: number; stale: number; intake: number | null; total: number | null; note: string | null; settled_at: number };
type DayRow = { date: string; metabolism: number | null; expenditure: number | null; updated_at: number };

const MEAL_ORDER = "CASE meal_type WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END";

export const toMeal = (r: MealRow): Meal => ({
  id: r.id, date: r.date, mealType: r.meal_type, name: r.name, kcal: r.kcal, time: r.time,
  note: r.note, photo: r.photo, createdAt: r.created_at, updatedAt: r.updated_at,
});
const toSettlement = (r: SettlementRow): FoodSettlement => ({
  date: r.date, confirmed: !!r.confirmed, stale: !!r.stale, intake: r.intake, total: r.total, note: r.note, settledAt: r.settled_at,
});
const toDay = (r: DayRow): DayEnergy => ({ date: r.date, metabolism: r.metabolism, expenditure: r.expenditure, updatedAt: r.updated_at });

export async function listMeals(db: SqlExecutor, date: DateString): Promise<Meal[]> {
  const rows = await db.all<MealRow>(`SELECT * FROM meals WHERE date=? ORDER BY ${MEAL_ORDER}, COALESCE(time,'99:99'), created_at`, [date]);
  return rows.map(toMeal);
}

export async function listMealsInRange(db: SqlExecutor, from: DateString, to: DateString): Promise<Meal[]> {
  const rows = await db.all<MealRow>(`SELECT * FROM meals WHERE date BETWEEN ? AND ? ORDER BY date, ${MEAL_ORDER}, COALESCE(time,'99:99'), created_at`, [from, to]);
  return rows.map(toMeal);
}

export async function getMeal(db: SqlExecutor, id: string): Promise<Meal | null> {
  const row = await db.first<MealRow>('SELECT * FROM meals WHERE id=?', [id]);
  return row ? toMeal(row) : null;
}

/** Most recent distinct (name, kcal) meals from history, for "copy to today". */
export async function listRecentMeals(db: SqlExecutor, limit = 30): Promise<Meal[]> {
  const rows = await db.all<MealRow>(
    `SELECT m.* FROM meals m JOIN (SELECT name, kcal, MAX(created_at) AS c FROM meals GROUP BY name, kcal) g
     ON m.name=g.name AND m.kcal=g.kcal AND m.created_at=g.c ORDER BY m.created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(toMeal);
}

export async function getDayEnergy(db: SqlExecutor, date: DateString): Promise<DayEnergy | null> {
  const row = await db.first<DayRow>('SELECT * FROM day_energy WHERE date=?', [date]);
  return row ? toDay(row) : null;
}

export async function getFoodSettlement(db: SqlExecutor, date: DateString): Promise<FoodSettlement | null> {
  const row = await db.first<SettlementRow>('SELECT * FROM food_settlements WHERE date=?', [date]);
  return row ? toSettlement(row) : null;
}

export async function listFoodSettlements(db: SqlExecutor): Promise<FoodSettlement[]> {
  return (await db.all<SettlementRow>('SELECT * FROM food_settlements ORDER BY date DESC')).map(toSettlement);
}

async function currentMetabolism(db: SqlExecutor): Promise<number | null> {
  return (await getSetting(db, 'profile'))?.metabolism ?? null;
}

/** Freezes today's metabolism snapshot (only ever called for today). */
async function snapshotDay(tx: SqlExecutor, date: DateString, now: number): Promise<void> {
  const metabolism = await currentMetabolism(tx);
  await tx.run(
    `INSERT INTO day_energy(date,metabolism,expenditure,updated_at) VALUES(?,?,NULL,?)
     ON CONFLICT(date) DO UPDATE SET metabolism=excluded.metabolism, updated_at=excluded.updated_at`,
    [date, metabolism, now],
  );
}

async function invalidateFood(tx: SqlExecutor, date: DateString): Promise<void> {
  await tx.run('UPDATE food_settlements SET stale=1 WHERE date=?', [date]);
}

/** Loads everything needed for daily/monthly energy computation in a date range. */
export async function loadEnergyData(db: SqlExecutor, from: DateString, to: DateString): Promise<EnergyData> {
  const meals = await db.all<{ date: string; kcal: number }>('SELECT date, kcal FROM meals WHERE date BETWEEN ? AND ?', [from, to]);
  const days = await db.all<DayRow>('SELECT * FROM day_energy WHERE date BETWEEN ? AND ?', [from, to]);
  const settlements = await db.all<SettlementRow>('SELECT * FROM food_settlements WHERE date BETWEEN ? AND ?', [from, to]);
  return {
    meals,
    days: Object.fromEntries(days.map((d) => [d.date, { metabolism: d.metabolism, expenditure: d.expenditure }])),
    settlements: Object.fromEntries(settlements.map((s) => [s.date, { confirmed: !!s.confirmed, stale: !!s.stale }])),
    currentMetabolism: await currentMetabolism(db),
  };
}

export type PhotoChange = { kind: 'keep' } | { kind: 'remove' } | { kind: 'replace'; uri: string };

export async function createMeal(ctx: DataContext, date: DateString, input: ValidMeal, photoUri: string | null): Promise<Meal> {
  const today = date;
  assertToday(today, todayOf(ctx.clock));
  input = checkedMeal(input);
  const photo = photoUri ? await ctx.photos.importFromUri(photoUri) : null;
  const now = ctx.clock.now().getTime();
  const meal: Meal = { id: newId('meal'), date: today, ...input, photo, createdAt: now, updatedAt: now };
  try {
    await ctx.db.transaction(async (tx) => {
      // Re-check inside the write path: the day may have rolled over while the photo was copied.
      assertToday(meal.date, todayOf(ctx.clock));
      await tx.run(
        'INSERT INTO meals(id,date,meal_type,name,kcal,time,note,photo,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        [meal.id, meal.date, meal.mealType, meal.name, meal.kcal, meal.time, meal.note, meal.photo, now, now],
      );
      await snapshotDay(tx, meal.date, now);
      await invalidateFood(tx, meal.date);
      assertToday(meal.date, todayOf(ctx.clock));
    });
  } catch (e) {
    if (photo) { try { ctx.photos.remove(photo); } catch { /* preserve original error */ } }
    throw e;
  }
  return meal;
}

export async function updateMeal(ctx: DataContext, id: string, input: ValidMeal, change: PhotoChange): Promise<Meal> {
  input = checkedMeal(input);
  const old = await getMeal(ctx.db, id);
  if (!old) throw new Error('这条饮食记录已不存在');
  assertToday(old.date, todayOf(ctx.clock));
  const imported = change.kind === 'replace' ? await ctx.photos.importFromUri(change.uri) : null;
  const photo = change.kind === 'keep' ? old.photo : imported;
  const now = ctx.clock.now().getTime();
  try {
    await ctx.db.transaction(async (tx) => {
      assertToday(old.date, todayOf(ctx.clock));
      const current = await getMeal(tx, id);
      if (!current || current.date !== old.date) throw new Error('这条饮食记录已变更，请重新打开');
      await tx.run('UPDATE meals SET meal_type=?,name=?,kcal=?,time=?,note=?,photo=?,updated_at=? WHERE id=?', [
        input.mealType, input.name, input.kcal, input.time, input.note, photo, now, id,
      ]);
      await snapshotDay(tx, old.date, now);
      await invalidateFood(tx, old.date);
      assertToday(old.date, todayOf(ctx.clock));
    });
  } catch (e) {
    if (imported) { try { ctx.photos.remove(imported); } catch { /* preserve original error */ } }
    throw e;
  }
  // Retain previous blob: another record or a recovery snapshot may reference it.
  return { ...old, ...input, photo, updatedAt: now };
}

export async function deleteMeal(ctx: DataContext, id: string): Promise<void> {
  const old = await getMeal(ctx.db, id);
  if (!old) return;
  assertToday(old.date, todayOf(ctx.clock));
  const now = ctx.clock.now().getTime();
  await ctx.db.transaction(async (tx) => {
    assertToday(old.date, todayOf(ctx.clock));
    await tx.run('DELETE FROM meals WHERE id=?', [id]);
    await snapshotDay(tx, old.date, now);
    await invalidateFood(tx, old.date);
    assertToday(old.date, todayOf(ctx.clock));
  });
  // Unreferenced photos are excluded from backups; avoid destructive eager cleanup.
}

export async function setExpenditure(ctx: DataContext, date: DateString, expenditure: number | null): Promise<void> {
  assertToday(date, todayOf(ctx.clock));
  if (expenditure !== null && (!Number.isFinite(expenditure) || expenditure < 0 || expenditure > 100000)) throw new Error('活动消耗需为0—100000 kcal');
  const now = ctx.clock.now().getTime();
  await ctx.db.transaction(async (tx) => {
    assertToday(date, todayOf(ctx.clock));
    await snapshotDay(tx, date, now);
    await tx.run('UPDATE day_energy SET expenditure=?, updated_at=? WHERE date=?', [expenditure, now, date]);
    await invalidateFood(tx, date);
    assertToday(date, todayOf(ctx.clock));
  });
}

/** Called after the profile metabolism changes: refresh today's snapshot only; history stays frozen. */
export async function applyMetabolismToToday(ctx: DataContext, date: DateString, previous: number | null, next: number): Promise<void> {
  const today = date;
  if (!Number.isFinite(next) || next < 1 || next > 10000) throw new Error('基础代谢需1—10000 kcal');
  assertToday(today, todayOf(ctx.clock));
  const now = ctx.clock.now().getTime();
  await ctx.db.transaction(async (tx) => {
    assertToday(today, todayOf(ctx.clock));
    const row = await tx.first<DayRow>('SELECT * FROM day_energy WHERE date=?', [today]);
    const before = row ? row.metabolism : previous;
    if (row) await tx.run('UPDATE day_energy SET metabolism=?, updated_at=? WHERE date=?', [next, now, today]);
    if (before !== next) await invalidateFood(tx, today);
    assertToday(today, todayOf(ctx.clock));
  });
}

export async function saveFoodSettlement(ctx: DataContext, date: DateString, wantConfirm: boolean, note: string | null): Promise<FoodSettlement> {
  if ((note?.length ?? 0) > 500) throw new Error('备注最多500字');
  assertToday(date, todayOf(ctx.clock));
  const now = ctx.clock.now().getTime();
  let result: FoodSettlement | null = null;
  await ctx.db.transaction(async (tx) => {
    assertToday(date, todayOf(ctx.clock));
    await snapshotDay(tx, date, now);
    const day = dailyEnergy(await loadEnergyData(tx, date, date), date, date);
    const confirmed = wantConfirm && settlementConfirmable(day);
    result = { date, confirmed, stale: false, intake: day.intake, total: day.total, note, settledAt: now };
    await tx.run(
      `INSERT INTO food_settlements(date,confirmed,stale,intake,total,note,settled_at) VALUES(?,?,0,?,?,?,?)
       ON CONFLICT(date) DO UPDATE SET confirmed=excluded.confirmed, stale=0, intake=excluded.intake, total=excluded.total, note=excluded.note, settled_at=excluded.settled_at`,
      [date, confirmed ? 1 : 0, day.intake, day.total, note, now],
    );
    assertToday(date, todayOf(ctx.clock));
  });
  return result as unknown as FoodSettlement;
}

type FavoriteRow = { id: string; name: string; kcal: number; meal_type: MealType | null; created_at: number };

export async function listFavorites(db: SqlExecutor): Promise<FoodFavorite[]> {
  const rows = await db.all<FavoriteRow>('SELECT * FROM food_favorites ORDER BY created_at DESC');
  return rows.map((r) => ({ id: r.id, name: r.name, kcal: r.kcal, mealType: r.meal_type, createdAt: r.created_at }));
}

export async function addFavorite(ctx: DataContext, name: string, kcal: number, mealType: MealType | null): Promise<void> {
  const valid = checkedMeal({ name, kcal, mealType: mealType ?? 'snack', time: null, note: null });
  name = valid.name; kcal = valid.kcal;
  const exists = await ctx.db.first<{ id: string }>('SELECT id FROM food_favorites WHERE name=? AND kcal=?', [name, kcal]);
  if (exists) return;
  await ctx.db.run('INSERT INTO food_favorites(id,name,kcal,meal_type,created_at) VALUES(?,?,?,?,?)', [newId('fav'), name, kcal, mealType, ctx.clock.now().getTime()]);
}

export async function deleteFavorite(ctx: DataContext, id: string): Promise<void> {
  await ctx.db.run('DELETE FROM food_favorites WHERE id=?', [id]);
}

function checkedMeal(v: ValidMeal): ValidMeal { return validateMeal({ ...v, kcal: String(v.kcal), time: v.time ?? '', note: v.note ?? '' }); }
