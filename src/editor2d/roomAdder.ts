import { objectById, openingTypeById } from '../catalog/catalog';
import { createObject, createOpening, createWall } from '../core/model/defaults';
import { dist, snapPoint } from '../core/geometry/vec';
import { pointInPolygon } from '../core/geometry/polygon';
import { distanceAlongWall, pointOnWall, wallLength } from '../core/geometry/wallGraph';
import type { FloorFinish, Floor, Id, Room, RoomType, Vec2, Wall } from '../core/model/types';
import { syncRooms } from './commands';

export type RoomSide = 'auto' | 'right' | 'left' | 'above' | 'below';

export interface RoomSpec {
  type: RoomType;
  name: string;
  /** Clear inside size, as a user measures a room. */
  width: number;
  depth: number;
  side: RoomSide;
  /** The room to attach to. Defaults to the most recently added. */
  anchorId?: Id;
  door: boolean;
  window: boolean;
  furnish: boolean;
}

const T = 230;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function roomBox(r: Room): Box {
  const xs = r.centerline.map((p) => p.x);
  const ys = r.centerline.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

const overlaps = (a: Box, b: Box) =>
  a.minX < b.maxX - 1 && a.maxX > b.minX + 1 && a.minY < b.maxY - 1 && a.maxY > b.minY + 1;

/** Slides a candidate along the anchor's edge until it clears every other room. */
function clear(box: Box, others: Box[], axis: 'x' | 'y'): Box {
  let b = box;
  for (let guard = 0; guard < 60; guard++) {
    const hit = others.find((o) => overlaps(b, o));
    if (!hit) return b;
    b =
      axis === 'y'
        ? { ...b, minY: hit.maxY, maxY: hit.maxY + (b.maxY - b.minY) }
        : { ...b, minX: hit.maxX, maxX: hit.maxX + (b.maxX - b.minX) };
  }
  return b;
}

function candidate(side: Exclude<RoomSide, 'auto'>, a: Box, w: number, d: number, others: Box[]): Box {
  switch (side) {
    case 'right':
      return clear({ minX: a.maxX, maxX: a.maxX + w, minY: a.minY, maxY: a.minY + d }, others, 'y');
    case 'left':
      return clear({ minX: a.minX - w, maxX: a.minX, minY: a.minY, maxY: a.minY + d }, others, 'y');
    case 'below':
      return clear({ minX: a.minX, maxX: a.minX + w, minY: a.maxY, maxY: a.maxY + d }, others, 'x');
    case 'above':
      return clear({ minX: a.minX, maxX: a.minX + w, minY: a.minY - d, maxY: a.minY }, others, 'x');
  }
}

/** Where a new room of this size goes: touching the anchor, on the side chosen or the tidiest side. */
export function placeRoom(
  floor: Pick<Floor, 'rooms' | 'walls'>,
  width: number,
  depth: number,
  side: RoomSide,
  anchorId?: Id,
): Box {
  const w = width + T;
  const d = depth + T;
  const rooms = floor.rooms;
  if (!rooms.length) {
    const xs = floor.walls.flatMap((x) => [x.start.x, x.end.x]);
    const ys = floor.walls.flatMap((x) => [x.start.y, x.end.y]);
    const x = xs.length ? Math.max(...xs) + 1000 : 0;
    const y = ys.length ? Math.min(...ys) : 0;
    return { minX: x, minY: y, maxX: x + w, maxY: y + d };
  }
  const anchor = rooms.find((r) => r.id === anchorId);
  const others = rooms.map(roomBox);
  if (side !== 'auto') return candidate(side, roomBox(anchor ?? rooms[rooms.length - 1]), w, d, others);
  // Tidiest means the house stays compact and roughly square. With no room chosen, any room's side will do.
  const sources = anchor ? [roomBox(anchor)] : others;
  let best: Box | null = null;
  let bestScore = Infinity;
  for (const a of sources) {
    for (const s of ['right', 'below', 'left', 'above'] as const) {
      // Line up with either end of the neighbour's side.
      const flush = s === 'right' || s === 'left' ? { minY: a.maxY - d } : { minX: a.maxX - w };
      for (const from of [a, { ...a, ...flush }]) {
        const c = candidate(s, from, w, d, others);
        const minX = Math.min(c.minX, ...others.map((o) => o.minX));
        const maxX = Math.max(c.maxX, ...others.map((o) => o.maxX));
        const minY = Math.min(c.minY, ...others.map((o) => o.minY));
        const maxY = Math.max(c.maxY, ...others.map((o) => o.maxY));
        // The longer side counts most, which is what stops a house growing into one long line.
        const score = Math.max(maxX - minX, maxY - minY) ** 2 + (maxX - minX) * (maxY - minY);
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
    }
  }
  return best as Box;
}

/**
 * Adds a wall along a line, leaving out any stretch an existing straight wall already covers, so
 * neighbouring rooms share one wall instead of having two stacked on each other.
 * Returns the walls added and the stretches that were already covered.
 */
export function addUncoveredWall(
  floor: Floor,
  a: Vec2,
  b: Vec2,
  over: Partial<Wall> = {},
): { added: Wall[]; shared: { wall: Wall; from: Vec2; to: Vec2 }[] } {
  const length = dist(a, b);
  const dx = (b.x - a.x) / length;
  const dy = (b.y - a.y) / length;
  const covered: { t0: number; t1: number; wall: Wall }[] = [];
  for (const w of floor.walls) {
    if (Math.abs(w.bulge) > 1e-3 || w.points?.length) continue;
    if (closestLine(w.start, a, dx, dy) > 2 || closestLine(w.end, a, dx, dy) > 2) continue;
    const s0 = (w.start.x - a.x) * dx + (w.start.y - a.y) * dy;
    const s1 = (w.end.x - a.x) * dx + (w.end.y - a.y) * dy;
    const t0 = Math.max(0, Math.min(s0, s1));
    const t1 = Math.min(length, Math.max(s0, s1));
    if (t1 - t0 > 1) covered.push({ t0, t1, wall: w });
  }
  covered.sort((m, n) => m.t0 - n.t0);
  const at = (t: number): Vec2 => snapPoint({ x: a.x + dx * t, y: a.y + dy * t });
  const added: Wall[] = [];
  const shared: { wall: Wall; from: Vec2; to: Vec2 }[] = [];
  let cursor = 0;
  for (const c of covered) {
    if (c.t0 - cursor > 50) added.push(createWall(at(cursor), at(c.t0), over));
    shared.push({ wall: c.wall, from: at(c.t0), to: at(c.t1) });
    cursor = Math.max(cursor, c.t1);
  }
  if (length - cursor > 50) added.push(createWall(at(cursor), at(length), over));
  floor.walls.push(...added);
  return { added, shared };
}

function closestLine(p: Vec2, origin: Vec2, dx: number, dy: number): number {
  return Math.abs((p.x - origin.x) * dy - (p.y - origin.y) * dx);
}

const WET: RoomType[] = ['toilet', 'bathroom', 'wash_area'];
const OPEN: RoomType[] = ['balcony', 'verandah', 'porch', 'terrace', 'open_court'];

function finishFor(type: RoomType): { floorFinish: FloorFinish; floorColor: string } {
  if (WET.includes(type)) return { floorFinish: 'ceramic', floorColor: '#c9d3d6' };
  if (type === 'kitchen') return { floorFinish: 'ceramic', floorColor: '#ddd6c8' };
  if (type === 'garage' || type === 'porch') return { floorFinish: 'cement', floorColor: '#b5b1a7' };
  if (OPEN.includes(type)) return { floorFinish: 'kota', floorColor: '#bdb8a6' };
  if (type === 'pooja') return { floorFinish: 'marble', floorColor: '#f1ece2' };
  return { floorFinish: 'vitrified', floorColor: '#e8e2d6' };
}

type Slot =
  'top' | 'bottom' | 'left' | 'right' | 'center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

/** Starter furniture: catalogue id, where it stands, and which way it faces. */
const STARTER: Partial<Record<RoomType, [string, Slot, number][]>> = {
  master_bedroom: [
    ['bed_king', 'top', 0],
    ['wardrobe_3', 'bottom', 180],
    ['nightstand', 'topLeft', 0],
  ],
  bedroom: [
    ['bed_queen', 'top', 0],
    ['wardrobe_2', 'bottom', 180],
  ],
  guest_room: [
    ['bed_queen', 'top', 0],
    ['wardrobe_2', 'bottom', 180],
  ],
  kids_room: [
    ['bed_single', 'topLeft', 0],
    ['study_desk', 'bottomRight', 180],
  ],
  living: [
    ['sofa_3', 'bottom', 180],
    ['tv_unit', 'top', 0],
    ['table_coffee', 'center', 0],
  ],
  drawing: [
    ['sofa_3', 'bottom', 180],
    ['table_coffee', 'center', 0],
  ],
  dining: [['dining_6', 'center', 0]],
  kitchen: [
    ['counter', 'top', 180],
    ['fridge', 'bottomRight', 180],
  ],
  toilet: [
    ['wc_western', 'topLeft', 0],
    ['basin', 'topRight', 0],
  ],
  bathroom: [
    ['wc_western', 'topLeft', 0],
    ['basin', 'topRight', 0],
    ['shower', 'bottomRight', 0],
  ],
  pooja: [['mandir', 'top', 0]],
  study: [
    ['study_desk', 'top', 180],
    ['office_chair', 'center', 0],
    ['bookshelf', 'bottomLeft', 180],
  ],
  garage: [['car_hatch', 'center', 0]],
  utility: [['washing_machine', 'topLeft', 0]],
  wash_area: [['washing_machine', 'topLeft', 0]],
  store: [['bookshelf', 'top', 0]],
};

/** Going clockwise round the room: each step turns an item a quarter, keeping its back to the wall. */
const CLOCKWISE: Slot[][] = [
  ['top', 'right', 'bottom', 'left'],
  ['topRight', 'bottomRight', 'bottomLeft', 'topLeft'],
];

function candidates(slot: Slot, rotation: number): [Slot, number][] {
  const ring = CLOCKWISE.find((r) => r.includes(slot));
  if (!ring) return [[slot, rotation]];
  const start = ring.indexOf(slot);
  return [0, 2, 1, 3].map((k) => [ring[(start + k) % 4], (rotation + k * 90) % 360]);
}

function furnish(floor: Floor, room: Room, box: Box): void {
  const margin = 170;
  const list = STARTER[room.type] ?? [];
  // Where a door swings must stay clear, and so must whatever is already placed.
  const taken: Box[] = [];
  for (const o of floor.openings) {
    const wall = floor.walls.find((w) => w.id === o.wallId);
    if (!wall || o.kind !== 'door') continue;
    const { point } = pointOnWall(wall, o.position);
    const reach = o.width + 100;
    taken.push({
      minX: point.x - reach,
      maxX: point.x + reach,
      minY: point.y - reach,
      maxY: point.y + reach,
    });
  }
  for (const [id, wanted, turned] of list) {
    const c = objectById.get(id);
    if (!c) continue;
    for (const [slot, rotation] of candidates(wanted, turned)) {
      const sideways = rotation === 90 || rotation === 270;
      const w = sideways ? c.depth : c.width;
      const d = sideways ? c.width : c.depth;
      if (w > box.maxX - box.minX - 2 * margin || d > box.maxY - box.minY - 2 * margin) continue;
      const midX = (box.minX + box.maxX) / 2;
      const midY = (box.minY + box.maxY) / 2;
      const left = box.minX + margin + w / 2;
      const right = box.maxX - margin - w / 2;
      const top = box.minY + margin + d / 2;
      const bottom = box.maxY - margin - d / 2;
      const at: Record<Slot, Vec2> = {
        top: { x: midX, y: top },
        bottom: { x: midX, y: bottom },
        left: { x: left, y: midY },
        right: { x: right, y: midY },
        center: { x: midX, y: midY },
        topLeft: { x: left, y: top },
        topRight: { x: right, y: top },
        bottomLeft: { x: left, y: bottom },
        bottomRight: { x: right, y: bottom },
      };
      const spot = snapPoint(at[slot]);
      const footprint: Box = {
        minX: spot.x - w / 2,
        maxX: spot.x + w / 2,
        minY: spot.y - d / 2,
        maxY: spot.y + d / 2,
      };
      if (
        taken.some(
          (b) =>
            b.minX < footprint.maxX &&
            footprint.minX < b.maxX &&
            b.minY < footprint.maxY &&
            footprint.minY < b.maxY,
        )
      )
        continue;
      const item = createObject(
        id,
        spot,
        { width: c.width, depth: c.depth, height: c.height },
        c.name,
        { ...c.colors },
        c.mount ?? 0,
      );
      item.transform.rotation = rotation;
      floor.objects.push(item);
      taken.push(footprint);
      break;
    }
  }
}

function fit(floor: Floor, wall: Wall, typeId: string, position: number): void {
  const t = openingTypeById.get(typeId);
  if (!t) return;
  const length = wallLength(wall);
  if (t.width > length - 100) return;
  floor.openings.push(
    createOpening(wall.id, Math.max(t.width / 2, Math.min(length - t.width / 2, position)), t.kind, {
      catalogId: t.id,
      width: t.width,
      height: t.height,
      sillHeight: t.sill,
      lintelHeight: t.sill + t.height,
      panels: t.panels,
      shutterMaterial: t.shutterMaterial,
      shutterColor: t.shutterColor,
      frameColor: t.frameColor,
    }),
  );
}

/** Adds a whole room in one step: walls, name, finishes, and optionally a door, a window and furniture. */
export function addRoom(floor: Floor, spec: RoomSpec, northAngleDeg: number): { roomId: Id | null } {
  const box = placeRoom(floor, spec.width, spec.depth, spec.side, spec.anchorId);
  const corners: Vec2[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ].map(snapPoint);
  const firstRoom = floor.rooms.length === 0;
  const over: Partial<Wall> = {
    type: OPEN.includes(spec.type) ? 'half' : firstRoom ? 'outer' : 'outer',
    height: OPEN.includes(spec.type) ? 1000 : 3000,
  };
  const newWalls: Wall[] = [];
  const shared: { wall: Wall; from: Vec2; to: Vec2 }[] = [];
  corners.forEach((p, i) => {
    const r = addUncoveredWall(floor, p, corners[(i + 1) % 4], over);
    newWalls.push(...r.added);
    shared.push(...r.shared);
  });
  // A wall now between two rooms is an inner wall.
  for (const s of shared) if (s.wall.type === 'outer') s.wall.type = 'inner';
  syncRooms(floor, northAngleDeg);
  const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const room = floor.rooms.find((r) => pointInPolygon(center, r.centerline));
  if (!room) return { roomId: null };
  room.type = spec.type;
  room.name = spec.name;
  room.userNamed = true;
  Object.assign(room, finishFor(spec.type));

  const wet = WET.includes(spec.type);
  const doorType = wet
    ? 'door_bath'
    : spec.type === 'pooja'
      ? 'door_pooja'
      : spec.type === 'balcony' || spec.type === 'verandah'
        ? 'door_sliding'
        : spec.type === 'garage'
          ? 'door_double'
          : 'door_single';
  let doorWall: Wall | null = null;
  if (spec.door) {
    const best = [...shared].sort((m, n) => dist(n.from, n.to) - dist(m.from, m.to))[0];
    if (best && dist(best.from, best.to) >= 900) {
      const mid = { x: (best.from.x + best.to.x) / 2, y: (best.from.y + best.to.y) / 2 };
      doorWall = best.wall;
      fit(floor, best.wall, doorType, distanceAlongWall(best.wall, mid).along);
    } else if (newWalls.length) {
      doorWall = [...newWalls].sort((m, n) => wallLength(n) - wallLength(m))[0];
      fit(floor, doorWall, doorType, wallLength(doorWall) * 0.3);
    }
  }
  if (spec.window && newWalls.length && !OPEN.includes(spec.type)) {
    // The outermost new wall that is not hosting the door, preferably, and long enough for a window.
    const ranked = [...newWalls].sort(
      (m, n) => Number(m === doorWall) - Number(n === doorWall) || wallLength(n) - wallLength(m),
    );
    const host = ranked[0];
    const typeId = wet ? 'win_vent' : spec.type === 'kitchen' ? 'win_casement' : 'win_sliding';
    const size = openingTypeById.get(typeId)?.width ?? 1200;
    if (wallLength(host) >= size + 200)
      fit(floor, host, typeId, wallLength(host) * (host === doorWall ? 0.72 : 0.5));
  }
  if (spec.furnish) furnish(floor, room, box);
  return { roomId: room.id };
}

/** Sensible starting sizes in millimetres, and the sizes offered as one-tap chips. */
export const ROOM_SIZES: Partial<Record<RoomType, [number, number][]>> = {
  master_bedroom: [
    [3658, 4267],
    [4267, 4267],
    [4267, 4877],
  ],
  bedroom: [
    [3048, 3658],
    [3658, 3658],
    [3658, 4267],
  ],
  guest_room: [
    [3048, 3048],
    [3048, 3658],
    [3658, 3658],
  ],
  kids_room: [
    [3048, 3048],
    [3048, 3658],
    [3658, 3658],
  ],
  living: [
    [3658, 4877],
    [4267, 5486],
    [4877, 6096],
  ],
  drawing: [
    [3658, 3658],
    [3658, 4267],
    [4267, 4877],
  ],
  dining: [
    [3048, 3048],
    [3048, 3658],
    [3658, 4267],
  ],
  kitchen: [
    [2438, 3048],
    [3048, 3048],
    [3048, 3658],
  ],
  toilet: [
    [1219, 1829],
    [1524, 2134],
    [1829, 2438],
  ],
  bathroom: [
    [1524, 2134],
    [1829, 2438],
    [2134, 3048],
  ],
  pooja: [
    [1219, 1219],
    [1524, 1524],
    [1829, 1829],
  ],
  study: [
    [2438, 3048],
    [3048, 3048],
    [3048, 3658],
  ],
  store: [
    [1219, 1829],
    [1829, 2438],
    [2438, 3048],
  ],
  wash_area: [
    [1219, 1829],
    [1524, 2438],
    [1829, 3048],
  ],
  utility: [
    [1524, 2438],
    [1829, 3048],
    [2438, 3048],
  ],
  balcony: [
    [1219, 3048],
    [1524, 3658],
    [1829, 4267],
  ],
  verandah: [
    [1829, 3658],
    [2438, 4877],
    [3048, 6096],
  ],
  porch: [
    [2438, 3048],
    [3048, 3658],
    [3658, 4877],
  ],
  staircase: [
    [2438, 3658],
    [2438, 4267],
    [3048, 4267],
  ],
  passage: [
    [1067, 3048],
    [1219, 4267],
    [1524, 6096],
  ],
  garage: [
    [3048, 5486],
    [3658, 6096],
    [6096, 6096],
  ],
  terrace: [
    [3658, 3658],
    [4877, 4877],
    [6096, 6096],
  ],
  open_court: [
    [1829, 1829],
    [2438, 2438],
    [3048, 3048],
  ],
  other: [
    [3048, 3048],
    [3658, 3658],
    [4267, 4267],
  ],
};
