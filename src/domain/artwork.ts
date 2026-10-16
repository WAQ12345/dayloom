import { dayNumber, isValidDate, type DateString } from './dates.ts';

export const ARTWORK_ANCHOR: DateString = '2026-10-10';
export const ARTWORK_COUNT = 7;
export type ArtworkModule = 'food' | 'plans';

/**
 * Daily home artwork index. Continuous 7-day cycle anchored to 2026-10-10 (index 0),
 * stable for any viewed date and never reset at month boundaries.
 */
export function artworkIndex(date: DateString): number | null {
  if (!isValidDate(date)) return null;
  const diff = dayNumber(date) - dayNumber(ARTWORK_ANCHOR);
  return ((diff % ARTWORK_COUNT) + ARTWORK_COUNT) % ARTWORK_COUNT;
}

export function artworkId(module: ArtworkModule, date: DateString): string | null {
  const index = artworkIndex(date);
  return index === null ? null : `${module}-${String(index + 1).padStart(2, '0')}`;
}
