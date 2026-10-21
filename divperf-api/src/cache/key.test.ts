import { describe, expect, it } from 'vitest';
import { canonToString, tabKey, type CanonicalFilters } from './key.js';

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
    const asm = tabKey('aaaa1111', 'division-performance', base, 'v1');
    const national = tabKey('bbbb2222', 'division-performance', base, 'v1');
    expect(asm).not.toBe(national);
    expect(asm).toContain('aaaa1111');
  });

  it('refuses to build a key without a usable scope segment', () => {
    expect(() => tabKey('', 'division-performance', base, 'v1')).toThrow(/I6/);
    // A colon would let a crafted scope forge a different key shape.
    expect(() => tabKey('a:b', 'division-performance', base, 'v1')).toThrow(/I6/);
  });

  it('namespaces every key so a deploy can invalidate everything', () => {
    expect(tabKey('s', 'division-performance', base, 'v1')).toMatch(/^dash:v1:/);
  });
});

describe('tabKey and data reloads', () => {
  const f = { from: 202604, to: 202608, division: [], brand: [], zone: [], region: [], hq: [] };
  it('changes when the data version does, so a reload is never served from cache', () => {
    expect(tabKey('s', 'division-performance', f, '202609-aaaa')).not.toBe(
      tabKey('s', 'division-performance', f, '202609-bbbb'),
    );
  });
});
