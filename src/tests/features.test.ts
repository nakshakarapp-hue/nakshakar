import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../catalog/templates';
import { OBJECTS, OPENING_TYPES, PLANTS, STAIR_TYPES } from '../catalog/catalog';
import { stairComfort, stairHeightAt, stairLayout } from '../catalog/stairs';
import { createFloor, createObject, createProject, createStair, createWall } from '../core/model/defaults';
import { polygonArea } from '../core/geometry/polygon';
import { assessVastu, openingFacing } from '../vastu/rules';
import { estimateProject } from '../estimate/estimate';
import { addWallLoop, syncRooms } from '../editor2d/commands';
import { createOpening } from '../core/model/defaults';
import type { Project, RoomType, StairShape, Vec2 } from '../core/model/types';

const P = (x: number, y: number): Vec2 => ({ x, y });

describe('catalogue', () => {
  it('every object part references a colour it defines and stays in bounds', () => {
    for (const obj of OBJECTS) {
      expect(obj.width, obj.id).toBeGreaterThan(0);
      for (const part of obj.parts) {
        expect(obj.colors[part.c], `${obj.id} ${part.c}`).toBeDefined();
        expect(part.x + part.w, obj.id).toBeLessThanOrEqual(1.0001);
        expect(part.y + part.d, obj.id).toBeLessThanOrEqual(1.0001);
        expect(part.z + part.h, obj.id).toBeLessThanOrEqual(1.0001);
      }
    }
  });
  it('has unique ids and enough variety', () => {
    const ids = [...OBJECTS, ...OPENING_TYPES, ...STAIR_TYPES, ...PLANTS].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(OBJECTS.length).toBeGreaterThanOrEqual(40);
  });
});

describe('stairs', () => {
  it.each(['straight', 'l', 'u', 'spiral'] as StairShape[])('%s reaches the full rise', (shape) => {
    const s = createStair(P(0, 0), { shape, totalRise: 3150, riser: 170, tread: 250, width: 1000 });
    const layout = stairLayout(s);
    expect(layout.risers).toBe(19);
    expect(layout.steps[layout.steps.length - 1].z).toBeCloseTo(3150, 6);
    expect(layout.steps).toHaveLength(19);
    expect(polygonArea(layout.outline)).toBeGreaterThan(0);
  });
  it('every step of a U stair sits within its outline', () => {
    const s = createStair(P(500, 500), { shape: 'u', width: 1000 });
    const layout = stairLayout(s);
    const xs = layout.outline.map((p) => p.x);
    const ys = layout.outline.map((p) => p.y);
    for (const st of layout.steps) {
      for (const p of st.polygon) {
        expect(p.x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-6);
        expect(p.x).toBeLessThanOrEqual(Math.max(...xs) + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-6);
        expect(p.y).toBeLessThanOrEqual(Math.max(...ys) + 1e-6);
      }
    }
  });
  it('follows rotation and reports walking height', () => {
    const s = createStair(P(0, 0), {
      shape: 'straight',
      tread: 250,
      width: 1000,
      totalRise: 1700,
      riser: 170,
    });
    expect(stairHeightAt(s, P(500, -125))).toBeCloseTo(170, 6);
    expect(stairHeightAt(s, P(500, -2375))).toBeCloseTo(1700, 6);
    expect(stairHeightAt(s, P(5000, 5000))).toBeNull();
    const turned = createStair(P(0, 0), {
      shape: 'straight',
      tread: 250,
      width: 1000,
      totalRise: 1700,
      riser: 170,
    });
    turned.transform.rotation = 90;
    expect(stairHeightAt(turned, P(125, 500))).toBeCloseTo(170, 6);
  });
  it('flags uncomfortable stairs', () => {
    expect(stairComfort(createStair(P(0, 0), { riser: 170, tread: 250 })).comfortable).toBe(true);
    expect(stairComfort(createStair(P(0, 0), { riser: 300, tread: 200, totalRise: 3000 })).comfortable).toBe(
      false,
    );
  });
});

describe('sample project', () => {
  const p = createSampleProject();
  it('has the expected floors and named rooms', () => {
    expect(p.floors.map((f) => f.name)).toEqual(['Ground Floor', 'First Floor', 'Terrace']);
    expect(p.floors[0].rooms).toHaveLength(10);
    expect(p.floors[1].rooms).toHaveLength(7);
    expect(p.floors[2].rooms).toHaveLength(1);
    for (const f of p.floors) for (const r of f.rooms) expect(r.userNamed, r.name).toBe(true);
  });
  it('keeps every opening inside its wall', () => {
    for (const f of p.floors) {
      for (const o of f.openings) {
        const w = f.walls.find((x) => x.id === o.wallId)!;
        const l = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
        expect(o.position - o.width / 2).toBeGreaterThanOrEqual(0);
        expect(o.position + o.width / 2).toBeLessThanOrEqual(l);
      }
    }
  });
  it('fits its stairs in the staircase room', () => {
    const f = p.floors[0];
    const room = f.rooms.find((r) => r.type === 'staircase')!;
    const roomXs = room.polygon.map((q) => q.x);
    const roomYs = room.polygon.map((q) => q.y);
    for (const q of stairLayout(f.stairs[0]).outline) {
      expect(q.x).toBeGreaterThanOrEqual(Math.min(...roomXs));
      expect(q.x).toBeLessThanOrEqual(Math.max(...roomXs));
      expect(q.y).toBeGreaterThanOrEqual(Math.min(...roomYs));
      expect(q.y).toBeLessThanOrEqual(Math.max(...roomYs));
    }
  });
  it('can be saved as JSON and read back unchanged', () => {
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });
});

function vastuProject(types: Record<string, [Vec2, RoomType]>): Project {
  const project = createProject('V');
  const f = project.floors[0];
  addWallLoop(f, [P(0, 0), P(9000, 0), P(9000, 9000), P(0, 9000)], { thickness: 200 });
  f.walls.push(
    createWall(P(3000, 0), P(3000, 9000), { thickness: 100 }),
    createWall(P(6000, 0), P(6000, 9000), { thickness: 100 }),
    createWall(P(0, 3000), P(9000, 3000), { thickness: 100 }),
    createWall(P(0, 6000), P(9000, 6000), { thickness: 100 }),
  );
  syncRooms(f, 0);
  for (const [at, type] of Object.values(types)) {
    const r = f.rooms.find(
      (x) => Math.abs(x.centroid.x - at.x) < 200 && Math.abs(x.centroid.y - at.y) < 200,
    )!;
    r.type = type;
    r.name = type;
  }
  return project;
}

describe('vastu', () => {
  const NE = P(7500, 1500);
  const SE = P(7500, 7500);
  const SW = P(1500, 7500);
  const NW = P(1500, 1500);
  const C = P(4500, 4500);

  it('gives nothing to score on an empty project', () => {
    const r = assessVastu(createProject('E'));
    expect(r.findings.find((f) => f.ruleId === 'entrance')?.status).toBe('na');
    expect(r.findings.find((f) => f.ruleId === 'road_side')?.status).toBe('na');
  });
  it('scores classic placement above a reversed plan', () => {
    const good = vastuProject({
      a: [SE, 'kitchen'],
      b: [SW, 'master_bedroom'],
      c: [NE, 'pooja'],
      d: [NW, 'toilet'],
    });
    const bad = vastuProject({
      a: [NE, 'kitchen'],
      b: [SE, 'master_bedroom'],
      c: [SW, 'pooja'],
      d: [C, 'toilet'],
    });
    const g = assessVastu(good);
    const b = assessVastu(bad);
    expect(g.score!).toBeGreaterThan(b.score!);
    for (const id of ['kitchen', 'master_bedroom', 'pooja', 'toilet']) {
      expect(g.findings.find((f) => f.ruleId === id)?.status, id).toBe('good');
      const poor = b.findings.find((f) => f.ruleId === id);
      expect(poor?.status, id).toBe('poor');
      expect(poor?.suggestion.length, id).toBeGreaterThan(0);
    }
    expect(b.findings.find((f) => f.ruleId === 'brahmasthan')?.status).toBe('poor');
    expect(g.findings.find((f) => f.ruleId === 'brahmasthan')?.status).toBe('good');
  });
  it('turning north changes the outcome', () => {
    const p = vastuProject({ a: [SE, 'kitchen'] });
    expect(assessVastu(p).findings.find((f) => f.ruleId === 'kitchen')?.status).toBe('good');
    // Turned 180 degrees the same corner becomes the north-west: the accepted alternative, not the best.
    p.settings.northAngleDeg = 180;
    syncRooms(p.floors[0], 180);
    expect(assessVastu(p).findings.find((f) => f.ruleId === 'kitchen')?.status).toBe('okay');
    // Turned 90 degrees clockwise, it becomes the north-east, which is wrong for a kitchen.
    p.settings.northAngleDeg = 90;
    syncRooms(p.floors[0], 90);
    expect(assessVastu(p).findings.find((f) => f.ruleId === 'kitchen')?.status).toBe('poor');
  });
  it('reads the entrance direction from the wall it is on', () => {
    const p = vastuProject({});
    const f = p.floors[0];
    const northWall = f.walls[0];
    const door = createOpening(northWall.id, 1500, 'door', { isMainEntrance: true });
    f.openings.push(door);
    expect(openingFacing(door, northWall, f, 0)).toBe('N');
    expect(assessVastu(p).findings.find((x) => x.ruleId === 'entrance')?.status).toBe('good');
    const southWall = f.walls[2];
    const back = createOpening(southWall.id, 1500, 'door');
    expect(openingFacing(back, southWall, f, 0)).toBe('S');
  });
  it('checks bed heads, stoves, trees and water points', () => {
    const p = vastuProject({ a: [SE, 'kitchen'] });
    const f = p.floors[0];
    const bed = createObject(
      'bed_queen',
      P(1500, 7500),
      { width: 1500, depth: 2000, height: 900 },
      'Bed',
      {},
    );
    bed.transform.rotation = 180;
    f.objects.push(bed);
    f.objects.push(
      createObject('stove', P(8500, 8500), { width: 750, depth: 500, height: 100 }, 'Stove', {}),
    );
    f.plumbing.push({ id: 'b', at: P(8500, 500), kind: 'borewell', note: '' });
    const r = assessVastu(p);
    expect(r.findings.find((x) => x.ruleId === 'bed_head')?.status).toBe('good');
    expect(r.findings.find((x) => x.ruleId === 'stove')?.status).toBe('good');
    expect(r.findings.find((x) => x.ruleId === 'water_source')?.status).toBe('good');
  });
  it('can exclude rules from the score', () => {
    const p = vastuProject({ a: [NE, 'kitchen'] });
    const before = assessVastu(p).score!;
    p.vastu.ignoredRules = ['kitchen'];
    expect(assessVastu(p).score!).toBeGreaterThan(before);
  });
  it('assesses the sample house', () => {
    const r = assessVastu(createSampleProject());
    expect(r.score).toBeGreaterThan(40);
    expect(r.assessed).toBeGreaterThan(15);
    expect(r.findings.find((f) => f.ruleId === 'entrance')?.status).toBe('good');
  });
});

describe('estimate', () => {
  const sample = estimateProject(createSampleProject());
  it('reports nothing for an empty project', () => {
    const e = estimateProject(createProject('E'));
    expect(e.isEmpty).toBe(true);
    expect(e.total.likely).toBe(0);
    expect(e.schedule).toHaveLength(0);
  });
  it('never gives a single number: every range is ordered', () => {
    const ordered = (r: { min: number; likely: number; max: number }, label: string) => {
      expect(r.min, label).toBeLessThanOrEqual(r.likely);
      expect(r.likely, label).toBeLessThanOrEqual(r.max);
    };
    expect(sample.lines.length).toBeGreaterThan(25);
    for (const l of sample.lines) {
      ordered(l.quantity, l.name);
      ordered(l.cost, l.name);
      expect(l.assumption.length, l.name).toBeGreaterThan(3);
    }
    sample.materials.forEach((m) => ordered(m.quantity, m.name));
    sample.schedule.forEach((t) => ordered(t.days, t.name));
    sample.curing.forEach((t) => ordered(t.cureDays, t.element));
    ordered(sample.total, 'total');
    ordered(sample.totalDays, 'days');
    expect(sample.total.max).toBeGreaterThan(sample.total.min);
    expect(sample.totalDays.max).toBeGreaterThan(sample.totalDays.min);
  });
  it('stage totals and contingency add up to the grand total', () => {
    const sum = sample.stages.reduce((s, x) => s + x.cost.likely, 0) + sample.contingency.likely;
    expect(sum).toBeCloseTo(sample.total.likely, 3);
  });
  it('gives plausible magnitudes for the two-storey sample', () => {
    // 88 sq m footprint over two storeys: about 176 sq m (1900 sq ft) built-up.
    expect(sample.builtUpSqm).toBeGreaterThan(170);
    expect(sample.builtUpSqm).toBeLessThan(190);
    expect(sample.perSqft.likely).toBeGreaterThan(900);
    expect(sample.perSqft.likely).toBeLessThan(4000);
    const cement = sample.materials.find((m) => m.key === 'cement')!.quantity.likely;
    expect(cement / sample.builtUpSqm).toBeGreaterThan(1);
    expect(cement / sample.builtUpSqm).toBeLessThan(8);
    const steel = sample.materials.find((m) => m.key === 'steel')!.quantity.likely;
    expect(steel / sample.builtUpSqm).toBeGreaterThan(10);
    expect(steel / sample.builtUpSqm).toBeLessThan(60);
    expect(sample.totalDays.likely).toBeGreaterThan(60);
    expect(sample.totalDays.likely).toBeLessThan(400);
  });
  it('measures brick quantity from real wall volume', () => {
    const p = createProject('B');
    const f = createFloor('G', 0, 0);
    f.walls.push(createWall(P(0, 0), P(10000, 0), { thickness: 230, height: 3000 }));
    p.floors = [f];
    const e = estimateProject(p);
    const bricks = e.materials.find((m) => m.key === 'unit_red_brick')!.quantity;
    // 10 m x 3 m x 0.23 m = 6.9 cu m at 500 per cu m plus 5% wastage.
    expect(bricks.likely).toBeCloseTo(6.9 * 500 * 1.05, 1);
    expect(bricks.max).toBeGreaterThan(bricks.likely);
  });
  it('deducts openings from masonry', () => {
    const p = createProject('B');
    const f = p.floors[0];
    f.walls.push(createWall(P(0, 0), P(10000, 0), { thickness: 230, height: 3000 }));
    const before = estimateProject(p).materials.find((m) => m.key === 'unit_red_brick')!.quantity.likely;
    f.openings.push(createOpening(f.walls[0].id, 3000, 'door', { width: 1000, height: 2000 }));
    const after = estimateProject(p).materials.find((m) => m.key === 'unit_red_brick')!.quantity.likely;
    expect(after).toBeCloseTo(before - 2 * 0.23 * 500 * 1.05, 1);
  });
  it('typed rates change the total and stop being flagged as defaults', () => {
    const p = createSampleProject();
    const base = estimateProject(p);
    expect(base.defaultRatesUsed).toContain('Cement');
    p.estimate.rates.cement = 800;
    const dear = estimateProject(p);
    expect(dear.total.likely).toBeGreaterThan(base.total.likely);
    expect(dear.defaultRatesUsed).not.toContain('Cement');
  });
  it('quality, interiors and compound change the scope', () => {
    const p = createSampleProject();
    const base = estimateProject(p).total.likely;
    p.estimate.quality = 'premium';
    const premium = estimateProject(p).total.likely;
    expect(premium).toBeGreaterThan(base);
    p.estimate.includeInteriors = true;
    p.estimate.includeCompound = true;
    const e = estimateProject(p);
    expect(e.total.likely).toBeGreaterThan(premium);
    expect(e.lines.some((l) => l.id === 'modular_kitchen')).toBe(true);
    expect(e.lines.some((l) => l.id === 'compound')).toBe(true);
  });
  it('uses IS 456 curing periods by cement type', () => {
    const p = createSampleProject();
    p.estimate.cementType = 'OPC';
    expect(estimateProject(p).curing[0].cureDays.min).toBe(7);
    p.estimate.cementType = 'PPC';
    expect(estimateProject(p).curing[0].cureDays.min).toBe(10);
    const slab = sample.curing.find((c) => c.element === 'Slabs, span over 4.5 m')!;
    expect(slab.stripDays?.min).toBe(14);
  });
  it('estimates every foundation type and the sloped roof', () => {
    for (const foundation of ['isolated', 'strip', 'raft'] as const) {
      const p = createSampleProject();
      p.estimate.foundation = foundation;
      expect(
        estimateProject(p).lines.some((l) => l.id === 'excavation'),
        foundation,
      ).toBe(true);
    }
    const p = createSampleProject();
    p.roof.type = 'hip';
    expect(estimateProject(p).lines.some((l) => l.id === 'roof_cover')).toBe(true);
  });
  it('honours a price typed on one opening', () => {
    const p = createProject('O');
    const f = p.floors[0];
    f.walls.push(createWall(P(0, 0), P(4000, 0)));
    f.openings.push(createOpening(f.walls[0].id, 1000, 'door', { costOverride: 12345 }));
    const line = estimateProject(p).lines.find((l) => l.id === 'opening_overrides')!;
    expect(line.cost.likely).toBe(12345);
  });
});
