/**
 * Calendar-date helpers. Business dates are local device calendar dates (YYYY-MM-DD).
 * UTC is only used to turn a calendar date into a timezone-free day number.
 */

export type DateString = string;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type Clock = { now(): Date };
export const systemClock: Clock = { now: () => new Date() };

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date of the device (never UTC). */
export function localDate(date: Date = new Date()): DateString {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayOf(clock: Clock = systemClock): DateString {
  return localDate(clock.now());
}

export function localTime(date: Date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isValidDate(value: unknown): value is DateString {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const v = new Date(0);
  v.setUTCHours(0, 0, 0, 0);
  v.setUTCFullYear(y, m - 1, d);
  return v.toISOString().slice(0, 10) === value;
}

export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

/** Timezone-free day index of a calendar date. */
export function dayNumber(date: DateString): number {
  if (!isValidDate(date)) throw new Error('无效的日期');
  const [y, m, d] = date.split('-').map(Number);
  const value = new Date(0);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCFullYear(y, m - 1, d);
  return value.getTime() / 86400000;
}

export function fromDayNumber(n: number): DateString {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

export function shiftDate(date: DateString, days: number): DateString {
  return fromDayNumber(dayNumber(date) + days);
}

export function monthOf(date: DateString): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthDates(month: string): DateString[] {
  return Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${pad(i + 1)}`);
}

/** Monday-first offset of the first day of the month (0..6). */
export function mondayOffset(month: string): number {
  const weekday = new Date(dayNumber(`${month}-01`) * 86400000).getUTCDay();
  return (weekday + 6) % 7;
}

const WEEK = '日一二三四五六';
export function weekdayText(date: DateString): string {
  return `周${WEEK[new Date(dayNumber(date) * 86400000).getUTCDay()]}`;
}

export function dateText(date: DateString): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}月${d}日 ${weekdayText(date)}`;
}

export function monthText(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}年 ${m}月`;
}

export class ReadOnlyDateError extends Error {
  constructor(message = '历史记录只读，只能填写今天。') {
    super(message);
    this.name = 'ReadOnlyDateError';
  }
}

/** Daily records (food, water, tasks) are writable only for the device's current date. */
export function assertToday(date: DateString, today: DateString): void {
  if (!isValidDate(date) || date !== today) throw new ReadOnlyDateError();
}

export function isFuture(date: DateString, today: DateString): boolean {
  return date > today;
}

/** Milliseconds until the next local midnight (+1s safety margin). */
export function msUntilNextMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

/** Elapsed calendar days; today is day zero, independent of daylight saving time. */
export function startedDays(startDate:DateString,today:DateString):number {return dayNumber(today)-dayNumber(startDate);}
