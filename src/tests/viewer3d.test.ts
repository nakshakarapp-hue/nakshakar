import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../catalog/templates';
import { stairLayout } from '../catalog/stairs';
import { createOpening, createProject, createWall } from '../core/model/defaults';
import { dist } from '../core/geometry/vec';
import type { Project, Vec2 } from '../core/model/types';
import { addWallLoop, syncRooms } from '../editor2d/commands';
import { floorPrims, textBox, visibleTexts, type Prim } from '../editor2d/drawing';
import { snap } from '../editor2d/snap';
import { defaultSettings } from '../core/model/defaults';
import { buildHouse } from '../viewer3d/builder';
import { collide, floorAtHeight, nextFeetHeight, standHeights } from '../viewer3d/walk';

const P = (x: number, y: number): Vec2 => ({ x, y });

function room(): Project {
  const p = createProject('R');
  const f = p.floors[0];
  addWallLoop(f, [P(0, 0), P(4000, 0), P(4000, 3000), P(0, 3000)], { thickness: 200, height: 3000 });
  syncRooms(f, 0);
  return p;
}

describe('3D geometry', () => {
  const sample = createSampleProject();
  const house = buildHouse(sample);

  it('stays light enough for a phone', () => {
    expect(house.triangles).toBeGreaterThan(1000);
    expect(buildHouse(createSampleProject(1)).triangles).toBeLessThan(120000);
    expect(house.buckets.length).toBeLessThanOrEqual(9);
  });
  it('produces only finite positions with matching attribute sizes', () => {
    for (const [, b] of house.buckets) {
      expect(b.positions.every(Number.isFinite)).toBe(true);
      expect(b.normals.length).toBe(b.positions.length);
      expect(b.colors.length).toBe(b.positions.length);
      expect(b.uvs.length / 2).toBe(b.positions.length / 3);
    }
  });
  it('builds walls to the height the user typed', () => {
    const p = room();
    p.roof.parapetHeight = 0;
    const tall = buildHouse(
      { ...p, floors: [{ ...p.floors[0], walls: p.floors[0].walls.map((w) => ({ ...w, height: 4200 })) }] },
      { hideRoof: true },
    );
    const ys = tall.buckets.flatMap(([, b]) => b.positions.filter((_, i) => i % 3 === 1));
    expect(Math.max(...ys)).toBeCloseTo(4.2, 3);
  });
  it('leaves a real hole where a window goes', () => {
    const p = room();
    const before = buildHouse(p, { hideRoof: true });
    p.floors[0].openings.push(
      createOpening(p.floors[0].walls[0].id, 2000, 'window', { sillHeight: 900, height: 1200, width: 1200 }),
    );
    const after = buildHouse(p, { hideRoof: true });
    expect(after.triangles).toBeGreaterThan(before.triangles);
    // Sample the wall's outer face at the middle of the window: no solid wall triangle may cover it.
    const face = after.buckets.find(([k]) => k === 'none')![1];
    let covering = 0;
    for (let i = 0; i < face.positions.length; i += 9) {
      const zs = [face.positions[i + 2], face.positions[i + 5], face.positions[i + 8]];
      const xs = [face.positions[i], face.positions[i + 3], face.positions[i + 6]];
      const ys = [face.positions[i + 1], face.positions[i + 4], face.positions[i + 7]];
      const onFace = zs.every((z) => Math.abs(z + 0.1) < 0.002);
      if (
        onFace &&
        Math.min(...xs) < 2 &&
        Math.max(...xs) > 2 &&
        Math.min(...ys) < 1.5 &&
        Math.max(...ys) > 1.5
      )
        covering += 1;
    }
    expect(covering).toBe(0);
  });
  it('opens doors towards the same side as the plan symbol', () => {
    const across = (swingDirection: 'in' | 'out') => {
      const p = room();
      // Clockwise outline: the first wall runs along the top, so inside the room is +y.
      p.floors[0].openings.push(
        createOpening(p.floors[0].walls[0].id, 2000, 'door', {
          swingDirection,
          shutterColor: '#123456',
          frameColor: '#ffffff',
        }),
      );
      const h = buildHouse(p, { hideRoof: true, doorsOpen: true });
      const leaf = h.buckets.find(([k]) => k === 'none')![1];
      const blue = leaf.colors[2];
      let reach = 0;
      for (let i = 0; i < leaf.positions.length; i += 3) {
        if (
          Math.abs(leaf.colors[i + 2] - 0) >= 0 &&
          Math.abs(leaf.colors[i + 2] - leaf.colors[i]) > 0.02 &&
          leaf.colors[i + 2] > leaf.colors[i]
        ) {
          const z = leaf.positions[i + 2];
          if (Math.abs(z) > Math.abs(reach)) reach = z;
        }
      }
      return { reach, blue };
    };
    expect(across('in').reach).toBeGreaterThan(0.5);
    expect(across('out').reach).toBeLessThan(-0.5);
  });
  it('puts the elevation colour outdoors even on walls drawn anticlockwise', () => {
    const faceColor = (points: Vec2[]) => {
      const p = createProject('D');
      addWallLoop(p.floors[0], points, {
        thickness: 200,
        leftColor: '#000000',
        rightColor: '#000000',
        skirtingHeight: 0,
      });
      syncRooms(p.floors[0], 0);
      p.elevationOverrides.wallColor = '#ff0000';
      const b = buildHouse(p, { hideRoof: true }).buckets.find(([k]) => k === 'none')![1];
      // Find a triangle on the outdoor face of the top wall.
      for (let i = 0; i < b.positions.length; i += 9) {
        if (
          Math.abs(b.positions[i + 2] + 0.1) < 0.001 &&
          Math.abs(b.positions[i + 5] + 0.1) < 0.001 &&
          Math.abs(b.positions[i + 8] + 0.1) < 0.001 &&
          Math.abs(b.normals[i + 2] + 1) < 0.01
        ) {
          return b.colors[i];
        }
      }
      return -1;
    };
    const cw = [P(0, 0), P(4000, 0), P(4000, 3000), P(0, 3000)];
    expect(faceColor(cw)).toBeGreaterThan(0.9);
    expect(faceColor([...cw].reverse())).toBeGreaterThan(0.9);
  });
  it('cuts away upper floors on request', () => {
    expect(buildHouse(sample, { topFloor: 0 }).triangles).toBeLessThan(house.triangles);
  });
  it('builds every roof type', () => {
    for (const type of ['flat', 'gable', 'hip', 'shed'] as const) {
      const p = room();
      p.roof.type = type;
      const withRoof = buildHouse(p);
      expect(withRoof.triangles, type).toBeGreaterThan(buildHouse(p, { hideRoof: true }).triangles);
    }
  });
  it('builds curved walls, gables and an empty project without failing', () => {
    const p = createProject('C');
    p.floors[0].walls.push(
      createWall(P(0, 0), P(4000, 0), { bulge: 1 }),
      createWall(P(4000, 0), P(0, 0), { bulge: 1, gableRise: 500 }),
    );
    syncRooms(p.floors[0], 0);
    expect(buildHouse(p).triangles).toBeGreaterThan(100);
    expect(buildHouse(createProject('E')).walk).toHaveLength(1);
  });
  it('starts the walkthrough just inside the main entrance', () => {
    expect(house.start.floorIndex).toBe(0);
    expect(house.start.z).toBeGreaterThan(0);
    expect(house.start.z).toBeLessThan(1.5);
    expect(house.start.x).toBeCloseTo(4.85, 2);
  });
});

describe('walking', () => {
  const p = createSampleProject();
  const house = buildHouse(p);
  const floors = p.floors.filter((f) => f.visible);

  it('stops at a wall', () => {
    const walk = house.walk[0];
    const out = collide(P(2000, 40), walk);
    expect(out.y).toBeGreaterThanOrEqual(219);
  });
  it('walks straight through a door gap', () => {
    const walk = house.walk[0];
    // Main door centre on the north wall.
    const at = P(4850, 0);
    expect(dist(collide(at, walk), at)).toBeLessThan(1);
  });
  it('is blocked by a window, because only doors are gaps', () => {
    const walk = house.walk[0];
    const onWindow = P(8000, 3800);
    expect(dist(collide(onWindow, walk), onWindow)).toBeGreaterThan(100);
  });
  it('climbs the stairs one step at a time and reaches the next floor', () => {
    const stair = floors[0].stairs[0];
    const layout = stairLayout(stair);
    let feet = 0;
    for (const step of layout.steps) {
      const box = step.polygon;
      const c = P(
        box.reduce((s, q) => s + q.x, 0) / box.length,
        box.reduce((s, q) => s + q.y, 0) / box.length,
      );
      feet = nextFeetHeight(feet, standHeights(c, house.walk, floors), -0.45);
      expect(feet).toBeCloseTo(step.z / 1000, 3);
    }
    expect(feet).toBeCloseTo(3.15, 3);
    expect(floorAtHeight(feet, house.walk)?.floorIndex).toBe(1);
  });
  it('comes back down the same way', () => {
    const layout = stairLayout(floors[0].stairs[0]);
    let feet = 3.15;
    for (const step of [...layout.steps].reverse()) {
      const c = P(
        step.polygon.reduce((s, q) => s + q.x, 0) / step.polygon.length,
        step.polygon.reduce((s, q) => s + q.y, 0) / step.polygon.length,
      );
      feet = nextFeetHeight(feet, standHeights(c, house.walk, floors), -0.45);
      expect(feet).toBeCloseTo(step.z / 1000, 3);
    }
  });
  it('stands on the floor it is on, and cannot step up through a ceiling', () => {
    const inRoom = P(5700, 4000);
    const heights = standHeights(inRoom, house.walk, floors);
    expect(heights).toContain(0);
    expect(nextFeetHeight(0, heights, -0.45)).toBe(0);
    expect(nextFeetHeight(3.15, heights, -0.45)).toBeCloseTo(3.15, 3);
  });
  it('drops to the ground outside the house', () => {
    expect(nextFeetHeight(0, standHeights(P(-6000, -6000), house.walk, floors), -0.45)).toBe(-0.45);
  });
});

describe('plan drawing', () => {
  const settings = defaultSettings();
  const opt = { settings, ink: '#000000', muted: '#555555', wallFill: '#cccccc', paper: '#ffffff' };

  it('draws every floor of the sample', () => {
    for (const f of createSampleProject().floors) expect(floorPrims(f, opt).length).toBeGreaterThan(10);
  });
  it('honours hidden categories and the dimension switch', () => {
    const f = createSampleProject().floors[0];
    const count = (x: Prim[]) => x.filter((q) => q.t === 'text').length;
    const all = count(floorPrims(f, opt));
    expect(count(floorPrims(f, { ...opt, settings: { ...settings, showDimensions: false } }))).toBeLessThan(
      all,
    );
    expect(count(floorPrims({ ...f, hiddenCategories: ['dimensions'] }, opt))).toBeLessThan(all);
  });
  it('keeps room names ahead of dimensions when text collides', () => {
    const dim: Prim = { t: 'text', at: P(0, 0), s: 'dim', size: 10, color: '#000' };
    const name: Prim = { t: 'text', at: P(0, 0), s: 'Kitchen', size: 10, color: '#000' };
    const far: Prim = { t: 'text', at: P(500, 0), s: 'far', size: 10, color: '#000' };
    const shown = visibleTexts([dim, far, name], (q) => textBox(q.at.x, q.at.y, 40, 10, 'center', undefined));
    expect(shown.has(name)).toBe(true);
    expect(shown.has(far)).toBe(true);
    expect(shown.has(dim)).toBe(false);
  });
  it('shows every room name on a small screen, even with wide size labels beside it', () => {
    const f = createSampleProject().floors[0];
    const prims = floorPrims(f, opt);
    const zoom = 0.045;
    const shown = visibleTexts(prims, (q) => {
      const size = q.size * 1.25;
      return textBox(
        q.at.x * zoom,
        q.at.y * zoom,
        q.s.length * size * 0.56 + 4,
        size * 1.2,
        q.align,
        q.angle,
      );
    });
    const names = [...shown].map((q) => (q as { s: string }).s);
    for (const r of f.rooms) expect(names, r.name).toContain(r.name);
  });
  it('turns the label box for vertical text', () => {
    const b = textBox(0, 0, 40, 10, 'center', 90);
    expect(b.x1 - b.x0).toBe(10);
    expect(b.y1 - b.y0).toBe(40);
    expect(textBox(0, 0, 40, 10, 'right', 0).x1).toBe(0);
    expect(textBox(0, 0, 40, 10, 'left', 0).x0).toBe(0);
  });
});

describe('snapping', () => {
  const settings = defaultSettings();
  const floor = { walls: [createWall(P(0, 0), P(4000, 0), { thickness: 200 })] };
  const ctx = { floor, settings, tolerance: 150 };

  it('prefers wall ends over everything else', () => {
    expect(snap(P(3950, 40), ctx)).toMatchObject({ point: P(4000, 0), kind: 'endpoint' });
  });
  it('finds midpoints', () => {
    expect(snap(P(2040, 30), ctx)).toMatchObject({ point: P(2000, 0), kind: 'midpoint' });
  });
  it('falls back to the grid', () => {
    expect(snap(P(1234, 2345), ctx)).toMatchObject({ point: P(1200, 2300), kind: 'grid' });
  });
  it('locks to common angles from the anchor', () => {
    const r = snap(P(1000, 1030), { ...ctx, floor: { walls: [] }, anchor: P(0, 0) });
    expect(r.kind).toBe('angle');
    expect(r.point.x).toBeCloseTo(r.point.y, 6);
  });
  it('constrains to 45 degree steps with Shift even when snapping is off', () => {
    const off = { ...settings, snapEnabled: false };
    const r = snap(P(1000, 200), {
      floor: { walls: [] },
      settings: off,
      tolerance: 10,
      anchor: P(0, 0),
      constrain: true,
    });
    expect(r.point.y).toBeCloseTo(0, 6);
  });
  it('does nothing when switched off', () => {
    expect(snap(P(3950, 40), { ...ctx, settings: { ...settings, snapEnabled: false } })).toMatchObject({
      point: P(3950, 40),
      kind: 'none',
    });
  });
  it('respects each toggle', () => {
    const noEnds = {
      ...settings,
      snapOptions: { ...settings.snapOptions, endpoint: false, intersection: false },
    };
    expect(snap(P(3950, 40), { ...ctx, settings: noEnds }).kind).not.toBe('endpoint');
  });
  it('ignores the wall being dragged', () => {
    const r = snap(P(3950, 40), { ...ctx, ignoreIds: new Set([floor.walls[0].id]) });
    expect(r.kind).not.toBe('endpoint');
  });
});
