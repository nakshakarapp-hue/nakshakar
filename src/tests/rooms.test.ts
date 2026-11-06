import { describe, expect, it } from 'vitest';
import { createFloor, createObject, createOpening, createWall } from '../core/model/defaults';
import type { Floor } from '../core/model/types';
import {
  copyFloor,
  deleteRoom,
  moveFloor,
  refsOfRoom,
  setRoomSize,
  syncRooms,
  wallsOfRoom,
} from '../editor2d/commands';
import { addRoom, placeRoom, ROOM_SIZES, type RoomSpec } from '../editor2d/roomAdder';
import { buildHouse } from '../viewer3d/builder';
import { collide } from '../viewer3d/walk';
import { createProject } from '../core/model/defaults';

const spec = (over: Partial<RoomSpec> = {}): RoomSpec => ({
  type: 'bedroom',
  name: 'Bedroom',
  width: 3000,
  depth: 3000,
  side: 'auto',
  door: true,
  window: true,
  furnish: false,
  ...over,
});
const box = (f: Floor, id: string) => {
  const r = f.rooms.find((x) => x.id === id)!;
  const xs = r.polygon.map((p) => p.x);
  const ys = r.polygon.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

describe('adding room after room', () => {
  it('the first room becomes one closed room of the asked size', () => {
    const f = createFloor('Ground', 0, 0);
    const { roomId } = addRoom(f, spec(), 0);
    expect(roomId).toBeTruthy();
    expect(f.rooms).toHaveLength(1);
    expect(f.walls).toHaveLength(4);
    expect(f.rooms[0].area).toBeGreaterThan(8);
    expect(f.rooms[0].area).toBeLessThan(10);
  });

  it('every next room joins the last, shares its wall and never overlaps', () => {
    const f = createFloor('Ground', 0, 0);
    const types = ['living', 'kitchen', 'bedroom', 'bathroom', 'dining', 'pooja', 'study', 'store'] as const;
    let anchor: string | undefined;
    types.forEach((type, i) => {
      const [w, d] = ROOM_SIZES[type]![1];
      const { roomId } = addRoom(
        f,
        spec({ type, name: type, width: w, depth: d, anchorId: anchor, side: i === 0 ? 'auto' : 'auto' }),
        0,
      );
      expect(roomId, type).toBeTruthy();
      anchor = roomId!;
      expect(f.rooms.length, type).toBe(i + 1);
    });
    const boxes = f.rooms.map((r) => box(f, r.id));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
        expect(overlapX > 300 && overlapY > 300, `${f.rooms[i].name} and ${f.rooms[j].name}`).toBe(false);
      }
    }
    // Shared walls are not doubled up: fewer walls than eight separate boxes would need.
    expect(f.walls.length).toBeLessThan(8 * 4);
  });

  it('best fit keeps the house compact instead of one long line', () => {
    const f = createFloor('Ground', 0, 0);
    for (const type of ['living', 'kitchen', 'master_bedroom', 'bathroom', 'dining', 'bedroom'] as const) {
      const [w, d] = ROOM_SIZES[type]![1];
      expect(addRoom(f, spec({ type, name: type, width: w, depth: d }), 0).roomId, type).toBeTruthy();
    }
    expect(f.rooms).toHaveLength(6);
    const all = f.rooms.map((r) => box(f, r.id));
    const width = Math.max(...all.map((b) => b.maxX)) - Math.min(...all.map((b) => b.minX));
    const height = Math.max(...all.map((b) => b.maxY)) - Math.min(...all.map((b) => b.minY));
    expect(Math.max(width, height) / Math.min(width, height)).toBeLessThan(1.6);
  });

  it('a chosen side puts the room on that side of the anchor', () => {
    for (const side of ['left', 'right', 'above', 'below'] as const) {
      const f = createFloor('Ground', 0, 0);
      const first = addRoom(f, spec(), 0).roomId!;
      const second = addRoom(f, spec({ name: 'Next', side, anchorId: first }), 0).roomId!;
      const a = box(f, first);
      const b = box(f, second);
      if (side === 'left') expect(b.maxX).toBeLessThanOrEqual(a.minX + 1);
      if (side === 'right') expect(b.minX).toBeGreaterThanOrEqual(a.maxX - 1);
      if (side === 'above') expect(b.maxY).toBeLessThanOrEqual(a.minY + 1);
      if (side === 'below') expect(b.minY).toBeGreaterThanOrEqual(a.maxY - 1);
    }
  });

  it('a door links a new room to its neighbour and a window goes on an outside wall', () => {
    const f = createFloor('Ground', 0, 0);
    const first = addRoom(f, spec(), 0).roomId!;
    addRoom(f, spec({ name: 'Next', anchorId: first }), 0);
    expect(f.openings.filter((o) => o.kind === 'door').length).toBeGreaterThanOrEqual(1);
    expect(f.openings.filter((o) => o.kind === 'window').length).toBeGreaterThanOrEqual(1);
    for (const o of f.openings) {
      const w = f.walls.find((x) => x.id === o.wallId)!;
      const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
      expect(o.position).toBeGreaterThanOrEqual(o.width / 2 - 1);
      expect(o.position).toBeLessThanOrEqual(len - o.width / 2 + 1);
    }
  });

  it('furniture lands inside its room', () => {
    const f = createFloor('Ground', 0, 0);
    const id = addRoom(f, spec({ furnish: true, width: 3600, depth: 3600 }), 0).roomId!;
    const b = box(f, id);
    expect(f.objects.length).toBeGreaterThan(0);
    for (const o of f.objects) {
      expect(o.transform.x).toBeGreaterThan(b.minX);
      expect(o.transform.x).toBeLessThan(b.maxX);
      expect(o.transform.y).toBeGreaterThan(b.minY);
      expect(o.transform.y).toBeLessThan(b.maxY);
    }
  });

  it('nothing stands in a door swing, and furniture does not overlap', () => {
    const f = createFloor('Ground', 0, 0);
    addRoom(f, spec({ furnish: true, width: 3600, depth: 3600 }), 0);
    const door = f.openings.find((o) => o.kind === 'door')!;
    const wall = f.walls.find((w) => w.id === door.wallId)!;
    const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    const at = {
      x: wall.start.x + ((wall.end.x - wall.start.x) * door.position) / len,
      y: wall.start.y + ((wall.end.y - wall.start.y) * door.position) / len,
    };
    const boxes = f.objects.map((o) => {
      const sideways = o.transform.rotation === 90 || o.transform.rotation === 270;
      const w = sideways ? o.depth : o.width;
      const d = sideways ? o.width : o.depth;
      return {
        minX: o.transform.x - w / 2,
        maxX: o.transform.x + w / 2,
        minY: o.transform.y - d / 2,
        maxY: o.transform.y + d / 2,
      };
    });
    expect(boxes.length).toBeGreaterThan(0);
    boxes.forEach((b, i) => {
      const clear =
        at.x + door.width <= b.minX ||
        at.x - door.width >= b.maxX ||
        at.y + door.width <= b.minY ||
        at.y - door.width >= b.maxY;
      expect(clear, f.objects[i].name).toBe(true);
      boxes.slice(i + 1).forEach((c) => {
        expect(b.minX < c.maxX && c.minX < b.maxX && b.minY < c.maxY && c.minY < b.maxY).toBe(false);
      });
    });
  });

  it('a missing anchor falls back to free space instead of failing', () => {
    const f = createFloor('Ground', 0, 0);
    addRoom(f, spec(), 0);
    const spot = placeRoom(f, 3000, 3000, 'right', 'gone');
    expect(spot).toBeTruthy();
    expect(addRoom(f, spec({ name: 'After undo', anchorId: 'gone' }), 0).roomId).toBeTruthy();
  });
});

describe('editing a room', () => {
  it('resizing moves its walls and keeps the neighbour attached', () => {
    const f = createFloor('Ground', 0, 0);
    const a = addRoom(f, spec(), 0).roomId!;
    const b = addRoom(f, spec({ name: 'Next', side: 'right', anchorId: a }), 0).roomId!;
    const before = box(f, a);
    setRoomSize(f, a, 'x', before.maxX - before.minX + 1000);
    syncRooms(f, 0);
    expect(f.rooms).toHaveLength(2);
    const after = f.rooms.map((r) => box(f, r.id));
    const widths = after.map((x) => x.maxX - x.minX).sort((p, q) => p - q);
    expect(widths[1] - widths[0]).toBeGreaterThan(800);
    expect(b).toBeTruthy();
  });

  it('deleting a room keeps the wall a neighbour still needs', () => {
    const f = createFloor('Ground', 0, 0);
    const a = addRoom(f, spec(), 0).roomId!;
    const b = addRoom(f, spec({ name: 'Next', side: 'right', anchorId: a }), 0).roomId!;
    const keep = f.rooms.find((r) => r.id === b)!;
    const needed = wallsOfRoom(f, keep).length;
    deleteRoom(f, a);
    syncRooms(f, 0);
    expect(f.rooms).toHaveLength(1);
    expect(f.rooms[0].name).toBe('Next');
    expect(wallsOfRoom(f, f.rooms[0]).length).toBe(needed);
    expect(f.walls).toHaveLength(4);
  });

  it('a room drags together with its walls and what stands in it', () => {
    const f = createFloor('Ground', 0, 0);
    const id = addRoom(f, spec({ furnish: true, width: 3600, depth: 3600 }), 0).roomId!;
    const refs = refsOfRoom(
      f,
      f.rooms.find((r) => r.id === id)!,
    );
    expect(refs.filter((r) => r.kind === 'wall')).toHaveLength(4);
    expect(refs.some((r) => r.kind === 'object')).toBe(true);
  });
});

describe('floors', () => {
  const building = () => {
    const p = createProject('Floors');
    const ground = p.floors[0];
    addRoom(ground, spec({ name: 'Downstairs' }), 0);
    const upper = createFloor('First Floor', 1, ground.floorToFloor);
    addRoom(upper, spec({ name: 'Upstairs' }), 0);
    p.floors.push(upper);
    return p;
  };

  it('moving ground to the top swaps the contents and keeps levels and heights in order', () => {
    const p = building();
    const height = p.floors[0].floorToFloor;
    expect(moveFloor(p.floors, p.floors[0].id, 1)).toBe(true);
    expect(p.floors[0].rooms[0].name).toBe('Upstairs');
    expect(p.floors[1].rooms[0].name).toBe('Downstairs');
    expect(p.floors.map((f) => f.levelIndex)).toEqual([0, 1]);
    expect(p.floors[0].elevation).toBe(0);
    expect(p.floors[1].elevation).toBe(p.floors[0].floorToFloor);
    expect(p.floors[0].floorToFloor).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    // Standard names describe the position, so they follow it.
    expect(p.floors.map((f) => f.name)).toEqual(['Ground Floor', 'First Floor']);
    // It cannot go past the top or the bottom.
    expect(moveFloor(p.floors, p.floors[1].id, 1)).toBe(false);
    expect(moveFloor(p.floors, p.floors[0].id, -1)).toBe(false);
  });

  it('a name the user chose stays with its floor, and basements stay below ground', () => {
    const p = building();
    p.floors[1].name = 'Sharma flat';
    const basement = createFloor('Basement', -1, -3150);
    p.floors.unshift(basement);
    expect(moveFloor(p.floors, p.floors[2].id, -1)).toBe(true);
    expect(p.floors.map((f) => f.levelIndex)).toEqual([-1, 0, 1]);
    expect(p.floors[1].name).toBe('Sharma flat');
    expect(p.floors[1].elevation).toBe(0);
    expect(p.floors[0].elevation).toBe(-p.floors[0].floorToFloor);
  });

  it('copying the layout leaves furniture behind and gives everything new ids', () => {
    const p = building();
    const src = p.floors[0];
    src.objects.push(
      createObject('sofa_3', { x: 0, y: 0 }, { width: 1, depth: 1, height: 1 }, 'Sofa', {}, 0),
    );
    src.openings[0].isMainEntrance = true;
    const layout = copyFloor(src, 'new', 'layout');
    expect(layout.objects).toHaveLength(0);
    expect(layout.walls).toHaveLength(src.walls.length);
    expect(layout.walls[0].id).not.toBe(src.walls[0].id);
    const wallIds = new Set(layout.walls.map((w) => w.id));
    layout.openings.forEach((o) => {
      expect(wallIds.has(o.wallId)).toBe(true);
      expect(o.isMainEntrance).toBe(false);
    });
    expect(copyFloor(src, 'new2', 'all').objects).toHaveLength(1);
  });
});

describe('the walking game', () => {
  const house = () => {
    const p = createProject('Game');
    const f = p.floors[0];
    const a = addRoom(f, spec(), 0).roomId!;
    addRoom(f, spec({ name: 'Next', side: 'right', anchorId: a }), 0);
    const wall = f.walls.find((w) => w.type === 'outer')!;
    const door = f.openings.find((o) => o.kind === 'door')!;
    door.isMainEntrance = true;
    return { p, wall, door };
  };

  it('starts a few metres in front of the house', () => {
    const { p } = house();
    const built = buildHouse(p, { movable: true, noLand: true });
    const b = built.bounds;
    const cx = Math.max(b.minX, Math.min(b.maxX, built.explore.x));
    const cz = Math.max(b.minZ, Math.min(b.maxZ, built.explore.z));
    const gap = Math.hypot(built.explore.x - cx, built.explore.z - cz);
    expect(gap).toBeGreaterThan(4);
    expect(gap).toBeLessThan(12);
  });

  it('door and window leaves are built as separate moving parts', () => {
    const { p } = house();
    const built = buildHouse(p, { movable: true, noLand: true });
    const f = p.floors[0];
    const ids = new Set(built.movables.map((m) => m.openingId));
    for (const o of f.openings) expect(ids.has(o.id), o.catalogId).toBe(true);
    const still = buildHouse(p, {});
    expect(still.movables).toHaveLength(0);
  });

  it('a shut door blocks walking and an open door does not', () => {
    const { p, door } = house();
    const built = buildHouse(p, { movable: true, noLand: true });
    const walk = built.walk[0];
    const seg = walk.doors.find((d) => d.id === door.id)!;
    expect(seg).toBeTruthy();
    const mid = { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 };
    const dx = seg.b.x - seg.a.x;
    const dy = seg.b.y - seg.a.y;
    const len = Math.hypot(dx, dy);
    const stepping = { x: mid.x + (-dy / len) * 40, y: mid.y + (dx / len) * 40 };
    const shut = collide(stepping, walk, new Set());
    expect(Math.hypot(shut.x - stepping.x, shut.y - stepping.y)).toBeGreaterThan(50);
    const open = collide(stepping, walk, new Set([door.id]));
    expect(Math.hypot(open.x - stepping.x, open.y - stepping.y)).toBeLessThan(1);
  });

  it('every surface knows what it belongs to, so a tap can paint it', () => {
    const { p } = house();
    const built = buildHouse(p, { movable: true, noLand: true });
    const tags = built.buckets.flatMap(([, b]) => b.tags).filter(Boolean);
    const kinds = new Set(tags.map((x) => x!.kind));
    expect(kinds.has('wall')).toBe(true);
    expect(kinds.has('floor')).toBe(true);
    for (const [, b] of built.buckets) expect(b.tags.length).toBe(b.positions.length / 9);
  });

  it('a compound wall with no gate cannot lock the visitor out, and one with a gate can be opened', () => {
    const { p } = house();
    const f = p.floors[0];
    const ring = [
      createWall(
        { x: -20000, y: -20000 },
        { x: 20000, y: -20000 },
        { type: 'compound', height: 1500, thickness: 150 },
      ),
      createWall(
        { x: 20000, y: -20000 },
        { x: 20000, y: 20000 },
        { type: 'compound', height: 1500, thickness: 150 },
      ),
    ];
    f.walls.push(...ring);
    const noGate = buildHouse(p, { movable: true, noLand: true }).walk[0];
    const through = { x: 0, y: -20000 };
    const passed = collide(through, noGate, new Set());
    expect(Math.hypot(passed.x - through.x, passed.y - through.y)).toBeLessThan(1);
    const gate = createOpening(ring[0].id, 20000, 'door', {
      width: 3000,
      height: 1800,
      sillHeight: 0,
      lintelHeight: 1800,
    });
    f.openings.push(gate);
    const withGate = buildHouse(p, { movable: true, noLand: true }).walk[0];
    const wallSpot = { x: 10000, y: -20000 };
    const stopped = collide(wallSpot, withGate, new Set());
    expect(Math.hypot(stopped.x - wallSpot.x, stopped.y - wallSpot.y)).toBeGreaterThan(50);
    const openGate = collide(through, withGate, new Set([gate.id]));
    expect(Math.hypot(openGate.x - through.x, openGate.y - through.y)).toBeLessThan(1);
  });

  it('a catalogue picture holds only the item itself', () => {
    const p = createProject('Picture');
    p.floors[0].walls = [];
    const bare = buildHouse(p, { bare: true, hideRoof: true });
    expect(bare.buckets.reduce((n, [, b]) => n + b.positions.length, 0)).toBe(0);
  });
});
