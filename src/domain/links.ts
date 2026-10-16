import { isValidDate, localDate } from './dates.ts';

export const MAX_NATIVE_LINK_LENGTH = 1024;
const routes: Record<string, string> = {
  '/': '/(tabs)', '/(tabs)': '/(tabs)', '/(tabs)/index': '/(tabs)',
  '/plans': '/(tabs)/plans', '/(tabs)/plans': '/(tabs)/plans',
  '/items': '/(tabs)/items', '/(tabs)/items': '/(tabs)/items',
  '/ai': '/(tabs)/ai', '/(tabs)/ai': '/(tabs)/ai',
  '/settings': '/settings', '/energy-overview': '/energy-overview',
  '/plan-overview': '/plan-overview',
};

/** One strict decode only. Never pass untrusted encoded text to Router's decoders. */
function decode(value: string): string {
  const result = decodeURIComponent(value);
  if (/[\s%\\#\u0000-\u001f\u007f]/u.test(result)) throw new Error('Invalid link');
  return result;
}

/** Native OS intents only; in-app router navigation is intentionally unaffected. */
export function safeNativePath(input: unknown, today = localDate()): string {
  // Check size before URL parsing, decoding or splitting. Never log rejected URLs.
  if (typeof input !== 'string' || input.length > MAX_NATIVE_LINK_LENGTH) return '/';
  try {
    let path = input;
    if (/^dailylife:\/\//i.test(path)) path = `/${path.slice('dailylife://'.length).replace(/^\//, '')}`;
    if (!path.startsWith('/') || path.startsWith('//') || /[\s\\#\u0000-\u001f\u007f]/u.test(path)) return '/';
    const parts = path.split('?');
    if (parts.length > 2) return '/';
    const rawRoute = decode(parts[0]);
    if (!Object.hasOwn(routes, rawRoute)) return '/';
    const route = routes[rawRoute];
    const params = new Map<string, string>();
    if (parts.length === 2) {
      if (!parts[1]) return '/';
      for (const entry of parts[1].split('&')) {
        const pair = entry.split('=');
        if (pair.length !== 2) return '/';
        const key = decode(pair[0]), value = decode(pair[1]);
        if (!key || !value || params.has(key)) return '/';
        params.set(key, value);
      }
    }
    if (route === '/(tabs)') {
      if ([...params.keys()].some(k => !['date', 'recordId', 'kind'].includes(k))) return '/';
      const date = params.get('date');
      if (date !== undefined && (!isValidDate(date) || !isValidDate(today) || date > today)) return '/';
      const id = params.get('recordId'), kind = params.get('kind');
      if (id !== undefined || kind !== undefined) {
        if (!date || !id || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || !['meal', 'water'].includes(kind ?? '')) return '/';
      }
    } else if (route === '/settings') {
      if ([...params.keys()].some(k => k !== 'section')) return '/';
      const section = params.get('section');
      if (section !== undefined && !['profile', 'model', 'reminder', 'data'].includes(section)) return '/';
    } else if (params.size > 0) return '/';
    const query = [...params].map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    return route + (query ? `?${query}` : '');
  } catch {
    return '/';
  }
}
