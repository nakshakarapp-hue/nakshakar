import { newId } from '../core/model/ids';
import { createWall } from '../core/model/defaults';
import type { Floor, Id, LayerCategory, Opening, Room, Vec2, Wall } from '../core/model/types';
import { detectRooms } from '../core/geometry/rooms';
import { pointInPolygon } from '../core/geometry/polygon';
import {
  closestOnSegment,
  cross,
  dist,
  dot,
  fromAngle,
  angleDeg,
  leftNormal,
  norm,
  rotate,
  scale,
  snapPoint,
  sub,
  add,
} from '../core/geometry/vec';
import { distanceAlongWall, pointOnWall, wallLength, wallPath } from '../core/geometry/wallGraph';

export type ItemKind =
  | 'wall'
  | 'opening'
  | 'room'
  | 'stair'
  | 'pillar'
  | 'beam'
  | 'slab'
  | 'object'
  | 'plant'
  | 'dimension'
  | 'label'
  | 'electrical'
  | 'plumbing';

export interface ItemRef {
  kind: ItemKind;
  id: Id;
}

export const COLLECTION: Record<ItemKind, keyof Floor> = {
  wall: 'walls',
  opening: 'openings',
  room: 'rooms',
  stair: 'stairs',
  pillar: 'pillars',
  beam: 'beams',
  slab: 'slabs',
  object: 'objects',
  plant: 'plants',
  dimension: 'dimensions',
  label: 'labels',
  electrical: 'electrical',
  plumbing: 'plumbing',
};

export const LAYER_OF: Partial<Record<ItemKind, LayerCategory>> = {
  wall: 'walls',
  opening: 'openings',
  stair: 'stairs',
  pillar: 'pillars',
  beam: 'beams',
  object: 'objects',
  plant: 'plants',
  dimension: 'dimensions',
  label: 'labels',
  electrical: 'electrical',
  plumbing: 'plumbing',
};

type AnyItem = { id: Id } & Record<string, unknown>;

export function itemsOf(floor: Floor, kind: ItemKind): AnyItem[] {
  return floor[COLLECTION[kind]] as unknown as AnyItem[];
}

export function findItem<T = AnyItem>(floor: Floor, ref: ItemRef): T | undefined {
  return itemsOf(floor, ref.kind).find((i) => i.id === ref.id) as unknown as T | undefined;
}

/** Re-detects rooms after wall changes. Run inside the same command so undo restores them too. */
export function syncRooms(floor: Floor, northAngleDeg: number): void {
  floor.rooms = detectRooms(floor, northAngleDeg);
}

const JOINT_TOLERANCE = 2;
const same = (a: Vec2, b: Vec2) => dist(a, b) <= JOINT_TOLERANCE;

function setPoint(target: Vec2, to: Vec2) {
  target.x = to.x;
  target.y = to.y;
}

/** Walls with an end at this exact point, other than the one excluded. */
function endsAt(floor: Floor, p: Vec2, except?: Id): { wall: Wall; end: 'start' | 'end' }[] {
  const out: { wall: Wall; end: 'start' | 'end' }[] = [];
  for (const wall of floor.walls) {
    if (wall.id === except) continue;
    if (same(wall.start, p)) out.push({ wall, end: 'start' });
    if (same(wall.end, p)) out.push({ wall, end: 'end' });
  }
  return out;
}

/** Keeps openings at the same world position when the start of their wall moves along its line. */
function shiftOpeningsForStart(floor: Floor, wall: Wall, oldStart: Vec2, oldEnd: Vec2) {
  const dir = norm(sub(oldEnd, oldStart));
  const delta = dot(sub(wall.start, oldStart), dir);
  clampOpenings(floor, wall, delta);
}

/** Applies a shift to openings on a wall and keeps each one inside the wall. */
export function clampOpenings(floor: Floor, wall: Wall, shift = 0) {
  const length = wallLength(wall);
  for (const o of floor.openings) {
    if (o.wallId !== wall.id) continue;
    o.position -= shift;
    o.position = Math.max(o.width / 2, Math.min(length - o.width / 2, o.position));
  }
}

/**
 * Moves one end of a wall, carrying along every wall joined at that corner so the corner stays closed.
 * Also carries walls that were T-joined onto this wall's body when the whole wall is being translated.
 */
export function moveWallEnd(floor: Floor, wallId: Id, which: 'start' | 'end', to: Vec2): void {
  const wall = floor.walls.find((w) => w.id === wallId);
  if (!wall) return;
  const target = snapPoint(to);
  const from = { ...wall[which] };
  const oldStart = { ...wall.start };
  const oldEnd = { ...wall.end };
  for (const { wall: other, end } of endsAt(floor, from, wall.id)) {
    const os = { ...other.start };
    const oe = { ...other.end };
    setPoint(other[end], target);
    if (end === 'start') shiftOpeningsForStart(floor, other, os, oe);
    else clampOpenings(floor, other);
  }
  setPoint(wall[which], target);
  if (which === 'start') shiftOpeningsForStart(floor, wall, oldStart, oldEnd);
  else clampOpenings(floor, wall);
}

/**
 * Pushes a corner by a delta. Walls at the corner that are parallel to the push stretch, and walls
 * across it travel with the corner, so a resized room stays square instead of going skew.
 */
function pushCorner(floor: Floor, start: Vec2, delta: Vec2, fixed: Vec2[], editedId: Id): void {
  const dir = norm(delta);
  const moved: Vec2[] = [];
  const queue: Vec2[] = [{ ...start }];
  const isDone = (p: Vec2) => moved.some((m) => same(m, p));
  while (queue.length) {
    const p = queue.shift()!;
    if (isDone(p)) continue;
    moved.push(p);
    for (const { wall, end } of endsAt(floor, p, editedId)) {
      const other = end === 'start' ? wall.end : wall.start;
      const along = norm(sub(other, p));
      const parallel = Math.abs(cross(along, dir)) < 0.02;
      if (!parallel && !fixed.some((f) => same(f, other)) && !wall.locked) queue.push({ ...other });
    }
  }
  // Move every recorded corner together, after the walk, so lookups used the original geometry.
  const updates: { target: Vec2; to: Vec2 }[] = [];
  for (const wall of floor.walls) {
    for (const endName of ['start', 'end'] as const) {
      if (wall.id === editedId) continue;
      if (moved.some((m) => same(m, wall[endName])))
        updates.push({ target: wall[endName], to: snapPoint(add(wall[endName], delta)) });
    }
  }
  updates.forEach((u) => setPoint(u.target, u.to));
}

export type LengthAnchor = 'end' | 'start' | 'both';

/** Sets a straight wall's length. `anchor` names which end moves. Corners stay joined and square. */
export function setWallLength(floor: Floor, wallId: Id, length: number, anchor: LengthAnchor = 'end'): void {
  const wall = floor.walls.find((w) => w.id === wallId);
  if (!wall || length <= 0) return;
  const current = dist(wall.start, wall.end);
  if (current < 1e-6) return;
  const dir = norm(sub(wall.end, wall.start));
  const change = length - current;
  const startDelta =
    anchor === 'start' ? scale(dir, -change) : anchor === 'both' ? scale(dir, -change / 2) : { x: 0, y: 0 };
  const endDelta =
    anchor === 'end' ? scale(dir, change) : anchor === 'both' ? scale(dir, change / 2) : { x: 0, y: 0 };
  const oldStart = { ...wall.start };
  const oldEnd = { ...wall.end };
  if (startDelta.x || startDelta.y) {
    pushCorner(floor, oldStart, startDelta, anchor === 'start' ? [oldEnd] : [], wall.id);
    setPoint(wall.start, snapPoint(add(oldStart, startDelta)));
  }
  if (endDelta.x || endDelta.y) {
    pushCorner(floor, oldEnd, endDelta, anchor === 'end' ? [oldStart] : [], wall.id);
    setPoint(wall.end, snapPoint(add(oldEnd, endDelta)));
  }
  if (anchor !== 'end') shiftOpeningsForStart(floor, wall, oldStart, oldEnd);
  else clampOpenings(floor, wall);
}

/** Rotates a wall about its start to an absolute plan angle, keeping its length. */
export function setWallAngle(floor: Floor, wallId: Id, deg: number): void {
  const wall = floor.walls.find((w) => w.id === wallId);
  if (!wall) return;
  moveWallEnd(floor, wallId, 'end', add(wall.start, fromAngle(deg, dist(wall.start, wall.end))));
}

export function wallAngle(wall: Wall): number {
  return angleDeg(sub(wall.end, wall.start));
}

export function makeParallel(floor: Floor, wallId: Id, referenceId: Id): void {
  const ref = floor.walls.find((w) => w.id === referenceId);
  if (ref) setWallAngle(floor, wallId, wallAngle(ref));
}

export function makePerpendicular(floor: Floor, wallId: Id, referenceId: Id): void {
  const ref = floor.walls.find((w) => w.id === referenceId);
  const wall = floor.walls.find((w) => w.id === wallId);
  if (!ref || !wall) return;
  const a = wallAngle(ref);
  const here = wallAngle(wall);
  const plus = a + 90;
  const diff = Math.abs(((here - plus + 540) % 360) - 180);
  setWallAngle(floor, wallId, diff <= 90 ? plus : a - 90);
}

export function makeEqual(floor: Floor, wallId: Id, referenceId: Id): void {
  const ref = floor.walls.find((w) => w.id === referenceId);
  if (ref) setWallLength(floor, wallId, wallLength(ref));
}

/** Splits a wall at a distance along it, moving its openings onto whichever half holds them. */
export function splitWall(floor: Floor, wallId: Id, distance: number): Id | null {
  const wall = floor.walls.find((w) => w.id === wallId);
  if (!wall || Math.abs(wall.bulge) > 1e-3) return null;
  const length = wallLength(wall);
  if (distance < 10 || distance > length - 10) return null;
  const at = snapPoint(pointOnWall(wall, distance).point);
  const path = wallPath(wall);
  const second = createWall(at, wall.end, {
    ...wall,
    id: newId(),
    start: at,
    end: { ...wall.end },
    points: undefined,
  });
  let walked = 0;
  const firstPoints: Vec2[] = [];
  const secondPoints: Vec2[] = [];
  for (let i = 1; i < path.length - 1; i++) {
    walked += dist(path[i - 1], path[i]);
    (walked < distance ? firstPoints : secondPoints).push(path[i]);
  }
  second.points = secondPoints.length ? secondPoints : undefined;
  wall.points = firstPoints.length ? firstPoints : undefined;
  wall.end = { ...at };
  for (const o of floor.openings) {
    if (o.wallId === wall.id && o.position > distance) {
      o.wallId = second.id;
      o.position -= distance;
    }
  }
  floor.walls.splice(floor.walls.indexOf(wall) + 1, 0, second);
  return second.id;
}

/** Copies a wall parallel to itself. Positive distance is to the wall's left. */
export function offsetWall(floor: Floor, wallId: Id, distance: number): Id | null {
  const wall = floor.walls.find((w) => w.id === wallId);
  if (!wall) return null;
  const n = scale(leftNormal(norm(sub(wall.end, wall.start))), distance);
  const copy = createWall(add(wall.start, n), add(wall.end, n), {
    ...wall,
    id: newId(),
    start: snapPoint(add(wall.start, n)),
    end: snapPoint(add(wall.end, n)),
    points: wall.points?.map((p) => snapPoint(add(p, n))),
  });
  floor.walls.push(copy);
  return copy.id;
}

/** Adds a closed loop of walls from outline points, clockwise on screen. */
export function addWallLoop(floor: Floor, points: Vec2[], over: Partial<Wall> = {}): Id[] {
  const ids: Id[] = [];
  points.forEach((p, i) => {
    const w = createWall(snapPoint(p), snapPoint(points[(i + 1) % points.length]), over);
    floor.walls.push(w);
    ids.push(w.id);
  });
  return ids;
}

/** Adds an open chain of walls. */
export function addWallChain(
  floor: Floor,
  points: Vec2[],
  over: (i: number) => Partial<Wall> = () => ({}),
): Id[] {
  const ids: Id[] = [];
  for (let i = 1; i < points.length; i++) {
    const w = createWall(snapPoint(points[i - 1]), snapPoint(points[i]), over(i - 1));
    floor.walls.push(w);
    ids.push(w.id);
  }
  return ids;
}

/** Deletes items, along with the openings of any deleted wall. */
export function deleteItems(floor: Floor, refs: ItemRef[]): void {
  const wallIds = new Set(refs.filter((r) => r.kind === 'wall').map((r) => r.id));
  if (wallIds.size) floor.openings = floor.openings.filter((o) => !wallIds.has(o.wallId));
  for (const ref of refs) {
    if (ref.kind === 'room') continue;
    const key = COLLECTION[ref.kind];
    const list = floor[key] as unknown as AnyItem[];
    const idx = list.findIndex((i) => i.id === ref.id);
    if (idx >= 0) list.splice(idx, 1);
  }
}

type PointMap = (p: Vec2) => Vec2;

/** Applies a plan mapping (move, rotate or mirror) to one item in place. */
function mapItem(
  floor: Floor,
  ref: ItemRef,
  map: PointMap,
  turnDeg: number,
  mirror: 'vertical' | 'horizontal' | false,
) {
  const item = findItem<Record<string, unknown>>(floor, ref);
  if (!item) return;
  switch (ref.kind) {
    case 'wall': {
      const w = item as unknown as Wall;
      w.start = snapPoint(map(w.start));
      w.end = snapPoint(map(w.end));
      if (w.points) w.points = w.points.map((p) => snapPoint(map(p)));
      if (mirror) {
        w.bulge = -w.bulge;
        const swap = w.leftColor;
        w.leftColor = w.rightColor;
        w.rightColor = swap;
      }
      break;
    }
    case 'stair':
    case 'pillar':
    case 'object':
    case 'plant': {
      const t = (item as unknown as { transform: { x: number; y: number; rotation: number } }).transform;
      let origin: Vec2 = t;
      if (mirror && ref.kind === 'stair') {
        // A stair grows to one side of where it starts, so its other corner becomes the start.
        const stair = item as unknown as { shape: string; width: number; turnLeft: boolean };
        if (stair.shape !== 'spiral') origin = add(t, rotate({ x: stair.width, y: 0 }, t.rotation));
        stair.turnLeft = !stair.turnLeft;
      }
      const p = snapPoint(map(origin));
      t.x = p.x;
      t.y = p.y;
      // Flipped left to right, a heading of r becomes -r; flipped top to bottom, 180 - r.
      t.rotation =
        mirror === 'vertical'
          ? -t.rotation
          : mirror === 'horizontal'
            ? 180 - t.rotation
            : t.rotation + turnDeg;
      break;
    }
    case 'beam': {
      const b = item as unknown as { start: Vec2; end: Vec2 };
      b.start = snapPoint(map(b.start));
      b.end = snapPoint(map(b.end));
      break;
    }
    case 'dimension': {
      const d = item as unknown as { a: Vec2; b: Vec2 };
      d.a = map(d.a);
      d.b = map(d.b);
      break;
    }
    case 'label':
    case 'electrical':
    case 'plumbing': {
      const l = item as unknown as { at: Vec2 };
      l.at = map(l.at);
      break;
    }
    case 'slab': {
      const s = item as unknown as { polygon: Vec2[]; holes: Vec2[][] };
      s.polygon = s.polygon.map(map);
      s.holes = s.holes.map((h) => h.map(map));
      break;
    }
    case 'opening':
    case 'room':
      break;
  }
}

/**
 * Moves selected items. Walls T-joined or corner-joined to a moving wall keep their joint: their
 * touching end follows, unless they are moving too.
 */
export function translateItems(floor: Floor, refs: ItemRef[], delta: Vec2): void {
  const moving = new Set(refs.filter((r) => r.kind === 'wall').map((r) => r.id));
  const followers: { target: Vec2; to: Vec2 }[] = [];
  for (const wall of floor.walls) {
    if (!moving.has(wall.id)) continue;
    const path = wallPath(wall);
    for (const other of floor.walls) {
      if (moving.has(other.id)) continue;
      for (const end of ['start', 'end'] as const) {
        const onWall = path.some(
          (p, i) => i > 0 && closestOnSegment(other[end], path[i - 1], p).distance <= JOINT_TOLERANCE,
        );
        if (onWall) followers.push({ target: other[end], to: snapPoint(add(other[end], delta)) });
      }
    }
  }
  followers.forEach((f) => setPoint(f.target, f.to));
  refs.forEach((r) => mapItem(floor, r, (p) => add(p, delta), 0, false));
}

export function rotateItems(floor: Floor, refs: ItemRef[], deg: number, about: Vec2): void {
  refs.forEach((r) => mapItem(floor, r, (p) => rotate(p, deg, about), deg, false));
}

/** Mirrors items across a vertical line through `about`, or a horizontal one. */
export function mirrorItems(
  floor: Floor,
  refs: ItemRef[],
  about: Vec2,
  axis: 'vertical' | 'horizontal' = 'vertical',
): void {
  const map: PointMap =
    axis === 'vertical'
      ? (p) => ({ x: 2 * about.x - p.x, y: p.y })
      : (p) => ({ x: p.x, y: 2 * about.y - p.y });
  refs.forEach((r) => mapItem(floor, r, map, 0, axis));
  // Mirroring reverses the direction of travel for door swings.
  const wallIds = new Set(refs.filter((r) => r.kind === 'wall').map((r) => r.id));
  for (const o of floor.openings) {
    if (wallIds.has(o.wallId)) o.swingSide = o.swingSide === 'left' ? 'right' : 'left';
  }
}

export interface Clip {
  items: { kind: ItemKind; data: unknown }[];
  openings: Opening[];
}

/** Copies items, with the openings of copied walls. */
export function copyItems(floor: Floor, refs: ItemRef[]): Clip {
  const items = refs
    .filter((r) => r.kind !== 'opening' && r.kind !== 'room')
    .map((r) => ({ kind: r.kind, data: JSON.parse(JSON.stringify(findItem(floor, r) ?? null)) as unknown }))
    .filter((i) => i.data);
  const wallIds = new Set(refs.filter((r) => r.kind === 'wall').map((r) => r.id));
  const openings = floor.openings
    .filter((o) => wallIds.has(o.wallId))
    .map((o) => JSON.parse(JSON.stringify(o)) as Opening);
  return { items, openings };
}

/** Pastes a clip onto a floor (the same one or another), returning refs to the new items. */
export function pasteItems(floor: Floor, clip: Clip, delta: Vec2): ItemRef[] {
  const out: ItemRef[] = [];
  const wallMap = new Map<Id, Id>();
  for (const it of clip.items) {
    const data = JSON.parse(JSON.stringify(it.data)) as AnyItem;
    const oldId = data.id;
    data.id = newId();
    if (it.kind === 'wall') wallMap.set(oldId, data.id);
    itemsOf(floor, it.kind).push(data);
    const ref = { kind: it.kind, id: data.id };
    mapItem(floor, ref, (p) => add(p, delta), 0, false);
    out.push(ref);
  }
  for (const o of clip.openings) {
    const target = wallMap.get(o.wallId);
    if (target) floor.openings.push({ ...JSON.parse(JSON.stringify(o)), id: newId(), wallId: target });
  }
  return out;
}

/** Colours the wall faces that bound a room, on whichever side of each wall the room lies. */
export function paintRoomWalls(floor: Floor, room: Room, color: string): void {
  const center = room.centroid;
  for (const w of wallsOfRoom(floor, room)) {
    const n = leftNormal(norm(sub(w.end, w.start)));
    const left = dot(sub(center, w.start), n) > 0;
    if (left) w.leftColor = color;
    else w.rightColor = color;
  }
}

/** Walls running along a room's outline. */
export function wallsOfRoom(floor: Floor, room: Room): Wall[] {
  const near = (p: Vec2) =>
    room.centerline.some(
      (q, i) =>
        closestOnSegment(p, q, room.centerline[(i + 1) % room.centerline.length]).distance <= JOINT_TOLERANCE,
    );
  return floor.walls.filter((w) => near(w.start) && near(w.end));
}

/** Everything that moves with a room: its walls and what stands inside it. */
export function refsOfRoom(floor: Floor, room: Room): ItemRef[] {
  const inside = (t: Vec2) => pointInPolygon(t, room.centerline);
  return [
    ...wallsOfRoom(floor, room).map((w) => ({ kind: 'wall' as const, id: w.id })),
    ...floor.objects.filter((o) => inside(o.transform)).map((o) => ({ kind: 'object' as const, id: o.id })),
    ...floor.stairs.filter((o) => inside(o.transform)).map((o) => ({ kind: 'stair' as const, id: o.id })),
    ...floor.pillars.filter((o) => inside(o.transform)).map((o) => ({ kind: 'pillar' as const, id: o.id })),
  ];
}

/** Removes a room: its own walls and contents go, walls shared with a neighbour stay. */
export function deleteRoom(floor: Floor, roomId: Id): void {
  const room = floor.rooms.find((r) => r.id === roomId);
  if (!room) return;
  const others = floor.rooms.filter((r) => r.id !== roomId);
  const shared = new Set(others.flatMap((r) => wallsOfRoom(floor, r).map((w) => w.id)));
  const refs = refsOfRoom(floor, room).filter((r) => !(r.kind === 'wall' && shared.has(r.id)));
  deleteItems(floor, refs);
}

/**
 * Makes a room wider or deeper by stretching the plan through its middle: everything beyond the
 * cut moves by the change, so neighbouring rooms keep their size and all corners stay joined.
 */
export function stretchPlan(floor: Floor, axis: 'x' | 'y', cut: number, delta: number): void {
  const shift = (p: Vec2) => {
    if (p[axis] > cut) p[axis] += delta;
  };
  for (const w of floor.walls) {
    const startAfter = w.start[axis] > cut;
    const endAfter = w.end[axis] > cut;
    if (startAfter !== endAfter && Math.abs(w.bulge) < 1e-3) {
      // The wall crosses the cut and changes length: openings beyond the cut keep their place.
      const dir = norm(sub(w.end, w.start));
      for (const o of floor.openings) {
        if (o.wallId !== w.id) continue;
        const at = w.start[axis] + dir[axis] * o.position;
        if (startAfter ? at <= cut : at > cut) o.position += Math.abs(delta) * Math.sign(delta);
      }
    }
    shift(w.start);
    shift(w.end);
    w.points?.forEach(shift);
  }
  for (const list of [floor.objects, floor.stairs, floor.pillars, floor.plants])
    list.forEach((o) => shift(o.transform));
  floor.beams.forEach((b) => {
    shift(b.start);
    shift(b.end);
  });
  floor.dimensions.forEach((d) => {
    shift(d.a);
    shift(d.b);
  });
  floor.labels.forEach((l) => shift(l.at));
  floor.electrical.forEach((e) => shift(e.at));
  floor.plumbing.forEach((e) => shift(e.at));
  floor.slabs.forEach((s) => s.polygon.forEach(shift));
}

/** Sets a room's clear width or depth, measured across its outer extents. */
export function setRoomSize(floor: Floor, roomId: Id, axis: 'x' | 'y', size: number): void {
  const room = floor.rooms.find((r) => r.id === roomId);
  if (!room || size <= 200) return;
  const values = room.polygon.map((p) => p[axis]);
  const current = Math.max(...values) - Math.min(...values);
  const delta = size - current;
  if (Math.abs(delta) < 0.5) return;
  stretchPlan(floor, axis, room.centroid[axis], delta);
}

/** Finds the wall nearest to a point, within a reach, with where on it the point falls. */
export function nearestWall(
  floor: Floor,
  p: Vec2,
  reach: number,
): { wall: Wall; along: number; point: Vec2 } | null {
  let best: { wall: Wall; along: number; point: Vec2; distance: number } | null = null;
  for (const wall of floor.walls) {
    if (wall.hidden) continue;
    const hit = distanceAlongWall(wall, p);
    if (hit.distance <= Math.max(reach, wall.thickness / 2) && (!best || hit.distance < best.distance)) {
      best = { wall, along: hit.along, point: hit.point, distance: hit.distance };
    }
  }
  return best;
}

const STANDARD_FLOOR_NAME = /^(Ground Floor|First Floor|Second Floor|Floor \d+|Upper Floor \d+|Basement)$/;

/** The usual name for a storey at this level. */
export function floorNameFor(levelIndex: number): string {
  if (levelIndex < 0) return 'Basement';
  return ['Ground Floor', 'First Floor', 'Second Floor'][levelIndex] ?? `Floor ${levelIndex}`;
}

/**
 * Puts floors, listed bottom to top, back on consecutive levels with the ground level at height zero.
 * A floor with a standard name is renamed for where it now sits; a name the user chose is kept.
 */
export function relevelFloors(floors: Floor[], basements: number): void {
  let elevation = 0;
  for (let i = basements - 1; i >= 0; i--) elevation -= floors[i].floorToFloor;
  floors.forEach((f, i) => {
    f.levelIndex = i - basements;
    f.elevation = elevation;
    elevation += f.floorToFloor;
    if (STANDARD_FLOOR_NAME.test(f.name)) f.name = floorNameFor(f.levelIndex);
  });
}

/** Moves a floor one place up (+1) or down (-1) in the building. Walls and contents travel with it. */
export function moveFloor(floors: Floor[], id: Id, direction: 1 | -1): boolean {
  const i = floors.findIndex((f) => f.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= floors.length) return false;
  const basements = floors.filter((f) => f.levelIndex < 0).length;
  [floors[i], floors[j]] = [floors[j], floors[i]];
  relevelFloors(floors, basements);
  return true;
}

/**
 * A new floor from an existing one. 'layout' keeps the building: walls, doors, windows, rooms, pillars,
 * beams, slabs and stairs. 'all' also keeps furniture, plants, fittings and notes.
 */
export function copyFloor(source: Floor, id: Id, mode: 'layout' | 'all'): Floor {
  const copy = JSON.parse(JSON.stringify(source)) as Floor;
  copy.id = id;
  if (mode === 'layout') {
    copy.objects = [];
    copy.plants = [];
    copy.electrical = [];
    copy.plumbing = [];
    copy.labels = [];
    copy.dimensions = [];
  }
  const wallIds = new Map<string, string>();
  for (const w of copy.walls) {
    const fresh = newId();
    wallIds.set(w.id, fresh);
    w.id = fresh;
  }
  for (const o of copy.openings) {
    o.id = newId();
    o.wallId = wallIds.get(o.wallId) ?? o.wallId;
    // A house has one front door.
    o.isMainEntrance = false;
  }
  for (const list of [
    copy.rooms,
    copy.stairs,
    copy.pillars,
    copy.beams,
    copy.slabs,
    copy.objects,
    copy.plants,
    copy.dimensions,
    copy.labels,
    copy.electrical,
    copy.plumbing,
  ]) {
    for (const item of list as { id: string }[]) item.id = newId();
  }
  return copy;
}

/** Changes the width or length of a slab by stretching its outline from its centre. */
export function setSlabSize(floor: Floor, id: Id, axis: 'x' | 'y', size: number): void {
  const slab = floor.slabs.find((x) => x.id === id);
  if (!slab) return;
  const values = slab.polygon.map((p) => p[axis]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (high - low < 1) return;
  const middle = (low + high) / 2;
  const k = size / (high - low);
  const stretch = (p: Vec2) => {
    p[axis] = Math.round(middle + (p[axis] - middle) * k);
  };
  slab.polygon.forEach(stretch);
  slab.holes.forEach((h) => h.forEach(stretch));
}
