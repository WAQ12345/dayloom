import type { DateString } from './dates.ts';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MEAL_LABEL: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

export type Meal = {
  id: string;
  date: DateString;
  mealType: MealType;
  name: string;
  kcal: number;
  time: string | null;
  note: string | null;
  /** File name inside the private photo directory, never an absolute path. */
  photo: string | null;
  createdAt: number;
  updatedAt: number;
};

export type FoodFavorite = {
  id: string;
  name: string;
  kcal: number;
  mealType: MealType | null;
  createdAt: number;
};

/** Per-day energy snapshot. metabolism is frozen per day so later profile edits never rewrite history. */
export type DayEnergy = {
  date: DateString;
  metabolism: number | null;
  expenditure: number | null;
  updatedAt: number;
};

export type FoodSettlement = {
  date: DateString;
  /** User confirmed the day as complete and data was complete at confirmation time. */
  confirmed: boolean;
  stale: boolean;
  intake: number | null;
  total: number | null;
  note: string | null;
  settledAt: number;
};

export type WaterRecord = {
  id: string;
  date: DateString;
  time: string;
  amountMl: number;
  note: string | null;
  createdAt: number;
};

export type TaskStatus = 'todo' | 'done' | 'cancelled';
export type TaskOrderLevel = 1 | 2 | 3;
export type TaskPriority = 'normal' | 'important';
export const PRIORITY_LABEL: Record<TaskPriority, string> = { normal: '普通', important: '重要' };
export const STATUS_LABEL: Record<TaskStatus, string> = { todo: '未完成', done: '已完成', cancelled: '已取消' };

export type Task = {
  id: string;
  date: DateString;
  name: string;
  priority: TaskPriority;
  project: string;
  status: TaskStatus;
  sortOrder: number;
  orderLevel: TaskOrderLevel;
  note: string | null;
  createdAt: number;
  updatedAt: number;
};

export type PlanSettlement = {
  date: DateString;
  summary: string | null;
  doneCount: number;
  totalCount: number;
  stale: boolean;
  settledAt: number;
};

export type Item = {
  id: string;
  name: string;
  category: string;
  /** null = unknown purchase date. */
  purchaseDate: DateString | null;
  /** Price in cents; null = unknown, 0 = free. */
  priceCents: number | null;
  location: string | null;
  brand: string | null;
  note: string | null;
  photo: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Sex = 'male' | 'female';
export type MetabolismProfile = {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  metabolism: number;
  mode: 'calculated' | 'manual';
};

export type ReminderSettings = {
  enabled: boolean;
  time: string;
  notificationId: string | null;
};

export type AiModelSettings = {
  model: string;
  timeoutSeconds: number;
  thinking: 'off' | 'low' | 'high' | 'max';
  maxOutputTokens: number;
};

export type AiCitation = { ref: string; recordId: string; valid: boolean };

export type AiSession = {
  id: string;
  createdAt: number;
  question: string;
  model: string;
  /** Exact text payload sent (user message), for later review. */
  snapshot: string;
  /** Records included, keyed by short reference. */
  references: AiReference[];
  answer: string | null;
  citations: AiCitation[];
  status: 'success' | 'error' | 'cancelled';
  error: string | null;
};

export type AiReference = {
  ref: string;
  recordId: string;
  kind: 'meal' | 'water';
  date: DateString;
  label: string;
  summary: string;
};

export type ShoppingItem = {id:string;name:string;note:string|null;status:'pending'|'done';seq:number;createdAt:number;completedAt:number|null;updatedAt:number};
export type LifeKind = 'membership'|'fixed';
export type LifeRecord = {id:string;kind:LifeKind;name:string;startDate:DateString;amountCents:number|null;note:string|null;seq:number;createdAt:number;updatedAt:number};
