import { describe, expect, it } from 'vitest';
import {
  BIGHA_VARIANTS,
  areaUnitFor,
  convertArea,
  convertLength,
  convertVolume,
  convertWeight,
  formatArea,
  formatIndian,
  formatLength,
  formatVolume,
  formatWeight,
  lengthInputText,
  lengthToMm,
  mmToLength,
  parseAngle,
  parseArea,
  parseLength,
  parseVolume,
  parseWeight,
  snapMm,
} from '../core/units';
import type { LengthUnit } from '../core/model/types';

const FT = 304.8;
const IN = 25.4;

describe('parseLength accepts every documented form', () => {
  const cases: [string, LengthUnit, number][] = [
    ['12', 'ft', 12 * FT],
    ['12.5', 'ft', 12.5 * FT],
    ['12ft', 'mm', 12 * FT],
    ["12'6", 'mm', 12 * FT + 6 * IN],
    ['12\' 6"', 'mm', 12 * FT + 6 * IN],
    ['12-6', 'mm', 12 * FT + 6 * IN],
    ['12 ft 6 in', 'mm', 12 * FT + 6 * IN],
    ['3.2m', 'ft', 3200],
    ['320cm', 'ft', 3200],
    ['3200', 'mm', 3200],
    ['5 1/2 in', 'mm', 5.5 * IN],
    ['5.5in', 'mm', 5.5 * IN],
    ['5\' 6"', 'mm', 5 * FT + 6 * IN],
    ["5'", 'mm', 5 * FT],
    ['6"', 'mm', 6 * IN],
    ['1/2 in', 'mm', 0.5 * IN],
    ['1/4in', 'mm', 0.25 * IN],
    ['1/8 in', 'mm', 0.125 * IN],
    ['1/16 in', 'mm', 0.0625 * IN],
    ['3 1/2"', 'mm', 3.5 * IN],
    ['10\' 3 1/2"', 'mm', 10 * FT + 3.5 * IN],
    ['10ft 3 1/2in', 'mm', 10 * FT + 3.5 * IN],
    ['10 feet 3 inches', 'mm', 10 * FT + 3 * IN],
    ['10 foot 3 inch', 'mm', 10 * FT + 3 * IN],
    ['2 yd', 'mm', 2 * 914.4],
    ['2 yards', 'mm', 2 * 914.4],
    ['2 gaj', 'mm', 2 * 914.4],
    ['2 gaz', 'mm', 2 * 914.4],
    ['4 hath', 'mm', 4 * 457.2],
    ['4 cubits', 'mm', 4 * 457.2],
    ['4 haath', 'mm', 4 * 457.2],
    ['1.5 metres', 'ft', 1500],
    ['1.5 meter', 'ft', 1500],
    ['1.5 mtr', 'ft', 1500],
    ['25 mm', 'ft', 25],
    ['25 millimetres', 'ft', 25],
    ['25 cm', 'ft', 250],
    ['25 centimeters', 'ft', 250],
    ['.5m', 'ft', 500],
    ['1,200 mm', 'ft', 1200],
    ['  7 FT  ', 'mm', 7 * FT],
    ['7 Ft', 'mm', 7 * FT],
    ['7’ 6”', 'mm', 7 * FT + 6 * IN],
    ['7′', 'mm', 7 * FT],
    ['7″', 'mm', 7 * IN],
    ["7''", 'mm', 7 * IN],
    ['+3m', 'ft', 3000],
    ['-3m', 'ft', -3000],
    ['- 3m', 'ft', -3000],
    ['3', 'm', 3000],
    ['3', 'cm', 30],
    ['3', 'in', 3 * IN],
    ['3', 'yd', 3 * 914.4],
    ['3', 'gaj', 3 * 914.4],
    ['3', 'hath', 3 * 457.2],
    ['3', 'ftin', 3 * FT],
    ['1/2', 'in', 0.5 * IN],
    ['5 1/2', 'in', 5.5 * IN],
    ['5-1/2', 'in', 5.5 * IN],
    ['12-6.5', 'mm', 12 * FT + 6.5 * IN],
    ['0', 'mm', 0],
    ['0\'0"', 'mm', 0],
    ['12\' - 6"', 'mm', 12 * FT + 6 * IN],
    ['12ft-6in', 'mm', 12 * FT + 6 * IN],
    ['1 foot', 'mm', FT],
    ['2 feet', 'mm', 2 * FT],
    ['1 inch', 'mm', IN],
    ['2 inches', 'mm', 2 * IN],
    ['2 meters', 'ft', 2000],
    ['100 yds', 'mm', 100 * 914.4],
  ];
  it.each(cases)('%s with default %s', (text, unit, expected) => {
    const r = parseLength(text, unit);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeCloseTo(expected, 6);
  });
  it('defaults to millimetres', () => {
    expect(parseLength('250')).toEqual({ ok: true, value: 250 });
  });
});

describe('parseLength gives a friendly hint instead of throwing', () => {
  it.each([
    '',
    '   ',
    'abc',
    '12 xyz',
    '1/0',
    '1/0 in',
    '5 1/0',
    "5' abc",
    '12..5',
    '--3',
    'm',
    '3 m m',
    '5 1/0 in',
  ])('rejects %j', (text) => {
    const r = parseLength(text, 'ft');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hint.length).toBeGreaterThan(5);
  });
});

describe('area, volume, weight and angle parsing', () => {
  const area: [string, number][] = [
    ['100 sq ft', 9.290304],
    ['100 sqft', 9.290304],
    ['100 sft', 9.290304],
    ['10 sq m', 10],
    ['10 sqm', 10],
    ['10 m2', 10],
    ['10 m²', 10],
    ['1 sq yd', 0.83612736],
    ['1 gaj', 0.83612736],
    ['1 cent', 40.47],
    ['1 guntha', 101.17],
    ['1 gunta', 101.17],
    ['1 acre', 4046.8564224],
    ['1 bigha', 1618],
    ['1 ankanam', 6.68901888],
    ['1 marla', 25.29285264],
    ['1 kani', 5351.2],
    ['1 ha', 10000],
    ['2 1/2 cent', 101.175],
  ];
  it.each(area)('area %s', (t, expected) => {
    const r = parseArea(t);
    expect(r.ok && r.value).toBeCloseTo(expected, 5);
  });
  it('uses the default area unit and bigha variant', () => {
    const plain = parseArea('100');
    expect(plain.ok && plain.value).toBeCloseTo(9.290304, 6);
    const b = parseArea('1 bigha', 'sqft', BIGHA_VARIANTS.bihar);
    expect(b.ok && b.value).toBeCloseTo(2529.3, 3);
  });
  it.each(['', 'x', '1 parsec', '1/0 sq ft'])('rejects area %j', (t) => {
    expect(parseArea(t).ok).toBe(false);
  });

  const volume: [string, number][] = [
    ['1 cu m', 1],
    ['1 cum', 1],
    ['1 m3', 1],
    ['1 m³', 1],
    ['100 cu ft', 2.8316846592],
    ['100 cft', 2.8316846592],
    ['1000 l', 1],
    ['1000 litres', 1],
    ['2', 2],
  ];
  it.each(volume)('volume %s', (t, expected) => {
    const r = parseVolume(t);
    expect(r.ok && r.value).toBeCloseTo(expected, 6);
  });
  it.each(['', 'lots', '1 barrel'])('rejects volume %j', (t) => {
    expect(parseVolume(t).ok).toBe(false);
  });

  const weight: [string, number][] = [
    ['50 kg', 50],
    ['2 quintal', 200],
    ['2 qtl', 200],
    ['1 tonne', 1000],
    ['1 ton', 1000],
    ['1 mt', 1000],
    ['2 bags', 100],
    ['1 bag', 50],
    ['7', 7],
  ];
  it.each(weight)('weight %s', (t, expected) => {
    const r = parseWeight(t);
    expect(r.ok && r.value).toBeCloseTo(expected, 6);
  });
  it.each(['', 'heavy', '1 stone'])('rejects weight %j', (t) => {
    expect(parseWeight(t).ok).toBe(false);
  });

  it.each([
    ['90', 90],
    ['45°', 45],
    ['30 deg', 30],
    ['15 degrees', 15],
    ['-90', -90],
    ['22.5', 22.5],
  ] as [string, number][])('angle %s', (t, expected) => {
    expect(parseAngle(t)).toEqual({ ok: true, value: expected });
  });
  it.each(['', 'north'])('rejects angle %j', (t) => {
    expect(parseAngle(t).ok).toBe(false);
  });
});

describe('conversions', () => {
  it.each([
    [1, 'ft', 'in', 12],
    [1, 'm', 'cm', 100],
    [1, 'gaj', 'm', 0.9144],
    [1, 'hath', 'm', 0.4572],
    [1, 'yd', 'ft', 3],
    [1000, 'mm', 'm', 1],
    [1, 'ftin', 'ft', 1],
  ] as [number, LengthUnit, LengthUnit, number][])('%d %s to %s', (v, a, b, expected) => {
    expect(convertLength(v, a, b)).toBeCloseTo(expected, 8);
  });
  it('length helpers round trip', () => {
    expect(mmToLength(lengthToMm(7.25, 'ft'), 'ft')).toBeCloseTo(7.25, 10);
  });
  it('area conversions match the specified Indian units', () => {
    expect(convertArea(1, 'cent', 'sqm')).toBeCloseTo(40.47, 6);
    expect(convertArea(1, 'guntha', 'sqm')).toBeCloseTo(101.17, 6);
    expect(convertArea(1, 'ankanam', 'sqft')).toBeCloseTo(72, 6);
    expect(convertArea(1, 'bigha', 'sqm')).toBeCloseTo(1618, 6);
    expect(convertArea(1, 'sqm', 'bigha', 2000)).toBeCloseTo(0.0005, 8);
    expect(convertArea(1, 'bigha', 'sqm', 2000)).toBeCloseTo(2000, 8);
    expect(convertArea(1, 'acre', 'sqft')).toBeCloseTo(43560, 3);
  });
  it('volume and weight conversions', () => {
    expect(convertVolume(1, 'cum', 'litre')).toBeCloseTo(1000, 8);
    expect(convertVolume(1, 'cum', 'cuft')).toBeCloseTo(35.3147, 3);
    expect(convertWeight(1, 'tonne', 'bag')).toBeCloseTo(20, 8);
    expect(convertWeight(1, 'quintal', 'kg')).toBe(100);
  });
  it('snapMm commits to the half millimetre grid', () => {
    expect(snapMm(10.26)).toBe(10.5);
    expect(snapMm(10.24)).toBe(10);
    expect(snapMm(-0.3)).toBe(-0.5);
  });
});

describe('formatting', () => {
  it.each([
    [3810, 'eighth', `12'6"`],
    [0, 'eighth', `0'0"`],
    [304.8, 'eighth', `1'0"`],
    [FT + 6.5 * IN, 'eighth', `1'6 1/2"`],
    [FT + 0.25 * IN, 'eighth', `1'1/4"`],
    [FT + 0.125 * IN, 'eighth', `1'1/8"`],
    [-FT, 'eighth', `-1'0"`],
    [FT + 3.3 * IN, 1, `1'3.3"`],
    [FT + 3.33 * IN, 2, `1'3.33"`],
    [FT + 3.4 * IN, 0, `1'3"`],
    [12 * IN - 0.02, 0, `1'0"`],
    [-FT, 2, `-1'0"`],
  ] as [number, 0 | 1 | 2 | 3 | 'eighth', string][])('feet and inches %d at %s', (mm, p, expected) => {
    expect(formatLength(mm, 'ftin', p)).toBe(expected);
  });
  it.each([
    [3200, 'm', 2, '3.2 m'],
    [3200, 'cm', 0, '320 cm'],
    [3200, 'mm', 0, '3200 mm'],
    [1234, 'm', 3, '1.234 m'],
    [FT, 'ft', 1, '1 ft'],
    [914.4, 'yd', 2, '1 yd'],
    [914.4, 'gaj', 2, '1 gaj'],
    [457.2, 'hath', 1, '1 hath'],
    [5.5 * IN, 'in', 'eighth', '5 1/2 in'],
    [-5.5 * IN, 'in', 'eighth', '-5 1/2 in'],
    [1500, 'm', 'eighth', '1.5 m'],
    [1500.4, 'mm', 'eighth', '1500 mm'],
  ] as [number, LengthUnit, 0 | 1 | 2 | 3 | 'eighth', string][])('%d in %s at %s', (mm, u, p, expected) => {
    expect(formatLength(mm, u, p)).toBe(expected);
  });
  it('uses two decimals by default', () => {
    expect(formatLength(1234.5, 'm')).toBe('1.23 m');
  });
  it('builds editable input text that parses back', () => {
    expect(lengthInputText(3810, 'ftin')).toBe(`12'6"`);
    expect(lengthInputText(3200, 'm')).toBe('3.2');
    const r = parseLength(lengthInputText(3810, 'ftin'), 'ftin');
    expect(r.ok && r.value).toBeCloseTo(3810, 6);
  });
  it('formats area, volume and weight with and without explicit decimals', () => {
    expect(formatArea(9.290304, 'sqft')).toBe('100 sq ft');
    expect(formatArea(10, 'sqm', 1)).toBe('10 sq m');
    expect(formatVolume(1, 'litre')).toBe('1000 litre');
    expect(formatVolume(1, 'cum', 1)).toBe('1 cu m');
    expect(formatWeight(100, 'bag')).toBe('2 bag');
    expect(formatWeight(100, 'kg', 0)).toBe('100 kg');
  });
  it.each([
    ['m', 'sqm'],
    ['cm', 'sqm'],
    ['mm', 'sqm'],
    ['yd', 'sqyd'],
    ['gaj', 'sqyd'],
    ['ft', 'sqft'],
    ['ftin', 'sqft'],
    ['in', 'sqft'],
  ] as [LengthUnit, string][])('area unit for %s', (u, expected) => {
    expect(areaUnitFor(u)).toBe(expected);
  });
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1,000'],
    [100000, '1,00,000'],
    [1234567, '12,34,567'],
    [-1234567, '-12,34,567'],
    [12345678.6, '1,23,45,679'],
    [-0.2, '0'],
  ] as [number, string][])('indian grouping %d', (v, expected) => {
    expect(formatIndian(v)).toBe(expected);
  });
});

describe('round trip across every length unit', () => {
  const units: LengthUnit[] = ['mm', 'cm', 'm', 'in', 'ft', 'ftin', 'yd', 'gaj', 'hath'];
  const values = [100, 230, 1200, 3048, 9144];
  const grid = units.flatMap((u) => values.map((v) => [u, v] as [LengthUnit, number]));
  it.each(grid)('%s keeps %d mm', (u, mm) => {
    const r = parseLength(lengthInputText(mm, u), u);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Math.abs(r.value - mm)).toBeLessThan(u === 'ftin' ? 3.2 : 0.6);
  });
});
