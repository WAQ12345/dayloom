import { isValidDate, isValidTime } from './dates.ts';
import { MEAL_TYPES, type MealType, type TaskOrderLevel, type TaskPriority } from './types.ts';

/** Field-level validation error so forms can highlight the offending input while keeping all input. */
export class ValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export const LIMITS = {
  name: 100,
  note: 500,
  project: 40,
  category: 20,
  kcal: 100000,
  waterMl: 5000,
  quickWaterMl: 5000,
  priceYuan: 1e10,
} as const;

function text(field: string, value: string, label: string, max: number, required: boolean): string | null {
  const v = value.trim();
  if (!v) {
    if (required) throw new ValidationError(field, `请填写${label}`);
    return null;
  }
  if (v.length > max) throw new ValidationError(field, `${label}最多 ${max} 个字`);
  return v;
}

export function requiredText(field: string, value: string, label: string, max: number = LIMITS.name): string {
  return text(field, value, label, max, true) as string;
}

export function optionalText(field: string, value: string, label: string, max: number = LIMITS.note): string | null {
  return text(field, value, label, max, false);
}

/** Parses a non-negative decimal number. Empty input is rejected (distinguishes missing from 0). */
export function parseNumber(field: string, value: string, label: string, min: number, max: number): number {
  const v = value.trim();
  if (!v) throw new ValidationError(field, `请填写${label}`);
  if (!/^\d+(\.\d+)?$/.test(v)) throw new ValidationError(field, `${label}请输入数字`);
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(field, `${label}需在 ${min}—${max} 之间`);
  return Math.round(n * 10) / 10;
}

export function parseInteger(field: string, value: string, label: string, min: number, max: number): number {
  const v = value.trim();
  if (!/^\d+$/.test(v)) throw new ValidationError(field, `${label}请输入整数`);
  const n = Number(v);
  if (n < min || n > max) throw new ValidationError(field, `${label}需在 ${min}—${max} 之间`);
  return n;
}

export function optionalTime(field: string, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!isValidTime(v)) throw new ValidationError(field, '时间格式为 HH:MM，例如 08:30');
  return v;
}

export function requiredTime(field: string, value: string): string {
  const v = optionalTime(field, value);
  if (!v) throw new ValidationError(field, '请填写时间（HH:MM）');
  return v;
}

export function parseDate(field: string, value: string, label = '日期'): string {
  const v = value.trim();
  if (!isValidDate(v)) throw new ValidationError(field, `${label}格式为 YYYY-MM-DD，且需是真实日期`);
  return v;
}

export type MealInput = { name: string; kcal: string; mealType: MealType; time: string; note: string };
export type ValidMeal = { name: string; kcal: number; mealType: MealType; time: string | null; note: string | null };

export function validateMeal(input: MealInput): ValidMeal {
  if (!MEAL_TYPES.includes(input.mealType)) throw new ValidationError('mealType', '请选择餐次');
  return {
    name: requiredText('name', input.name, '食品名称'),
    kcal: parseNumber('kcal', input.kcal, '热量', 0, LIMITS.kcal),
    mealType: input.mealType,
    time: optionalTime('time', input.time),
    note: optionalText('note', input.note, '备注'),
  };
}

export function validateWaterAmount(field: string, value: string): number {
  return parseNumber(field, value, '饮水量', 1, LIMITS.waterMl);
}

export type TaskInput = { name: string; orderLevel?: TaskOrderLevel; order?: string; priority?: TaskPriority; project: string; note: string };
export type ValidTask = { name: string; orderLevel?: TaskOrderLevel; priority?: TaskPriority; project: string; note: string | null };

export function validateTask(input: TaskInput): ValidTask {
  const orderLevel = input.orderLevel === undefined ? 2 : input.orderLevel;
  if (![1, 2, 3].includes(orderLevel)) throw new ValidationError('orderLevel', '请选择 1、2 或 3 级次序');
  if (input.priority !== undefined && input.priority !== 'normal' && input.priority !== 'important') throw new ValidationError('priority', '无效的旧优先级');
  return {
    name: requiredText('name', input.name, '任务名称'),
    orderLevel,
    priority: input.priority,
    project: optionalText('project', input.project, '所属计划', LIMITS.project) ?? '生活日常',
    note: optionalText('note', input.note, '具体内容'),
  };
}

export type ItemInput = {
  name: string;
  category: string;
  purchaseDate: string;
  unknownDate: boolean;
  price: string;
  unknownPrice: boolean;
  location: string;
  brand: string;
  note: string;
};
export type ValidItem = {
  name: string;
  category: string;
  purchaseDate: string | null;
  priceCents: number | null;
  location: string | null;
  brand: string | null;
  note: string | null;
};

/** Price in yuan → integer cents. Unknown price (null) is distinct from free (0). */
export function parsePriceCents(field: string, value: string): number {
  const v = value.trim();
  if (!v) throw new ValidationError(field, '请填写价格，或勾选“价格未知”');
  if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new ValidationError(field, '价格为非负数，最多两位小数');
  const n = Number(v);
  if (n > LIMITS.priceYuan) throw new ValidationError(field, '价格过大');
  return Math.round(n * 100);
}

export function validateItem(input: ItemInput, categories: readonly string[]): ValidItem {
  const category = input.category.trim();
  if (!categories.includes(category)) throw new ValidationError('category', '请选择分类');
  return {
    name: requiredText('name', input.name, '物品名称'),
    category,
    purchaseDate: input.unknownDate ? null : parseDate('purchaseDate', input.purchaseDate, '购买日期'),
    priceCents: input.unknownPrice ? null : parsePriceCents('price', input.price),
    location: optionalText('location', input.location, '存放位置', LIMITS.name),
    brand: optionalText('brand', input.brand, '品牌 / 型号', LIMITS.name),
    note: optionalText('note', input.note, '备注'),
  };
}

export function formatPrice(cents: number | null): string {
  if (cents === null) return '价格未知';
  const yuan = cents / 100;
  return `¥ ${yuan.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
}

export function centsToInput(cents: number | null): string {
  if (cents === null) return '';
  return cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100);
}

export type ShoppingInput = {name:string;note:string};
export type ValidShopping = {name:string;note:string|null};
export function validateShopping(input:ShoppingInput):ValidShopping{return {name:requiredText('name',input.name,'名称'),note:optionalText('note',input.note,'备注')};}
export type LifeRecordInput = {name:string;startDate:string;amount:string;note:string};
export type ValidLifeRecord = {name:string;startDate:string;amountCents:number|null;note:string|null};
export function validateLifeRecord(input:LifeRecordInput,today:string):ValidLifeRecord{
 const startDate=parseDate('startDate',input.startDate,'开始日期');
 if(startDate>today)throw new ValidationError('startDate','开始日期不能晚于今天');
 const amount=input.amount.trim();
 if(amount&&!/^\d+(\.\d{1,2})?$/.test(amount))throw new ValidationError('amount','金额为非负数，最多两位小数');
 if(amount&&Number(amount)>LIMITS.priceYuan)throw new ValidationError('amount','金额过大');
 return {name:requiredText('name',input.name,'名称'),startDate,amountCents:amount?parsePriceCents('amount',amount):null,note:optionalText('note',input.note,'备注')};
}
