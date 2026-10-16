import type { ModelCapability } from '../services/deepseek.ts';
import { isValidTime } from '../domain/dates.ts';
import type { AiModelSettings, MetabolismProfile, ReminderSettings } from '../domain/types.ts';
import type { SqlExecutor } from './sql.ts';

export type SettingsShape = {
  profile: MetabolismProfile | null;
  waterAmounts: [number, number];
  reminder: ReminderSettings;
  aiModel: AiModelSettings;
  modelCatalog: {models:ModelCapability[];checkedAt:number}|null;
  connectionStatus: {checkedAt:number;elapsedMs:number;ok:boolean;message:string}|null;
};

export const DEFAULT_SETTINGS: SettingsShape = {
  profile: null,
  waterAmounts: [250, 500],
  reminder: { enabled: false, time: '21:30', notificationId: null },
  aiModel: { model: 'deepseek-chat', timeoutSeconds: 180, thinking:'high',maxOutputTokens:8192 },
  modelCatalog:null,connectionStatus:null,
};

type Key = keyof SettingsShape;

const num = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Runtime validators keep corrupt or foreign JSON from leaking into the app. */
export const SETTINGS_VALIDATORS: { [K in Key]: (v: unknown) => SettingsShape[K] | undefined } = {
  profile: (v) => {
    if (v === null) return null;
    if (!v || typeof v !== 'object') return undefined;
    const p = v as Record<string, unknown>;
    if ((p.sex !== 'male' && p.sex !== 'female') || !num(p.age, 1, 130) || !num(p.heightCm, 50, 260) || !num(p.weightKg, 10, 500) || !num(p.metabolism, 1, 10000) || (p.mode !== 'calculated' && p.mode !== 'manual')) return undefined;
    return { sex: p.sex, age: p.age, heightCm: p.heightCm, weightKg: p.weightKg, metabolism: p.metabolism, mode: p.mode };
  },
  waterAmounts: (v) => (Array.isArray(v) && v.length === 2 && v.every((n) => num(n, 1, 5000)) ? [v[0], v[1]] : undefined),
  reminder: (v) => {
    if (!v || typeof v !== 'object') return undefined;
    const r = v as Record<string, unknown>;
    if (typeof r.enabled !== 'boolean' || !isValidTime(r.time) || (r.notificationId !== null && typeof r.notificationId !== 'string')) return undefined;
    return { enabled: r.enabled, time: r.time, notificationId: r.notificationId };
  },
  modelCatalog:(v)=>{if(v===null)return null;if(!v||typeof v!=='object')return undefined;const r=v as SettingsShape['modelCatalog'];if(!r||!num(r.checkedAt,0,Number.MAX_SAFE_INTEGER)||!Array.isArray(r.models)||r.models.length>500)return undefined;for(const m of r.models){if(!m||typeof m.id!=='string'||typeof m.name!=='string'||!Array.isArray(m.thinking)||!m.thinking.every(t=>['off','low','high','max'].includes(t))||(m.contextWindow!==null&&!num(m.contextWindow,1,100000000))||(m.maxOutputTokens!==null&&!num(m.maxOutputTokens,1,100000000)))return undefined;}return r;},
  connectionStatus:(v)=>{if(v===null)return null;if(!v||typeof v!=='object')return undefined;const r=v as SettingsShape['connectionStatus'];return r&&num(r.checkedAt,0,Number.MAX_SAFE_INTEGER)&&num(r.elapsedMs,0,Number.MAX_SAFE_INTEGER)&&typeof r.ok==='boolean'&&typeof r.message==='string'?r:undefined;},
  aiModel: (v) => {
    if (!v || typeof v !== 'object') return undefined;
    const r = v as Record<string, unknown>;
    if (typeof r.model!=='string'||!r.model.trim()||r.model.length>160||!num(r.timeoutSeconds,10,1800)||!Number.isInteger(r.timeoutSeconds)) return undefined;
    const thinking=r.thinking??'high',maxOutputTokens=r.maxOutputTokens??8192;
    if(!['off','low','high','max'].includes(thinking as string)||!num(maxOutputTokens,1,393216)||!Number.isInteger(maxOutputTokens))return undefined;
    return {model:r.model,timeoutSeconds:r.timeoutSeconds,thinking:thinking as AiModelSettings['thinking'],maxOutputTokens};
  },
};

export async function getSetting<K extends Key>(db: SqlExecutor, key: K): Promise<SettingsShape[K]> {
  const row = await db.first<{ value: string }>('SELECT value FROM settings WHERE key=?', [key]);
  if (!row) return DEFAULT_SETTINGS[key];
  try {
    const parsed = SETTINGS_VALIDATORS[key](JSON.parse(row.value));
    return parsed === undefined ? DEFAULT_SETTINGS[key] : parsed;
  } catch {
    return DEFAULT_SETTINGS[key];
  }
}

export async function setSetting<K extends Key>(db: SqlExecutor, key: K, value: SettingsShape[K]): Promise<void> {
  const checked = SETTINGS_VALIDATORS[key](value);
  if (checked === undefined) throw new Error('设置内容无效');
  await db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, JSON.stringify(checked)]);
}

export async function getAllSettings(db: SqlExecutor): Promise<SettingsShape> {
  return {
    profile: await getSetting(db, 'profile'),
    waterAmounts: await getSetting(db, 'waterAmounts'),
    reminder: await getSetting(db, 'reminder'),
    aiModel: await getSetting(db, 'aiModel'),
    modelCatalog:await getSetting(db,'modelCatalog'),connectionStatus:await getSetting(db,'connectionStatus'),
  };
}

/** Save profile and today's snapshot atomically; historical snapshots are never rewritten. */
export async function saveProfile(ctx: import('./sql.ts').DataContext, date: string, profile: MetabolismProfile): Promise<void> {
  const { assertToday, todayOf } = await import('../domain/dates.ts');
  const checked = SETTINGS_VALIDATORS.profile(profile);
  if (!checked) throw new Error('基础资料无效');
  assertToday(date, todayOf(ctx.clock));
  await ctx.db.transaction(async tx => {
    assertToday(date, todayOf(ctx.clock));
    const old = await tx.first<{ metabolism: number | null }>('SELECT metabolism FROM day_energy WHERE date=?', [date]);
    const previous = old ? old.metabolism : (await getSetting(tx, 'profile'))?.metabolism ?? null;
    await setSetting(tx, 'profile', checked);
    await tx.run(`INSERT INTO day_energy(date,metabolism,expenditure,updated_at) VALUES(?,?,NULL,?)
      ON CONFLICT(date) DO UPDATE SET metabolism=excluded.metabolism,updated_at=excluded.updated_at`, [date, checked.metabolism, ctx.clock.now().getTime()]);
    if (previous !== checked.metabolism) await tx.run('UPDATE food_settlements SET stale=1 WHERE date=?', [date]);
    assertToday(date, todayOf(ctx.clock));
  });
}
