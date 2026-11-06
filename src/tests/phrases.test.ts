import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createSampleProject } from '../catalog/templates';
import { createProject } from '../core/model/defaults';
import { estimateProject } from '../estimate/estimate';
import { assessVastu } from '../vastu/rules';
import { addWallLoop, syncRooms } from '../editor2d/commands';
import { createSlab } from '../core/model/defaults';
import en from '../locales/en.json';
import phrases from '../locales/phrases.json';
it('every sentence the estimate, Vastu check and history can produce has Hindi and Telugu', () => {
  const out = new Set<string>();
  const num = (s: string) => s.replace(/\d[\d,]*(?:\.\d+)?/g, '#');
  const estimate = (p: ReturnType<typeof createProject>) => {
    const e = estimateProject(p);
    for (const l of e.lines) {
      for (const part of num(l.name).split(': ')) out.add(part);
      out.add(l.unit);
      out.add(num(l.assumption));
    }
    e.assumptions.forEach((a) => out.add(num(a)));
    e.curing.forEach((c) => {
      out.add(c.element);
      out.add(num(c.note));
    });
    e.materials.forEach((m) => out.add(m.unit));
    e.defaultRatesUsed.forEach((r) => out.add(r));
  };
  for (const foundation of ['isolated', 'strip', 'raft'] as const) {
    for (const cementType of ['OPC', 'PPC'] as const) {
      const p = createSampleProject();
      p.estimate.foundation = foundation;
      p.estimate.cementType = cementType;
      p.estimate.includeCompound = true;
      p.estimate.includeInteriors = true;
      p.roof.type = 'hip';
      p.floors[0].slabs.push(
        createSlab([
          { x: 0, y: 0 },
          { x: 2000, y: 0 },
          { x: 2000, y: 2000 },
        ]),
      );
      p.floors[0].pillars = [];
      p.floors[0].openings[0].costOverride = 100;
      estimate(p);
      estimate({ ...p, floors: p.floors.slice(0, 2) });
    }
  }
  estimate(createSampleProject());
  const noExtras = createSampleProject();
  noExtras.floors[0].rooms[1].ceilingType = 'pop';
  noExtras.estimate.includeInteriors = true;
  estimate(noExtras);
  const bare = createProject('B');
  addWallLoop(bare.floors[0], [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 3000 },
    { x: 0, y: 3000 },
  ]);
  syncRooms(bare.floors[0], 0);
  estimate(bare);
  // Vastu templates, read straight from the source so every branch is covered.
  const rules = readFileSync('src/vastu/rules.ts', 'utf8');
  for (const m of rules.matchAll(/said\('([^']+)'/g)) out.add(m[1]);
  assessVastu(createSampleProject()).findings.forEach((f) => out.add(f.suggestion));
  for (const m of rules.matchAll(/advice|'([A-Z][^']{18,})'/g))
    if (m[1] && !m[1].includes('{')) out.add(m[1]);
  // History step names.
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) =>
      statSync(join(d, n)).isDirectory() ? (n === 'tests' ? [] : walk(join(d, n))) : [join(d, n)],
    );
  for (const f of walk('src').filter((x) => /\.tsx?$/.test(x))) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/(?:commitFloor|commit|commitFrom)\((?:[a-zA-Z.]+, )?\s*'([^']+)'/g))
      out.add(m[1]);
    for (const m of text.matchAll(/\bedit\('([^']+)'/g)) out.add(m[1]);
    for (const m of text.matchAll(/name: '((?:Move|Change)[^']+)'/g)) out.add(m[1]);
  }
  for (const n of [
    'Delete # items',
    'Move # items',
    'Delete item',
    'Add {x}',
    'Apply {x}',
    'Restore {x}',
    'Set rate',
    'Room #',
    'Floor #',
    'Ground Floor',
    'First Floor',
    'Basement',
    'Terrace',
    'Main road side',
    'Sample two-storey house',
    'Sample three-storey house',
    'Toilet',
    'Guest Bedroom',
    'Entrance Foyer',
    'Pooja',
    'Living Room',
    'Master Bedroom',
    'Dining',
    'Staircase',
    'Utility',
    'Kitchen',
    'Bathroom',
    'Kids Room',
    'Family Lounge',
    'Master Bedroom #',
    'Passage',
    'Study',
    'Upper Floor #',
    'Road side',
    'Slope falls towards',
    'Borewell',
    'Underground sump',
    'Overhead tank',
    'Septic tank',
    'Queen bed',
    'Single bed',
    'Neem tree',
  ])
    out.add(n);
  const known = new Set(Object.values(en as Record<string, string>));
  const table = phrases as Record<string, string[]>;
  const missing = [...out].filter(Boolean).filter((x) => !known.has(x) && !(table[x]?.[0] && table[x]?.[1]));
  expect(missing).toEqual([]);
});
