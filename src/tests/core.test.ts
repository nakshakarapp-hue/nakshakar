import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createFloor, createOpening, createProject, createWall } from '../core/model/defaults';
import { migrateProject, ProjectTooNewError } from '../core/model/migrations';
import { SCHEMA_VERSION, type Floor, type Vec2 } from '../core/model/types';
import {
  emptyHistory,
  persistableHistory,
  pushEntry,
  redoStep,
  runCommand,
  undoStep,
  PERSISTED_STEPS,
} from '../core/history/history';
import {
  addSnapshot,
  deleteProject,
  listProjects,
  listSnapshots,
  loadHistory,
  loadProject,
  resetDbConnection,
  saveHistory,
  saveProject,
} from '../core/storage/db';
import { Autosaver } from '../core/storage/autosave';
import {
  addWallLoop,
  copyItems,
  deleteItems,
  makeEqual,
  makeParallel,
  makePerpendicular,
  mirrorItems,
  moveWallEnd,
  nearestWall,
  offsetWall,
  pasteItems,
  rotateItems,
  setWallAngle,
  setWallLength,
  splitWall,
  syncRooms,
  translateItems,
  wallAngle,
} from '../editor2d/commands';
import { buildableArea, plotFromSides, shapeOutline, walkPerimeter, ROOM_SHAPES } from '../editor2d/shapes';
import { polygonArea } from '../core/geometry/polygon';

const P = (x: number, y: number): Vec2 => ({ x, y });

function roomFloor(w = 4000, h = 3000): Floor {
  const f = createFloor('G', 0, 0);
  addWallLoop(f, [P(0, 0), P(w, 0), P(w, h), P(0, h)], { thickness: 200 });
  syncRooms(f, 0);
  return f;
}

describe('history', () => {
  it('undoes and redoes through named commands', () => {
    let p = createProject('A');
    let h = emptyHistory();
    const c = runCommand(p, 'Rename', (d) => {
      d.name = 'B';
    })!;
    expect(c.entry.name).toBe('Rename');
    p = c.project;
    h = pushEntry(h, c.entry);
    const u = undoStep(p, h)!;
    expect(u.project.name).toBe('A');
    const r = redoStep(u.project, u.state)!;
    expect(r.project.name).toBe('B');
    expect(r.state.past).toHaveLength(1);
  });
  it('skips no-op commands and empty stacks', () => {
    const p = createProject('A');
    expect(runCommand(p, 'Nothing', () => undefined)).toBeNull();
    expect(undoStep(p, emptyHistory())).toBeNull();
    expect(redoStep(p, emptyHistory())).toBeNull();
  });
  it('clears redo after a new command', () => {
    let p = createProject('A');
    let h = emptyHistory();
    for (const name of ['B', 'C']) {
      const c = runCommand(p, name, (d) => {
        d.name = name;
      })!;
      p = c.project;
      h = pushEntry(h, c.entry);
    }
    const u = undoStep(p, h)!;
    const c = runCommand(u.project, 'D', (d) => {
      d.name = 'D';
    })!;
    expect(pushEntry(u.state, c.entry).future).toHaveLength(0);
  });
  it('persists the last 200 steps and they still replay after a relaunch', () => {
    let p = createProject('A');
    let h = emptyHistory();
    for (let i = 0; i < 250; i++) {
      const c = runCommand(p, `Step ${i}`, (d) => {
        d.notes = `n${i}`;
      })!;
      p = c.project;
      h = pushEntry(h, c.entry);
    }
    let kept = persistableHistory(h);
    expect(kept.past).toHaveLength(PERSISTED_STEPS);
    let current = JSON.parse(JSON.stringify(p));
    kept = JSON.parse(JSON.stringify(kept));
    for (let i = 0; i < PERSISTED_STEPS; i++) {
      const u = undoStep(current, kept)!;
      current = u.project;
      kept = u.state;
    }
    expect(current.notes).toBe('n49');
  });
});

describe('migrations', () => {
  it('upgrades old projects and leaves current ones alone', () => {
    const old = { id: 'x', name: 'Old', floors: [] };
    const up = migrateProject(old);
    expect(up.schemaVersion).toBe(SCHEMA_VERSION);
    expect(up.settings.displayUnit).toBe('ftin');
    expect(up.roof.type).toBe('flat');
    expect(old).not.toHaveProperty('settings');
    const now = createProject('N');
    expect(migrateProject(now).name).toBe('N');
  });
  it('refuses projects from a newer app and bad data', () => {
    expect(() => migrateProject({ schemaVersion: SCHEMA_VERSION + 1 })).toThrow(ProjectTooNewError);
    expect(() => migrateProject(null)).toThrow();
    expect(() => migrateProject({ schemaVersion: -5 })).toThrow();
  });
});

describe('storage', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    resetDbConnection();
  });
  it('saves, lists, loads and deletes', async () => {
    const a = createProject('A');
    const b = { ...createProject('B'), updatedAt: a.updatedAt + 10 };
    await saveProject(a);
    await saveProject(b);
    expect((await listProjects()).map((m) => m.name)).toEqual(['B', 'A']);
    expect((await loadProject(a.id))?.name).toBe('A');
    await addSnapshot(a, 'v1', 'manual');
    await saveHistory(a.id, emptyHistory());
    await deleteProject(a.id);
    expect(await loadProject(a.id)).toBeNull();
    expect(await listSnapshots(a.id)).toHaveLength(0);
    expect(await loadHistory(a.id)).toBeNull();
  });
  it('prunes only automatic restore points', async () => {
    const a = createProject('A');
    await addSnapshot(a, 'keep', 'manual');
    for (let i = 0; i < 25; i++) await addSnapshot(a, `auto ${i}`, 'auto');
    const list = await listSnapshots(a.id);
    expect(list.filter((s) => s.kind === 'auto')).toHaveLength(20);
    expect(list.some((s) => s.name === 'keep')).toBe(true);
  });
  it('round-trips history', async () => {
    const a = createProject('A');
    const c = runCommand(a, 'Rename', (d) => {
      d.name = 'Z';
    })!;
    await saveHistory(a.id, pushEntry(emptyHistory(), c.entry));
    expect((await loadHistory(a.id))?.past[0].name).toBe('Rename');
  });
});

describe('autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('coalesces a burst into one write', async () => {
    const save = vi.fn(async () => undefined);
    const s = new Autosaver<number>(save);
    s.schedule(1);
    s.schedule(2);
    s.schedule(3);
    await vi.advanceTimersByTimeAsync(400);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(3);
  });
  it('never waits past the limit during continuous editing', async () => {
    const save = vi.fn(async () => undefined);
    const s = new Autosaver<number>(save);
    for (let i = 0; i < 40; i++) {
      s.schedule(i);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it('flushes pending work and backs up', async () => {
    const save = vi.fn(async () => undefined);
    const backup = vi.fn(async () => undefined);
    const s = new Autosaver<number>(save, backup);
    s.schedule(9);
    await s.flush();
    expect(save).toHaveBeenCalledWith(9);
    expect(backup).toHaveBeenCalledWith(9);
    await s.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('reports errors without throwing', async () => {
    const onError = vi.fn();
    const s = new Autosaver<number>(
      async () => {
        throw new Error('disk full');
      },
      undefined,
      onError,
    );
    s.schedule(1);
    await s.flush();
    expect(onError).toHaveBeenCalledOnce();
  });
  it('writes a change that arrives during a write', async () => {
    const seen: number[] = [];
    const s = new Autosaver<number>(async (v) => {
      seen.push(v);
    });
    s.schedule(1);
    const f = s.flush();
    s.schedule(2);
    await f;
    await s.flush();
    expect(seen).toEqual([1, 2]);
  });
});

describe('wall commands', () => {
  it('resizes a room and keeps it square', () => {
    const f = roomFloor();
    setWallLength(f, f.walls[0].id, 5000);
    syncRooms(f, 0);
    expect(f.walls[0].end).toEqual(P(5000, 0));
    expect(f.walls[1].start).toEqual(P(5000, 0));
    expect(f.walls[1].end).toEqual(P(5000, 3000));
    expect(f.walls[2].start).toEqual(P(5000, 3000));
    expect(f.walls[3].start).toEqual(P(0, 3000));
    expect(f.rooms[0].area).toBeCloseTo(4.8 * 2.8, 3);
  });
  it('can move the start end, or both ends', () => {
    const f = roomFloor();
    setWallLength(f, f.walls[0].id, 5000, 'start');
    expect(f.walls[0].start).toEqual(P(-1000, 0));
    expect(f.walls[3].end).toEqual(P(-1000, 0));
    expect(f.walls[3].start).toEqual(P(-1000, 3000));
    const g = roomFloor();
    setWallLength(g, g.walls[0].id, 5000, 'both');
    expect(g.walls[0].start).toEqual(P(-500, 0));
    expect(g.walls[0].end).toEqual(P(4500, 0));
  });
  it('moves a corner together', () => {
    const f = roomFloor();
    moveWallEnd(f, f.walls[0].id, 'end', P(4500, -200));
    expect(f.walls[1].start).toEqual(P(4500, -200));
  });
  it('keeps openings inside a shrunken wall', () => {
    const f = roomFloor();
    f.openings.push(createOpening(f.walls[0].id, 3500, 'door'));
    setWallLength(f, f.walls[0].id, 2000);
    expect(f.openings[0].position).toBe(1550);
  });
  it('keeps an opening in place when the wall start moves', () => {
    const f = roomFloor();
    f.openings.push(createOpening(f.walls[0].id, 2000, 'door'));
    setWallLength(f, f.walls[0].id, 5000, 'start');
    expect(f.openings[0].position).toBe(3000);
  });
  it('applies typed constraints', () => {
    const f = createFloor('G', 0, 0);
    f.walls.push(createWall(P(0, 0), P(3000, 0)), createWall(P(0, 2000), P(1000, 3000)));
    const [a, b] = f.walls;
    makeParallel(f, b.id, a.id);
    expect(wallAngle(f.walls[1])).toBeCloseTo(0, 1);
    makePerpendicular(f, b.id, a.id);
    expect(Math.abs(wallAngle(f.walls[1]))).toBeCloseTo(90, 1);
    makeEqual(f, b.id, a.id);
    expect(Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y)).toBeCloseTo(3000, 0);
    setWallAngle(f, a.id, 45);
    expect(wallAngle(f.walls[0])).toBeCloseTo(45, 1);
  });
  it('splits a wall and re-homes openings', () => {
    const f = roomFloor();
    f.openings.push(createOpening(f.walls[0].id, 3000, 'door'), createOpening(f.walls[0].id, 500, 'window'));
    const id = splitWall(f, f.walls[0].id, 2000)!;
    expect(f.walls).toHaveLength(5);
    expect(f.walls[0].end).toEqual(P(2000, 0));
    expect(f.openings[0].wallId).toBe(id);
    expect(f.openings[0].position).toBe(1000);
    expect(f.openings[1].wallId).toBe(f.walls[0].id);
    syncRooms(f, 0);
    expect(f.rooms).toHaveLength(1);
    expect(splitWall(f, f.walls[0].id, 1)).toBeNull();
    expect(splitWall(f, 'missing', 100)).toBeNull();
  });
  it('offsets a wall parallel', () => {
    const f = roomFloor();
    const id = offsetWall(f, f.walls[0].id, 500)!;
    const w = f.walls.find((x) => x.id === id)!;
    expect(w.start).toEqual(P(0, -500));
    expect(w.end).toEqual(P(4000, -500));
  });
  it('deletes walls with their openings', () => {
    const f = roomFloor();
    f.openings.push(createOpening(f.walls[0].id, 1000, 'door'));
    deleteItems(f, [{ kind: 'wall', id: f.walls[0].id }]);
    expect(f.walls).toHaveLength(3);
    expect(f.openings).toHaveLength(0);
  });
  it('moves a wall and carries T-joined walls', () => {
    const f = createFloor('G', 0, 0);
    f.walls.push(createWall(P(0, 0), P(4000, 0)), createWall(P(2000, 0), P(2000, 3000)));
    translateItems(f, [{ kind: 'wall', id: f.walls[0].id }], P(0, -500));
    expect(f.walls[0].start).toEqual(P(0, -500));
    expect(f.walls[1].start).toEqual(P(2000, -500));
    expect(f.walls[1].end).toEqual(P(2000, 3000));
  });
  it('rotates and mirrors a group', () => {
    const f = createFloor('G', 0, 0);
    f.walls.push(createWall(P(0, 0), P(1000, 0), { leftColor: '#111111', rightColor: '#222222' }));
    const ref = [{ kind: 'wall' as const, id: f.walls[0].id }];
    rotateItems(f, ref, 90, P(0, 0));
    expect(f.walls[0].end).toEqual(P(0, 1000));
    mirrorItems(f, ref, P(500, 0), 'vertical');
    expect(f.walls[0].end).toEqual(P(1000, 1000));
    expect(f.walls[0].leftColor).toBe('#222222');
  });
  it('copies and pastes onto another floor with openings', () => {
    const f = roomFloor();
    f.openings.push(createOpening(f.walls[0].id, 1000, 'door'));
    const refs = f.walls.map((w) => ({ kind: 'wall' as const, id: w.id }));
    const clip = copyItems(f, refs);
    const g = createFloor('F', 1, 3150);
    const pasted = pasteItems(g, clip, P(100, 100));
    syncRooms(g, 0);
    expect(pasted).toHaveLength(4);
    expect(g.walls[0].start).toEqual(P(100, 100));
    expect(g.openings[0].wallId).toBe(g.walls[0].id);
    expect(g.walls[0].id).not.toBe(f.walls[0].id);
    expect(g.rooms).toHaveLength(1);
  });
  it('finds the nearest wall', () => {
    const f = roomFloor();
    expect(nearestWall(f, P(2000, 50), 100)?.wall.id).toBe(f.walls[0].id);
    expect(nearestWall(f, P(2000, 1500), 100)).toBeNull();
  });
});

describe('shapes and perimeter', () => {
  it('every wizard shape produces walls that form exactly one room', () => {
    for (const shape of ROOM_SHAPES) {
      if (shape === 'circle') continue;
      const outline = shapeOutline(shape, { length: 6000, breadth: 6000, sides: 7 });
      const f = createFloor('G', 0, 0);
      addWallLoop(f, outline, { thickness: 200 });
      syncRooms(f, 0);
      expect(f.rooms, shape).toHaveLength(1);
      expect(f.rooms[0].area, shape).toBeGreaterThan(1);
    }
  });
  it('regular polygons honour the entered side length', () => {
    const o = shapeOutline('ngon', { length: 0, breadth: 0, sides: 5, sideLength: 2000 });
    expect(o).toHaveLength(5);
    expect(Math.hypot(o[1].x - o[0].x, o[1].y - o[0].y)).toBeCloseTo(2000, 6);
  });
  it('reports the closing error of a perimeter table', () => {
    const row = (length: number, turn = 90) => ({ length, turn, thickness: 230, height: 3000 });
    const closed = walkPerimeter([row(4000), row(3000), row(4000), row(3000)]);
    expect(closed.closes).toBe(true);
    expect(closed.closingError).toBeCloseTo(0, 6);
    const open = walkPerimeter([row(4000), row(3000), row(4000), row(2500)]);
    expect(open.closes).toBe(false);
    expect(open.closingError).toBeCloseTo(500, 6);
    expect(walkPerimeter([]).closingError).toBe(0);
  });
  it('builds a plot and insets by setbacks', () => {
    const rect = plotFromSides([9000, 12000, 9000, 12000]);
    expect(polygonArea(rect)).toBeCloseTo(9000 * 12000, -2);
    const area = buildableArea(rect, [1500, 1000, 1000, 1000]);
    expect(polygonArea(area)).toBeCloseTo(7000 * 9500, -2);
    const skew = plotFromSides([9000, 12500, 9500, 12000]);
    expect(Math.hypot(skew[2].x - skew[1].x, skew[2].y - skew[1].y)).toBeCloseTo(12500, 3);
    expect(Math.hypot(skew[3].x - skew[2].x, skew[3].y - skew[2].y)).toBeCloseTo(9500, 3);
    expect(plotFromSides([5000, 5000, 5000], [120, 120, 120])).toHaveLength(3);
    expect(buildableArea(rect, [99999, 99999, 99999, 99999])).toBeDefined();
  });
});
