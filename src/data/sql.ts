/** Minimal async SQL surface shared by the Expo adapter and the Node test adapter. */
export type SqlValue = string | number | null;

export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<{ changes: number }>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
}

export interface SqlDb extends SqlExecutor {
  /** Exclusive transaction: every statement inside must use the provided executor. */
  transaction<T>(task: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

/** Photo blobs live in a private app directory; the database only stores file names. */
export interface PhotoStore {
  /** Copies an external URI (camera/picker result) into private storage and returns the new file name. */
  importFromUri(uri: string): Promise<string>;
  write(name: string, bytes: Uint8Array): Promise<void>;
  read(name: string): Promise<Uint8Array>;
  exists(name: string): boolean;
  remove(name: string): void;
  list(): string[];
  uri(name: string): string;
  /** Milliseconds since epoch; unknown timestamps must not be collected. */
  modifiedAt?(name: string): number | null;
}

export type DataContext = {
  db: SqlDb;
  photos: PhotoStore;
  clock: { now(): Date };
};

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export const PHOTO_NAME_RE = /^[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png|webp)$/;
