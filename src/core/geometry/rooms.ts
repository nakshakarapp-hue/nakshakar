import { createRoom } from '../model/defaults';
import type { CompassZone, Floor, Room, RoomType, Vec2, Wall } from '../model/types';
import {
  bbox,
  centroid,
  interiorPoint,
  offsetPolygon,
  perimeter,
  pointInPolygon,
  polygonArea,
  simplifyPolygon,
} from './polygon';
import { buildWallGraph, detectFaces, wallPath } from './wallGraph';
import { rotate } from './vec';

/** Compound and retaining walls enclose the site, not rooms. */
export const boundsRooms = (w: Wall): boolean => w.type !== 'compound' && w.type !== 'retaining';

/** Compass bearing in degrees (0 is north, 90 is east) of a plan direction. */
export function bearingOf(dx: number, dy: number, northAngleDeg: number): number {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI - northAngleDeg;
  return ((deg % 360) + 360) % 360;
}

const ZONE_NAMES: CompassZone[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function zoneFromBearing(bearing: number): CompassZone {
  return ZONE_NAMES[Math.round(bearing / 45) % 8];
}

/** Rotates a plan point into a frame where -y is true north. */
const toTrueNorth = (p: Vec2, northAngleDeg: number): Vec2 => rotate(p, -northAngleDeg);

/**
 * Classifies a point into the 3 x 3 Vastu grid (Brahmasthan in the centre) laid over the extents
 * of `footprint` and aligned with true north.
 */
export function compassZone(point: Vec2, footprint: Vec2[], northAngleDeg: number): CompassZone {
  if (!footprint.length) return 'C';
  const box = bbox(footprint.map((p) => toTrueNorth(p, northAngleDeg)));
  const q = toTrueNorth(point, northAngleDeg);
  const u = (q.x - box.minX) / Math.max(1, box.maxX - box.minX);
  const w = (q.y - box.minY) / Math.max(1, box.maxY - box.minY);
  const col = u < 1 / 3 ? 0 : u < 2 / 3 ? 1 : 2;
  const row = w < 1 / 3 ? 0 : w < 2 / 3 ? 1 : 2;
  return (
    [
      ['NW', 'N', 'NE'],
      ['W', 'C', 'E'],
      ['SW', 'S', 'SE'],
    ] as CompassZone[][]
  )[row][col];
}

/**
 * Which side of a wall faces a room at a point on it: +1 for the wall's left, -1 for its right.
 * When both sides or neither side is a room, walls drawn clockwise have the room on their right.
 */
export function roomSideOfWall(
  rooms: Pick<Room, 'centerline'>[],
  point: Vec2,
  leftNormal: Vec2,
  reach: number,
): 1 | -1 {
  const probe = (s: number) => ({ x: point.x + leftNormal.x * s, y: point.y + leftNormal.y * s });
  const inRoom = (p: Vec2) => rooms.some((r) => pointInPolygon(p, r.centerline));
  return inRoom(probe(reach)) && !inRoom(probe(-reach)) ? 1 : -1;
}

/** Outline points of all walls on a floor. */
export function floorExtents(walls: Wall[]): Vec2[] {
  return walls.filter(boundsRooms).flatMap((w) => wallPath(w));
}

/** Detects rooms from wall loops, keeping the identity and finishes of rooms that already existed. */
export function detectRooms(floor: Pick<Floor, 'walls' | 'rooms'>, northAngleDeg: number): Room[] {
  const byId = new Map(floor.walls.map((w) => [w.id, w]));
  const graph = buildWallGraph(floor.walls);
  const faces = detectFaces(graph, (id) => {
    const w = byId.get(id);
    return !!w && boundsRooms(w);
  });
  const extents = floorExtents(floor.walls);
  const taken = new Set<string>();
  const counts = new Map<RoomType, number>();
  const rooms: Room[] = [];

  // Faces are traversed clockwise, so the room interior lies on the right of each edge.
  const sorted = [...faces].sort((a, b) => polygonArea(b.outline) - polygonArea(a.outline));
  for (const face of sorted) {
    const clear = simplifyPolygon(
      offsetPolygon(
        face.outline,
        face.clearances.map((c) => -c),
      ),
    );
    const holes = face.holes.map((h) =>
      simplifyPolygon(
        offsetPolygon(
          h.outline,
          h.clearances.map((c) => -c),
        ),
      ),
    );
    const polygon = clear.length >= 3 ? clear : face.outline;
    const area = polygonArea(polygon) - holes.reduce((s, h) => s + polygonArea(h), 0);
    const c = holes.length ? interiorPoint(polygon, holes) : centroidOrInterior(polygon);

    const prev = floor.rooms.find(
      (r) => !taken.has(r.id) && pointInPolygon(r.centroid, face.outline) && pointInPolygon(c, r.centerline),
    );
    const base =
      prev ?? floor.rooms.find((r) => !taken.has(r.id) && pointInPolygon(r.centroid, face.outline));
    if (base) taken.add(base.id);

    const zone = compassZone(c, extents, northAngleDeg);
    const fields = {
      polygon,
      holes,
      centerline: face.outline,
      area: area / 1e6,
      perimeter: perimeter(polygon),
      centroid: c,
      zone,
    };
    if (base) {
      rooms.push({ ...base, ...fields });
    } else {
      const n = (counts.get('other') ?? 0) + floor.rooms.length + rooms.length + 1;
      counts.set('other', (counts.get('other') ?? 0) + 1);
      rooms.push(createRoom({ ...fields, name: `Room ${n}` }));
    }
  }
  return rooms;
}

function centroidOrInterior(poly: Vec2[]): Vec2 {
  const c = centroid(poly);
  return pointInPolygon(c, poly) ? c : interiorPoint(poly);
}
