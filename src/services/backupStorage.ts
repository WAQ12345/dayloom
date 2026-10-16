import { Directory, File, Paths } from 'expo-file-system';
import { inspectBackup } from './backup';
import { saveBackupToDirectory, chooseBackupDirectory } from './native';
import { readableBackupDirectory, type BackupDestination, type BackupState } from './backupFlow';

const stateFile = () => new File(Paths.document, 'backup-location.json');
const empty: BackupState = { directory: null, lastSavedAt: null, filename: null };
export const backupDestination: BackupDestination = {
  async readState() {
    const file = stateFile();
    if (!file.exists) return { ...empty };
    try {
      const value = JSON.parse(await file.text());
      return {
        directory: typeof value.directory === 'string' && /^(content|file):/.test(value.directory) ? value.directory : null,
        lastSavedAt: typeof value.lastSavedAt === 'string' && Number.isFinite(Date.parse(value.lastSavedAt)) ? value.lastSavedAt : null,
        filename: typeof value.filename === 'string' ? value.filename : null,
      };
    } catch { return { ...empty }; }
  },
  async writeState(state) { stateFile().write(JSON.stringify(state)); },
  async accessible(uri) { try { return readableBackupDirectory(new Directory(uri)); } catch { return false; } },
  choose: chooseBackupDirectory,
  async writeVerified(uri, bytes) { return (await saveBackupToDirectory(bytes, uri)).filename; },
};
const safetyDir = () => { const dir = new Directory(Paths.document, 'restore-safety'); dir.create({ idempotent: true, intermediates: true }); return dir; };
// A new verified file is committed before pruning older copies. No pointer can become torn.
export async function saveSafetyCopy(bytes: Uint8Array): Promise<void> {
  const dir = safetyDir();
  const file = new File(dir, `safety-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  try {
    file.write(bytes);
    const saved = await file.bytes();
    if (saved.length !== bytes.length || saved.some((b, i) => b !== bytes[i])) throw new Error('readback');
    inspectBackup(saved);
  } catch { if (file.exists) file.delete(); throw new Error('无法保留恢复前的数据，尚未开始恢复。请检查手机剩余空间。'); }
  for (const old of dir.list()) if (old instanceof File && old.uri !== file.uri && /^safety-[\w-]+\.zip$/.test(old.name)) {
    try { old.delete(); } catch { /* Retain on cleanup failure. */ }
  }
}
export async function readSafetyCopy() {
  const files = safetyDir().list().filter((f): f is File => f instanceof File && /^safety-[\w-]+\.zip$/.test(f.name)).sort((a,b)=>b.name.localeCompare(a.name));
  for (const file of files) { try { if(file.size>100*1024*1024)continue;return inspectBackup(await file.bytes()); } catch { /* Fall back to a previous intact checkpoint. */ } }
  return null;
}
