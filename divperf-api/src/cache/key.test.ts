import { describe, expect, it } from 'vitest';
import { canonToString, hotKey, hotPrefix, viewKey, type CanonicalFilters } from './key.js';

const base: CanonicalFilters = {
  from: 202604, to: 202608,
  division: [], brand: [], zone: [], region: [], hq: [],
};

describe('cache keys', () => {
  it('is order-insensitive on array filters', () => {
    // Array ordering alone is enough to halve the hit rate. (§8.4)
    const a = canonToString({ ...base, zone: ['JH', 'JK', 'JE'] });
    const b = canonToString({ ...base, zone: ['JE', 'JH', 'JK'] });
    expect(a).toBe(b);
  });

  it('distinguishes different filter values', () => {
    expect(canonToString({ ...base, zone: ['JH'] })).not.toBe(
      canonToString({ ...base, zone: ['JK'] }),
    );
    expect(canonToString({ ...base, to: 202607 })).not.toBe(canonToString(base));
  });

  it('does not confuse a value in one dimension with the same value in another', () => {
    expect(canonToString({ ...base, zone: ['X'] })).not.toBe(
      canonToString({ ...base, region: ['X'] }),
    );
  });

  it('puts the scope in the key so two scopes never share an entry (I6)', () => {
    const asm = viewKey('aaaa1111', 'division-performance', base);
    const national = viewKey('bbbb2222', 'division-performance', base);
    expect(asm).not.toBe(national);
    expect(asm).toContain('aaaa1111');
  });

  it('refuses to build a key without a usable scope segment', () => {
    expect(() => viewKey('', 'division-performance', base)).toThrow(/I6/);
    // A colon would let a crafted scope forge a different key shape.
    expect(() => viewKey('a:b', 'division-performance', base)).toThrow(/I6/);
  });

  it('namespaces every key so a deploy can invalidate everything', () => {
    expect(viewKey('s', 'division-performance', base)).toMatch(/^dash:v1:/);
  });
});

describe('view keys', () => {
  it('leave the data version out, so the previous copy can be served while it is rebuilt', () => {
    expect(viewKey('s', 'division-performance', base)).not.toMatch(/202609/);
    expect(viewKey('s', 'division-performance', { ...base, zone: ['B', 'A'] })).toBe(
      viewKey('s', 'division-performance', { ...base, zone: ['A', 'B'] }),
    );
  });

  it('mark a view as recently used under one listable prefix', () => {
    const view = viewKey('s', 'zone-performance', base);
    expect(hotKey(view).startsWith(hotPrefix())).toBe(true);
    expect(hotKey(view)).toContain('s:view:zone-performance');
  });
});
