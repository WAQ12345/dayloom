import type { DataContext } from '../data/sql.ts';
import { createBackup, restoreBackup, type ValidatedBackup } from './backup.ts';

export type BackupState = { directory: string | null; lastSavedAt: string | null; filename: string | null };
export type BackupDestination = {
  readState(): Promise<BackupState>;
  writeState(state: BackupState): Promise<void>;
  accessible(uri: string): Promise<boolean>;
  choose(): Promise<string | null>;
  writeVerified(uri: string, bytes: Uint8Array): Promise<string>;
};
/** Cancel/failure never advances the last successful backup timestamp. */
export async function backupNow(ctx: DataContext, storage: BackupDestination) {
  const state = await storage.readState();
  let directory = state.directory;
  if (!directory || !await storage.accessible(directory)) directory = await storage.choose();
  if (!directory) return null;
  const bytes = await createBackup(ctx);
  const filename = await storage.writeVerified(directory, bytes);
  const next = { directory, filename, lastSavedAt: ctx.clock.now().toISOString() };
  try { await storage.writeState(next); }
  catch { throw new Error(`备份已保存为 ${filename}，但无法记住保存位置，请重新选择。`); }
  return next;
}
/** The checkpoint must be durably verified before the first restore mutation. */
export async function restoreWithSafety(ctx: DataContext, backup: ValidatedBackup, checkpoint: (bytes: Uint8Array) => Promise<void>) {
  const current = await createBackup(ctx);
  await checkpoint(current);
  await restoreBackup(ctx, backup);
}

/** Some Android document providers return [] instead of throwing for missing trees. */
export function readableBackupDirectory(directory: { readonly exists: boolean; list(): unknown[] }): boolean {
  try { if (!directory.exists) return false; directory.list(); return true; } catch { return false; }
}
