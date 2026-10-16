import { collectOldPhotos } from './photoCleanup.ts';
import * as SQLite from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import { systemClock } from '../domain/dates.ts';
import { migrate, DATABASE_NAME } from './migrations.ts';
import { PHOTO_NAME_RE, newId, type DataContext, type PhotoStore, type SqlDb, type SqlExecutor } from './sql.ts';

function executor(db: SQLite.SQLiteDatabase): SqlExecutor {
  return {
    exec: sql => db.execAsync(sql),
    run: async (sql, params = []) => ({ changes: (await db.runAsync(sql, [...params])).changes }),
    all: <T>(sql: string, params: readonly (string | number | null)[] = []) => db.getAllAsync<T>(sql, [...params]),
    first: <T>(sql: string, params: readonly (string | number | null)[] = []) => db.getFirstAsync<T>(sql, [...params]),
  };
}
function adapt(db: SQLite.SQLiteDatabase): SqlDb {
  let queue: Promise<unknown> = Promise.resolve();
  return { ...executor(db), transaction<T>(task: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const work = queue.then(async () => {
      let result!: T;
      await db.withExclusiveTransactionAsync(async tx => { result = await task(executor(tx)); });
      return result;
    });
    queue = work.catch(() => undefined);
    return work;
  } };
}
function photoStore(): PhotoStore {
  const dir = new Directory(Paths.document, 'daily-life-photos');
  dir.create({ idempotent: true, intermediates: true });
  const file = (name: string) => { if (!PHOTO_NAME_RE.test(name)) throw new Error('无效照片文件名'); return new File(dir, name); };
  return {
    async importFromUri(uri) {
      const source = new File(uri);
      if (!source.exists || source.size > 8 * 1024 * 1024) throw new Error('照片不可读或超过8MB');
      const ext = source.extension.toLowerCase().replace('.', '');
      const name = `${newId('photo')}.${['png', 'webp', 'jpeg', 'jpg'].includes(ext) ? ext : 'jpg'}`;
      const target = file(name);
      try { await source.copy(target); } catch (error) { if (target.exists) target.delete(); throw error; }
      return name;
    },
    async write(name, bytes) { const f = file(name); if (f.exists) throw new Error('照片文件已存在'); f.create(); try { f.write(bytes); } catch (e) { if (f.exists) f.delete(); throw e; } },
    read: name => file(name).bytes(),
    exists: name => file(name).exists,
    remove(name) { const f = file(name); if (f.exists) f.delete(); },
    list: () => dir.list().filter(f => f instanceof File && PHOTO_NAME_RE.test(f.name)).map(f => f.name),
    uri: name => file(name).uri,
    modifiedAt: name => file(name).modificationTime,
  };
}
let pending: Promise<DataContext> | undefined;
export function getContext(): Promise<DataContext> {
  if (!pending) pending = (async () => {
    const native = await SQLite.openDatabaseAsync(DATABASE_NAME);
    try {
      await native.execAsync('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
      const db = adapt(native);
      await migrate(db);
      const ctx = { db, photos: photoStore(), clock: systemClock };
      await collectOldPhotos(ctx);
      return ctx;
    } catch (e) { await native.closeAsync(); throw e; }
  })().catch(e => { pending = undefined; throw e; });
  return pending;
}
