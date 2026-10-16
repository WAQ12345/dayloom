import { isValidDate, monthDates, type DateString } from './dates.ts';

/**
 * Calorie balance rules (PRODUCT.md 2026-10-12):
 *   total consumption = metabolism snapshot of the day + activity expenditure (defaults to 0)
 *   net = intake − total consumption  (positive = net intake, negative = net burn)
 * Missing activity expenditure defaults to 0; missing intake/metabolism remain unknown.
 */

export type EnergyMealInput = { date: DateString; kcal: number };
export type EnergyDayInput = { metabolism: number | null; expenditure: number | null };
export type EnergySettlementInput = { confirmed: boolean; stale: boolean };

export type EnergyData = {
  meals: readonly EnergyMealInput[];
  days: Readonly<Record<DateString, EnergyDayInput | undefined>>;
  settlements: Readonly<Record<DateString, EnergySettlementInput | undefined>>;
  /** Current profile metabolism, used only for today when no snapshot exists yet. */
  currentMetabolism: number | null;
};

export type DayStatus = 'future' | 'complete' | 'pending' | 'incomplete' | 'missing';

export type DailyEnergy = {
  date: DateString;
  intake: number | null;
  mealCount: number;
  metabolism: number | null;
  expenditure: number | null;
  total: number | null;
  net: number | null;
  eligible: boolean;
  stale: boolean;
  settled: boolean;
  status: DayStatus;
};

export type MonthEnergy = {
  days: DailyEnergy[];
  included: number;
  pending: number;
  incomplete: number;
  /** Signed sum of eligible days; null when no day qualifies. */
  net: number | null;
};

const validNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export const round1 = (v: number) => Math.round((v + Number.EPSILON) * 10) / 10;

/** Only absent activity defaults to zero; corrupt numbers remain unknown. */
export function activityExpenditure(value: unknown): number | null {
  return value == null ? 0 : validNumber(value) ? value : null;
}

export function totalConsumption(metabolism: number | null, expenditure: number | null | undefined): number | null {
  const activity = activityExpenditure(expenditure);
  return validNumber(metabolism) && activity !== null ? round1(metabolism + activity) : null;
}

/** Net = intake − consumption: surplus positive, net consumption negative. */
export function netEnergy(total: number | null, intake: number | null): number | null {
  return total !== null && intake !== null ? round1(intake - total) : null;
}

export function intakeOf(meals: readonly EnergyMealInput[]): number | null {
  if (!meals.length || !meals.every((m) => validNumber(m.kcal))) return null;
  return round1(meals.reduce((s, m) => s + m.kcal, 0));
}

export function dailyEnergy(data: EnergyData, date: DateString, today: DateString): DailyEnergy {
  if (!isValidDate(date)) throw new Error('无效的日期');
  const future = date > today;
  const rows = data.meals.filter((m) => m.date === date);
  const intake = intakeOf(rows);
  const day = data.days[date];
  const snapshot = day?.metabolism;
  const metabolismRaw = validNumber(snapshot) ? snapshot : date === today ? data.currentMetabolism : null;
  const metabolism = validNumber(metabolismRaw) ? metabolismRaw : null;
  const expenditure = activityExpenditure(day?.expenditure);
  const total = totalConsumption(metabolism, day?.expenditure);
  const net = future ? null : netEnergy(total, intake);
  const settlement = data.settlements[date];
  const stale = !!settlement?.stale;
  // Saving complete inputs is sufficient; legacy settlements never gate totals.
  const eligible = !future && net !== null;
  const hasData = rows.length > 0 || day?.expenditure != null || !!settlement;
  const status: DayStatus = future
    ? 'future'
    : eligible
      ? 'complete'
      : hasData
          ? 'incomplete'
          : 'missing';
  return { date, intake, mealCount: rows.length, metabolism, expenditure, total, net, eligible, stale, settled: !!settlement, status };
}

export function monthEnergy(data: EnergyData, month: string, today: DateString): MonthEnergy {
  const days = monthDates(month).map((d) => dailyEnergy(data, d, today));
  const included = days.filter((d) => d.eligible);
  return {
    days,
    included: included.length,
    pending: days.filter((d) => d.status === 'pending').length,
    incomplete: days.filter((d) => d.status === 'incomplete').length,
    net: included.length ? round1(included.reduce((s, d) => s + (d.net as number), 0)) : null,
  };
}

/** A settlement only counts as confirmed when the user ticks it and the day's data is complete. */
export function settlementConfirmable(day: DailyEnergy): boolean {
  return day.intake !== null && day.total !== null;
}

export function formatKcal(n: number): string {
  return round1(n).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function signedKcal(n: number): string {
  return (n > 0 ? '+' : n < 0 ? '−' : '') + formatKcal(Math.abs(n));
}

export function netLabel(n: number): string {
  return n > 0 ? '净摄入' : n < 0 ? '净消耗' : '收支平衡';
}

/** Mifflin–St Jeor resting energy estimate (kcal/day). */
export function mifflinStJeor(sex: 'male' | 'female', age: number, heightCm: number, weightKg: number): number {
  return Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161));
}
