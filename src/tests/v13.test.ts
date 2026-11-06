import { describe, expect, it } from 'vitest';
import { stairHeightAt, stairLayout } from '../catalog/stairs';
import { bbox, pointInPolygon } from '../core/geometry/polygon';
import {
  emptyHistory,
  pushEntry,
  redoOnFloor,
  runCommand,
  undoOnFloor,
  undoTarget, undoStep,
  type HistoryState,
} from '../core/history/history';
import {
  createFloor,
  createObject,
  createProject,
  createSlab,
  createStair,
  createWall,
} from '../core/model/defaults';
import type { Project, Stair } from '../core/model/types';
import {
  ownCopy,
  packShared,
  readShared,
  shareFileName,
  SharedFileError,
  sharedSummary,
} from '../core/storage/shared';
import { mirrorItems, rotateItems, setSlabSize } from '../editor2d/commands';
import { itemHandles, setStairRotation, stairCenter } from '../editor2d/handles';
import { sizeFields } from '../ui/SizePopover';
import { buildHouse } from '../viewer3d/builder';

const building = () => {
  const p = createProject('Two floors');
  p.floors.push(createFloor('First Floor', 1, p.floors[0].floorToFloor));
  return p;
};
const addWall = (p: Project, h: HistoryState, floor: number, x: number) => {
  const done = runCommand(p, `Wall ${x}`, (d) => {
    d.floors[floor].walls.push(createWall({ x, y: 0 }, { x: x + 1000, y: 0 }));
    d.updatedAt = Date.now();
  })!;
  return { p: done.project, h: pushEntry(h, done.entry) };
};

describe('undo works floor by floor', () => {
  it('undoing on one floor leaves the other floor alone', () => {
    let p = building();
    let h = emptyHistory();
    ({ p, h } = addWall(p, h, 1, 0)); // first floor
    ({ p, h } = addWall(p, h, 0, 500)); // ground floor, later
    ({ p, h } = addWall(p, h, 1, 2000)); // first floor, latest
    const ground = p.floors[0].id;
    const first = p.floors[1].id;

    // On the ground floor, undo takes back the ground wall, though a first-floor step is newer.
    const a = undoOnFloor(p, h, ground)!;
    expect(a.project.floors[0].walls).toHaveLength(0);
    expect(a.project.floors[1].walls).toHaveLength(2);
    // Nothing more on this floor.
    expect(undoOnFloor(a.project, a.state, ground)).toBeNull();
    expect(undoTarget(a.state, ground)).toBeNull();

    // The first floor keeps its own order.
    const b = undoOnFloor(a.project, a.state, first)!;
    expect(b.project.floors[1].walls.map((w) => w.start.x)).toEqual([0]);

    // Redo brings back only this floor's step.
    const c = redoOnFloor(b.project, b.state, ground)!;
    expect(c.project.floors[0].walls).toHaveLength(1);
    expect(c.project.floors[1].walls).toHaveLength(1);
  });

  it('a new change on a floor only clears redo for that floor', () => {
    let p = building();
    let h = emptyHistory();
    ({ p, h } = addWall(p, h, 0, 0));
    ({ p, h } = addWall(p, h, 1, 0));
    const ground = p.floors[0].id;
    const first = p.floors[1].id;
    const u1 = undoOnFloor(p, h, ground)!;
    const u2 = undoOnFloor(u1.project, u1.state, first)!;
    const again = addWall(u2.project, u2.state, 0, 700);
    expect(redoOnFloor(again.p, again.h, ground)).toBeNull();
    expect(redoOnFloor(again.p, again.h, first)).not.toBeNull();
  });

  it('undo still finds the right floor after floors change places', () => {
    let p = building();
    let h = emptyHistory();
    ({ p, h } = addWall(p, h, 1, 0));
    const first = p.floors[1].id;
    // Change places, then undo the swap first: a step across floors goes back in order.
    const moved = runCommand(p, 'Move floor', (d) => {
      [d.floors[0], d.floors[1]] = [d.floors[1], d.floors[0]];
    })!;
    const q = moved.project;
    const hh = pushEntry(h, moved.entry);
    const other = q.floors.find((f) => f.id !== first)!.id;
    // Moving floors is a step for the whole house: no floor's Undo takes it back.
    expect(undoTarget(hh, other)).toBeNull();
    // The floor's own wall is still undone, wherever the floor now is.
    const a = undoOnFloor(q, hh, first)!;
    expect(a.project.floors[0].id).toBe(first);
    expect(a.project.floors[0].walls).toHaveLength(0);
    // The History list goes back through the move.
    const b = undoStep(q, hh)!;
    expect(b.project.floors[1].id).toBe(first);
  });

  it('a floor-only step applies to its floor even after the floors moved', () => {
    let p = building();
    let h = emptyHistory();
    const first = p.floors[1].id;
    ({ p, h } = addWall(p, h, 1, 0));
    // The floors are swapped without history, as a redo of an older swap could leave them.
    const swapped: Project = { ...p, floors: [p.floors[1], p.floors[0]] };
    const a = undoOnFloor(swapped, h, first)!;
    expect(a.project.floors[0].id).toBe(first);
    expect(a.project.floors[0].walls).toHaveLength(0);
  });

  it('a step across several floors waits for later work elsewhere', () => {
    let p = building();
    let h = emptyHistory();
    const across = runCommand(p, 'Set height on all floors', (d) => {
      d.floors.forEach((f) => (f.floorToFloor = 3300));
    })!;
    p = across.project;
    h = pushEntry(h, across.entry);
    ({ p, h } = addWall(p, h, 1, 0));
    const ground = p.floors[0].id;
    expect(undoOnFloor(p, h, ground)).toBeNull();
    const first = p.floors[1].id;
    const a = undoOnFloor(p, h, first)!;
    expect(a.project.floors[1].walls).toHaveLength(0);
    // It changed every floor, so no single floor's Undo takes it back; History does.
    expect(undoOnFloor(a.project, a.state, ground)).toBeNull();
    expect(undoOnFloor(a.project, a.state, first)).toBeNull();
    const b = undoStep(a.project, a.state)!;
    expect(b.project.floors[0].floorToFloor).not.toBe(3300);
  });

  it('undo on a new floor stops at the floor itself, and never removes it', () => {
    let p = building();
    let h = emptyHistory();
    ({ p, h } = addWall(p, h, 0, 0));
    const added = runCommand(p, 'Add floor', (d) => {
      d.floors.push({ ...JSON.parse(JSON.stringify(d.floors[1])), id: 'new-floor', walls: [] });
    })!;
    p = added.project;
    h = pushEntry(h, added.entry);
    ({ p, h } = addWall(p, h, 2, 0));
    const a = undoOnFloor(p, h, 'new-floor')!;
    expect(a.project.floors[2].walls).toHaveLength(0);
    expect(undoOnFloor(a.project, a.state, 'new-floor')).toBeNull();
    // The ground floor's own step is still there to undo.
    const b = undoOnFloor(a.project, a.state, p.floors[0].id)!;
    expect(b.project.floors[0].walls).toHaveLength(0);
    expect(b.project.floors).toHaveLength(3);
  });

  it('settings for the whole project are left to the History list', () => {
    let p = building();
    let h = emptyHistory();
    ({ p, h } = addWall(p, h, 1, 0));
    const named = runCommand(p, 'Rename project', (d) => {
      d.name = 'New name';
    })!;
    const hh = pushEntry(h, named.entry);
    expect(undoOnFloor(named.project, hh, p.floors[0].id)).toBeNull();
    const a = undoOnFloor(named.project, hh, p.floors[1].id)!;
    expect(a.project.name).toBe('New name');
    expect(a.project.floors[1].walls).toHaveLength(0);
    expect(undoStep(named.project, hh)!.project.name).toBe('Two floors');
  });
});

describe('stairs turn every way', () => {
  const shapes = ['straight', 'l', 'u', 'spiral'] as const;
  it.each(shapes)('%s: turning keeps it in place, and the steps go with it', (shape) => {
    const s = createStair({ x: 5000, y: 5000 }, { shape, totalRise: 3000 });
    const middle = stairCenter(s);
    for (const deg of [90, 180, 270, 45, 0]) {
      const k: Stair = JSON.parse(JSON.stringify(s));
      setStairRotation(k, deg);
      const after = stairCenter(k);
      // Staying within the original footprint's reach, rather than swinging about a corner.
      const reach = deg % 90 === 0 ? 2 : 900;
      expect(Math.hypot(after.x - middle.x, after.y - middle.y)).toBeLessThan(reach);
      const layout = stairLayout(k);
      const top = layout.steps[layout.steps.length - 1];
      const mid = bbox(top.polygon);
      const height = stairHeightAt(k, { x: (mid.minX + mid.maxX) / 2, y: (mid.minY + mid.maxY) / 2 });
      expect(height).toBeCloseTo(top.z, 3);
    }
  });

  it.each(shapes)('%s: rails run along the stair, from the bottom to the top', (shape) => {
    for (const turnLeft of [false, true]) {
      const s = createStair({ x: 0, y: 0 }, { shape, totalRise: 3000, turnLeft });
      const layout = stairLayout(s);
      expect(layout.rails.length).toBeGreaterThan(0);
      const box = bbox(layout.outline);
      for (const rail of layout.rails) {
        for (const p of rail) {
          expect(p.x).toBeGreaterThanOrEqual(box.minX - 150);
          expect(p.x).toBeLessThanOrEqual(box.maxX + 150);
          expect(p.y).toBeGreaterThanOrEqual(box.minY - 150);
          expect(p.y).toBeLessThanOrEqual(box.maxY + 150);
        }
      }
      expect(Math.max(...layout.rails.flat().map((p) => p.z))).toBeCloseTo(3000, 3);
    }
  });

  it('the Rotate button turns a stair about its middle', () => {
    const f = createFloor('G', 0, 0);
    const s = createStair({ x: 2000, y: 2000 }, { shape: 'straight', totalRise: 3000 });
    f.stairs.push(s);
    const middle = stairCenter(s);
    rotateItems(f, [{ kind: 'stair', id: s.id }], 90, middle);
    expect(f.stairs[0].transform.rotation).toBe(90);
    const after = stairCenter(f.stairs[0]);
    expect(Math.hypot(after.x - middle.x, after.y - middle.y)).toBeLessThan(5);
  });

  it('mirroring keeps a stair where it is and flips its turn', () => {
    const f = createFloor('G', 0, 0);
    const s = createStair({ x: 1000, y: 1000 }, { shape: 'l', totalRise: 3000, turnLeft: false });
    f.stairs.push(s);
    const before = bbox(stairLayout(s).outline);
    const middle = { x: (before.minX + before.maxX) / 2, y: (before.minY + before.maxY) / 2 };
    mirrorItems(f, [{ kind: 'stair', id: s.id }], middle, 'vertical');
    const m = f.stairs[0];
    expect(m.turnLeft).toBe(true);
    const after = bbox(stairLayout(m).outline);
    expect(after.minX).toBeCloseTo(before.minX, -1);
    expect(after.maxX).toBeCloseTo(before.maxX, -1);
    expect(after.minY).toBeCloseTo(before.minY, -1);
  });

  it('mirroring furniture left to right does not turn it to face the other way', () => {
    const f = createFloor('G', 0, 0);
    const o = createObject('sofa_3', { x: 0, y: 0 }, { width: 2000, depth: 800, height: 800 }, 'Sofa', {}, 0);
    f.objects.push(o);
    mirrorItems(f, [{ kind: 'object', id: o.id }], { x: 100, y: 0 }, 'vertical');
    expect(((f.objects[0].transform.rotation % 360) + 360) % 360).toBe(0);
    expect(f.objects[0].transform.x).toBe(200);
  });

  it('handles turn and widen a stair', () => {
    const f = createFloor('G', 0, 0);
    const s = createStair({ x: 0, y: 0 }, { shape: 'straight', totalRise: 3000, width: 1000 });
    f.stairs.push(s);
    const ref = { kind: 'stair' as const, id: s.id };
    const handles = itemHandles(f, ref, 300);
    const middle = stairCenter(s);
    handles.find((h) => h.id === 'rotate')!.edit({ x: middle.x + 500, y: middle.y }, false)(f);
    expect(f.stairs[0].transform.rotation).toBe(90);
    const g = createFloor('G', 0, 0);
    const fresh = createStair({ x: 0, y: 0 }, { shape: 'straight', totalRise: 3000, width: 1000 });
    g.stairs.push(fresh);
    itemHandles(g, { kind: 'stair', id: fresh.id }, 300)
      .find((h) => h.id === 'width')!
      .edit(
        { x: 1500, y: -50 },
        false,
      )(g);
    expect(g.stairs[0].width).toBe(1500);
  });
});

describe('resizing', () => {
  it('a corner handle resizes an object and keeps the opposite corner still', () => {
    const f = createFloor('G', 0, 0);
    const o = createObject(
      'sofa_3',
      { x: 0, y: 0 },
      { width: 2000, depth: 1000, height: 800 },
      'Sofa',
      {},
      0,
    );
    f.objects.push(o);
    const ref = { kind: 'object' as const, id: o.id };
    const h = itemHandles(f, ref, 300).find((x) => x.id === 'corner:1:1')!;
    h.edit({ x: 1500, y: 1000 }, false)(f);
    expect(f.objects[0].width).toBe(2500);
    expect(f.objects[0].depth).toBe(1500);
    // Corner (-1000, -500) stays.
    expect(f.objects[0].transform.x - 1250).toBe(-1000);
    expect(f.objects[0].transform.y - 750).toBe(-500);
  });

  it('every placeable kind offers its sizes in one place', () => {
    const f = createFloor('G', 0, 0);
    const s = createStair({ x: 0, y: 0 });
    const slab = createSlab([
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 1000 },
      { x: 0, y: 1000 },
    ]);
    f.stairs.push(s);
    f.slabs.push(slab);
    expect(sizeFields(f, { kind: 'stair', id: s.id }).length).toBeGreaterThan(1);
    expect(sizeFields(f, { kind: 'slab', id: slab.id }).map((x) => Math.round(x.value))).toEqual([
      2000,
      1000,
      slab.thickness,
    ]);
  });

  it('a slab changes size from its middle, and a rectangle stays one when dragged', () => {
    const f = createFloor('G', 0, 0);
    const slab = createSlab([
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 1000 },
      { x: 0, y: 1000 },
    ]);
    f.slabs.push(slab);
    setSlabSize(f, slab.id, 'x', 3000);
    expect(bbox(f.slabs[0].polygon)).toMatchObject({ minX: -500, maxX: 2500, minY: 0, maxY: 1000 });
    const h = itemHandles(f, { kind: 'slab', id: slab.id }, 0)[2];
    h.edit({ x: 3000, y: 2000 }, false)(f);
    const b = bbox(f.slabs[0].polygon);
    expect(b).toMatchObject({ minX: -500, maxX: 3000, minY: 0, maxY: 2000 });
    expect(pointInPolygon({ x: 2900, y: 100 }, f.slabs[0].polygon)).toBe(true);
  });

  it('a slab shows in 3D at the height it was given', () => {
    const p = createProject('Slab');
    p.floors[0].slabs.push(
      createSlab(
        [
          { x: 0, y: 0 },
          { x: 2000, y: 0 },
          { x: 2000, y: 2000 },
          { x: 0, y: 2000 },
        ],
        { zOffset: 2700, thickness: 150 },
      ),
    );
    const house = buildHouse(p, { bare: true, hideRoof: true });
    const ys = house.buckets.flatMap(([, b]) => b.positions.filter((_, i) => i % 3 === 1));
    expect(Math.max(...ys)).toBeCloseTo(2.7, 1);
  });
});

describe('sharing a house as a file', () => {
  const house = () => {
    const p = createProject('Sharma house');
    p.floors[0].walls.push(createWall({ x: 0, y: 0 }, { x: 3000, y: 0 }));
    return p;
  };

  it('what is shared opens the same on the other side', () => {
    const p = house();
    const { project, sharedAt } = readShared(packShared(p));
    expect(project.name).toBe('Sharma house');
    expect(project.floors[0].walls).toHaveLength(1);
    expect(sharedAt).toBeGreaterThan(0);
    expect(sharedSummary(project).floors).toBe(1);
  });

  it('a saved copy is separate from the sender', () => {
    const p = house();
    expect(ownCopy(p).id).not.toBe(p.id);
  });

  it('still opens the plain exports from older versions', () => {
    expect(readShared(JSON.stringify(house())).project.name).toBe('Sharma house');
  });

  it.each([
    ['not json', 'hello'],
    ['empty', ''],
    ['a list', '[1,2]'],
    ['no floors', '{"format":"nakshakar-shared-house","project":{"name":"x","floors":[]}}'],
    ['bad floor', '{"name":"x","schemaVersion":1,"floors":[1]}'],
  ])('refuses %s', (_label, text) => {
    expect(() => readShared(text)).toThrow(SharedFileError);
  });

  it('refuses a house from a newer version, and says so', () => {
    const p = { ...house(), schemaVersion: 9999 };
    expect(() => readShared(JSON.stringify(p))).toThrow('too-new');
  });

  it('a file cannot slip markup into the page through a colour or picture', () => {
    const p = house() as unknown as Record<string, unknown> & { floors: Record<string, unknown>[] };
    const evil = '"><img src=x onerror=alert(1)>';
    p.floors[0].walls = [{ ...(p.floors[0].walls as object[])[0], leftColor: evil, topColor: evil }];
    (p.floors[0].objects as unknown[]) = [{ id: 'a', colors: { body: evil }, transform: { x: 0, y: 0 } }];
    p.thumbnail = `javascript:alert(1)`;
    const { project } = readShared(JSON.stringify(p));
    const text = JSON.stringify(project);
    expect(text).not.toContain('onerror');
    expect(project.thumbnail).toBe('');
  });

  it('drops walls and openings that make no sense, and keys that reach prototypes', () => {
    const p = house() as unknown as { floors: { walls: unknown[]; openings: unknown[] }[] };
    p.floors[0].walls.push({ id: 'broken', start: 'x', end: null });
    p.floors[0].openings.push({ id: 'o', wallId: 'gone' });
    const text = JSON.stringify(p).replace('"name"', '"__proto__":{"polluted":true},"name"');
    const { project } = readShared(text);
    expect(project.floors[0].walls).toHaveLength(1);
    expect(project.floors[0].openings).toHaveLength(0);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('keeps Hindi and Telugu names in the file name, and removes unsafe characters', () => {
    expect(shareFileName('शर्मा घर')).toBe('शर्मा घर.nakshakar');
    expect(shareFileName('a/b:c')).toBe('a_b_c.nakshakar');
    expect(shareFileName('   ')).toBe('house.nakshakar');
  });
});
