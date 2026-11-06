import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import hi from '../locales/hi.json';
import te from '../locales/te.json';
import ta from '../locales/ta.json';
import kn from '../locales/kn.json';
import ml from '../locales/ml.json';
import mr from '../locales/mr.json';
import gu from '../locales/gu.json';
import bn from '../locales/bn.json';
import { OBJECTS, OPENING_TYPES, PLANTS, STAIR_TYPES, ELEVATION_STYLES } from '../catalog/catalog';
import { RATE_DEFS } from '../estimate/rates';

const EN = en as Record<string, string>;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'tests' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const full: [string, Record<string, string>][] = [
  ['hi', hi],
  ['te', te],
];

describe('translations', () => {
  it.each(full)('%s is complete and has no stray keys', (_name, dict) => {
    expect(Object.keys(EN).filter((k) => !(k in dict))).toEqual([]);
    expect(Object.keys(dict).filter((k) => !(k in EN))).toEqual([]);
    for (const [k, v] of Object.entries(dict)) expect(v.trim(), k).not.toBe('');
  });
  it.each(full)('%s keeps every {placeholder}', (_name, dict) => {
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const [k, v] of Object.entries(EN)) expect(holes(dict[k]), k).toBe(holes(v));
  });
  it('partial languages only use real keys, so they fall back to English cleanly', () => {
    for (const dict of [ta, kn, ml, mr, gu, bn] as Record<string, string>[]) {
      expect(Object.keys(dict).length).toBeGreaterThan(20);
      expect(Object.keys(dict).filter((k) => !(k in EN))).toEqual([]);
    }
  });
  it('every static key used in the code exists in English', () => {
    const missing = new Set<string>();
    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\b(?:t|L)\(\s*'([a-zA-Z0-9_.]+)'(\s*,)?/g)) {
        if (!m[2] && !(m[1] in EN)) missing.add(m[1]);
      }
    }
    expect([...missing]).toEqual([]);
  });
  it('every catalogue entry and rate has a translatable name', () => {
    for (const x of [...OBJECTS, ...OPENING_TYPES, ...PLANTS, ...STAIR_TYPES, ...ELEVATION_STYLES]) {
      expect(EN[`obj.${x.id}`], x.id).toBeDefined();
    }
    for (const r of RATE_DEFS) expect(EN[`rate.${r.key}`], r.key).toBeDefined();
  });
});
