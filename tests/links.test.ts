import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_NATIVE_LINK_LENGTH, safeNativePath } from '../src/domain/links.ts';
const today = '2026-10-12';
const safe = (input: unknown) => safeNativePath(input, today);

test('native known routes and settings canonicalize without changing internal navigation', () => {
  assert.equal(safe('dailylife://'), '/(tabs)');
  for (const route of ['plans', 'items', 'ai']) {
    assert.equal(safe(`dailylife://${route}`), `/(tabs)/${route}`);
    assert.equal(safe(`dailylife:///${route}`), `/(tabs)/${route}`);
  }
  assert.equal(safe('/energy-overview'), '/energy-overview');
  assert.equal(safe('/plan-overview'), '/plan-overview');
  assert.equal(safe('/settings?section=model'), '/settings?section=model');
  assert.equal(safe('/settings?section=%70rofile'), '/settings?section=profile');
});
test('food dates and references accept valid past/today only', () => {
  assert.equal(safe('/?date=2024-02-29'), '/(tabs)?date=2024-02-29');
  assert.equal(safe('/(tabs)?date=2026-10-12&recordId=meal_123&kind=meal'), '/(tabs)?date=2026-10-12&recordId=meal_123&kind=meal');
  for (const date of ['2025-02-29', '2026-10-13', '2026-1-1', 'invalid']) assert.equal(safe(`/?date=${date}`), '/');
  for (const query of ['recordId=meal_123&kind=meal', 'date=2026-10-12&kind=water', 'date=2026-10-12&recordId=a&kind=task']) assert.equal(safe(`/?${query}`), '/');
});
test('native entry refuses unknown paths, schemes, authorities and parameters', () => {
  for (const input of ['https://example.com/settings', 'exp+daily-life://expo-development-client?url=x', '//settings', 'dailylife://evil/settings', '/foo', '/settings/../ai', '/settings?section=secret', '/ai?prompt=send', '/plans?date=2026-10-11', '/?date=2026-10-12&date=2026-10-11', '/?__proto__=x', '/settings#model', '/settings?section=model?', '/settings?section=', '/settings?']) assert.equal(safe(input), '/', input);
});
test('rejects malformed and recursively encoded input before Router decoding', () => {
  for (const input of ['/settings?section=%', '/settings?section=%FF', '/settings?section=%C0%AF', '/settings?section=%25%36%64odel', '/%252e%252e/settings', '/settings?section=model%00', '/settings?section=mo+del', '/settings?section=model%26x%3Dy', '/settings\\x', '/settings\n']) assert.equal(safe(input), '/', input);
  assert.equal(safe(`/settings?section=${'%A'.repeat(MAX_NATIVE_LINK_LENGTH)}`), '/');
  assert.equal(safe(null), '/');
  assert.equal(safe({}), '/');
});
