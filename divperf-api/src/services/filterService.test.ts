import { describe, expect, it } from 'vitest';
import { makeScope } from '../plugins/scope.js';
import { shapeOptions, type Hierarchy, type HierarchyRow } from './filterService.js';

const row = (spart: string, zone: string, region: string, hq: string): HierarchyRow => ({
  spart, div_name: `DIV ${spart}`,
  zone_code: zone, zone_name: `Zone ${zone}`,
  region_code: region, region_name: `Region ${region}`,
  hq_code: hq, hq_name: `HQ ${hq}`,
});

// Two divisions. HQ H1 and region R1 exist in both, as 59 HQ codes do in the
// source, so a scope by HQ code alone would reach across divisions.
const H: Hierarchy = {
  rows: [
    row('85', 'Z1', 'R1', 'H1'),
    row('85', 'Z1', 'R1', 'H2'),
    row('85', 'Z1', 'R2', 'H3'),
    row('85', 'Z2', 'R3', 'H4'),
    row('78', 'Z9', 'R1', 'H1'),
    row('78', 'Z9', 'R9', 'H9'),
  ],
  brands: [
    { spart: '85', brand: 'WOSULIN' },
    { spart: '85', brand: 'GLARITUS' },
    { spart: '78', brand: 'METHYCOBAL' },
    { spart: '78', brand: 'WOSULIN' }, // a brand sold in both
  ],
  months: [202604, 202605],
};

const none = { division: [], zone: [], region: [] };
const codes = (o: { code: string }[]) => o.map((x) => x.code).sort();
const ALL = makeScope('ALL', []);

describe('shapeOptions: cascade', () => {
  it('offers everything with nothing chosen', () => {
    const o = shapeOptions(H, none, ALL, 202605);
    expect(codes(o.divisions)).toEqual(['78', '85']);
    expect(codes(o.brands)).toEqual(['GLARITUS', 'METHYCOBAL', 'WOSULIN']);
    expect(codes(o.zones)).toEqual(['Z1', 'Z2', 'Z9']);
  });

  it('offers only the chosen division\'s brands and zones', () => {
    const o = shapeOptions(H, { ...none, division: ['78'] }, ALL, 202605);
    expect(codes(o.brands)).toEqual(['METHYCOBAL', 'WOSULIN']);
    expect(codes(o.zones)).toEqual(['Z9']);
    expect(codes(o.regions)).toEqual(['R1', 'R9']);
    expect(codes(o.hqs)).toEqual(['H1', 'H9']);
    // The division list itself does not shrink to the selection.
    expect(codes(o.divisions)).toEqual(['78', '85']);
  });

  it('narrows regions by zone, and HQs by region', () => {
    const byZone = shapeOptions(H, { ...none, division: ['85'], zone: ['Z1'] }, ALL, 202605);
    expect(codes(byZone.regions)).toEqual(['R1', 'R2']);
    expect(codes(byZone.hqs)).toEqual(['H1', 'H2', 'H3']);

    const byRegion = shapeOptions(H, { division: ['85'], zone: ['Z1'], region: ['R1'] }, ALL, 202605);
    expect(codes(byRegion.hqs)).toEqual(['H1', 'H2']);
  });

  it('keeps a shared region code to its division', () => {
    // R1 is in both divisions; within 85 it holds H1 and H2, not 78's H1 row.
    const o = shapeOptions(H, { division: ['85'], zone: [], region: ['R1'] }, ALL, 202605);
    expect(codes(o.hqs)).toEqual(['H1', 'H2']);
  });
});

describe('shapeOptions: the signed-in user', () => {
  it('shows a TM only their own division, and its brands', () => {
    const tm = makeScope('HQ', ['H1'], ['85']);
    const o = shapeOptions(H, none, tm, 202605);
    expect(codes(o.divisions)).toEqual(['85']);
    expect(codes(o.brands)).toEqual(['GLARITUS', 'WOSULIN']);
    // H1 also exists in 78 (zone Z9); that zone must not be offered.
    expect(codes(o.zones)).toEqual(['Z1']);
    expect(codes(o.regions)).toEqual(['R1']);
    expect(codes(o.hqs)).toEqual(['H1']);
  });

  it('shows a ZSM their zone and everything under it', () => {
    const zsm = makeScope('ZONE', ['Z1'], ['85']);
    const o = shapeOptions(H, none, zsm, 202605);
    expect(codes(o.divisions)).toEqual(['85']);
    expect(codes(o.zones)).toEqual(['Z1']);
    expect(codes(o.regions)).toEqual(['R1', 'R2']);
    expect(codes(o.hqs)).toEqual(['H1', 'H2', 'H3']);
  });

  it('shows an NSM their division only', () => {
    const nsm = makeScope('DIVISION', ['78']);
    const o = shapeOptions(H, none, nsm, 202605);
    expect(codes(o.divisions)).toEqual(['78']);
    expect(codes(o.brands)).toEqual(['METHYCOBAL', 'WOSULIN']);
    expect(codes(o.zones)).toEqual(['Z9']);
  });

  it('offers nothing below a division the user does not belong to', () => {
    const tm = makeScope('HQ', ['H1'], ['85']);
    const o = shapeOptions(H, { ...none, division: ['78'] }, tm, 202605);
    expect(o.brands).toEqual([]);
    expect(o.zones).toEqual([]);
    expect(o.hqs).toEqual([]);
  });
});

describe('makeScope', () => {
  it('gives the same level and nodes in another division a different cache identity', () => {
    const a = makeScope('HQ', ['H1'], ['85']);
    const b = makeScope('HQ', ['H1'], ['78']);
    expect(a.hash).not.toBe(b.hash);
    expect(a.scopeId).not.toBe(b.scopeId);
  });
});
