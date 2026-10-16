import { PHOTO_NAME_RE, type DataContext } from './sql.ts';

const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** Call once before exposing the context to screens: never race an editor or restore. */
export async function collectOldPhotos(ctx: DataContext): Promise<{ removed: number; skipped: boolean }> {
  const referenced = new Set<string>();
  const photos = ctx.photos;
  if (!photos.modifiedAt) return { removed: 0, skipped: true };
  try {
    const files = photos.list();
    const uris = new Map(files.map(name => [photos.uri(name), name]));
    const rows = await ctx.db.all<{photo: string}>('SELECT photo FROM meals WHERE photo IS NOT NULL UNION SELECT photo FROM items WHERE photo IS NOT NULL');
    for (const row of rows) referenced.add(row.photo);
    const drafts = await ctx.db.all<{payload: string}>('SELECT payload FROM drafts');
    // Scan all strings conservatively, including old draft formats and originalPhoto.
    const visit = (value: unknown): void => {
      if (typeof value === 'string') {
        if (PHOTO_NAME_RE.test(value)) referenced.add(value);
        const name = uris.get(value); if (name) referenced.add(name);
      } else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    for (const draft of drafts) visit(JSON.parse(draft.payload));
    const cutoff = ctx.clock.now().getTime() - GRACE_MS;
    let removed = 0;
    for (const name of files) {
      if (!PHOTO_NAME_RE.test(name) || referenced.has(name)) continue;
      const modified = photos.modifiedAt(name);
      if (modified === null || !Number.isFinite(modified) || modified <= 0 || modified >= cutoff) continue;
      try { photos.remove(name); removed++; } catch { /* Retry on a later launch. */ }
    }
    return { removed, skipped: false };
  } catch { return { removed: 0, skipped: true }; } // Unreadable references must never cause deletion.
}
