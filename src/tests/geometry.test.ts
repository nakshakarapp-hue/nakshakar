import { describe, expect, it } from 'vitest';
import {
  centroid,
  clipPolygonRange,
  netArea,
  offsetPolygon,
  perimeter,
  pointInPolygon,
  polygonArea,
  signedArea,
  simplifyPolygon,
  subtractPolygons,
  unionPolygons,
} from '../core/geometry/polygon';
import { triangulate, triangulatedArea } from '../core/geometry/triangulate';
import {
  buildWallGraph,
  detectFaces,
  distanceAlongWall,
  pointOnWall,
  wallLength,
  wallPath,
} from '../core/geometry/wallGraph';
import { bearingOf, compassZone, detectRooms, zoneFromBearing } from '../core/geometry/rooms';
import { createWall } from '../core/model/defaults';
import type { Vec2, Wall } from '../core/model/types';

const P = (x: number, y: number): Vec2 => ({ x, y });
const square = (s: number, x = 0, y = 0): Vec2[] => [P(x, y), P(x + s, y), P(x + s, y + s), P(x, y + s)];

function loop(points: Vec2[], thickness = 200): Wall[] {
  return points.map((p, i) => createWall(p, points[(i + 1) % points.length], { thickness }));
}

const rooms = (walls: Wall[]) => detectRooms({ walls, rooms: [] }, 0);

describe('polygon basics', () => {
  it('computes area, perimeter and centroid', () => {
    const s = square(100);
    expect(signedArea(s)).toBe(10000);
    expect(polygonArea([...s].reverse())).toBe(10000);
    expect(perimeter(s)).toBe(400);
    expect(centroid(s)).toEqual(P(50, 50));
  });
  it('tests containment on a concave L', () => {
    const l = [P(0, 0), P(100, 0), P(100, 50), P(50, 50), P(50, 100), P(0, 100)];
    expect(pointInPolygon(P(25, 75), l)).toBe(true);
    expect(pointInPolygon(P(75, 75), l)).toBe(false);
  });
  it('insets and outsets', () => {
    expect(polygonArea(offsetPolygon(square(100), -10))).toBeCloseTo(6400, 6);
    expect(polygonArea(offsetPolygon(square(100), 10))).toBeCloseTo(14400, 6);
  });
  it('supports a different offset per edge', () => {
    expect(polygonArea(offsetPolygon(square(100), [-10, 0, -10, 0]))).toBeCloseTo(8000, 6);
  });
  it('simplifies duplicates and collinear points', () => {
    const s = [P(0, 0), P(50, 0), P(100, 0), P(100, 0), P(100, 100), P(0, 100)];
    expect(simplifyPolygon(s)).toHaveLength(4);
  });
  it('clips a polygon to a range', () => {
    const c = clipPolygonRange(square(100), P(0, 0), P(1, 0), 25, 75);
    expect(polygonArea(c)).toBeCloseTo(5000, 6);
  });
  it('unions and subtracts', () => {
    const u = unionPolygons([square(100), square(100, 50, 0)]);
    expect(netArea(u)).toBeCloseTo(15000, 3);
    const d = subtractPolygons({ outer: square(100), holes: [] }, [square(20, 40, 40)]);
    expect(netArea(d)).toBeCloseTo(9600, 3);
  });
});

describe('triangulation', () => {
  it('covers a convex shape', () => {
    const t = triangulate(square(100));
    expect(t.indices).toHaveLength(6);
    expect(triangulatedArea(t.vertices, t.indices)).toBeCloseTo(10000, 6);
  });
  it('covers a concave shape in either winding', () => {
    const l = [P(0, 0), P(100, 0), P(100, 50), P(50, 50), P(50, 100), P(0, 100)];
    expect(triangulatedArea(...spread(triangulate(l)))).toBeCloseTo(7500, 6);
    expect(triangulatedArea(...spread(triangulate([...l].reverse())))).toBeCloseTo(7500, 6);
  });
  it('covers a shape with one hole', () => {
    expect(triangulatedArea(...spread(triangulate(square(100), [square(20, 40, 40)])))).toBeCloseTo(9600, 6);
  });
  it('covers a shape with several holes', () => {
    const t = triangulate(square(300), [square(20, 40, 40), square(30, 200, 200), square(10, 150, 50)]);
    expect(triangulatedArea(t.vertices, t.indices)).toBeCloseTo(90000 - 400 - 900 - 100, 6);
  });
});

function spread(t: { vertices: Vec2[]; indices: number[] }): [Vec2[], number[]] {
  return [t.vertices, t.indices];
}

/** Sum of footprint areas equals the union area only if junctions neither overlap nor leave gaps. */
function expectTiled(walls: Wall[]) {
  const g = buildWallGraph(walls);
  const polys = g.edges.map((e) => e.polygon);
  const sum = polys.reduce((s, p) => s + polygonArea(p), 0);
  const union = netArea(unionPolygons(polys));
  expect(Math.abs(sum - union) / union).toBeLessThan(1e-3);
  return g;
}

describe('triangulation stress', () => {
  it('conserves area for aligned and scattered holes', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 16807) % 2147483647;
      return seed % n;
    };
    for (let run = 0; run < 200; run++) {
      const cells = 2 + rand(4);
      const size = 1000;
      const holes: Vec2[][] = [];
      let holeArea = 0;
      for (let i = 0; i < cells; i++) {
        for (let j = 0; j < cells; j++) {
          if (rand(2) === 0) continue;
          const s = 100 * (1 + rand(5));
          const x = i * size + 100 * (1 + rand(3));
          const y = j * size + 100 * (1 + rand(3));
          holes.push(square(s, x, y));
          holeArea += s * s;
        }
      }
      const outer = square(cells * size);
      const t = triangulate(outer, holes);
      expect(triangulatedArea(t.vertices, t.indices)).toBeCloseTo(
        outer.length && (cells * size) ** 2 - holeArea,
        3,
      );
    }
  });
});

describe('wall junctions', () => {
  it('mitres a rectangle with no gap or overlap', () => {
    const g = expectTiled(loop(square(4000)));
    expect(g.nodes).toHaveLength(4);
    // Outer footprint is 4200 square and the clear hole is 3800 square.
    const total = g.edges.reduce((s, e) => s + polygonArea(e.polygon), 0);
    expect(total).toBeCloseTo(4200 ** 2 - 3800 ** 2, 3);
  });
  it('splits a wall at a T-junction', () => {
    const through = createWall(P(0, 0), P(4000, 0), { thickness: 200 });
    const stem = createWall(P(2000, 0), P(2000, 3000), { thickness: 100 });
    const g = expectTiled([through, stem]);
    expect(g.edges).toHaveLength(3);
    const total = g.edges.reduce((s, e) => s + polygonArea(e.polygon), 0);
    expect(total).toBeCloseTo(4000 * 200 + 2900 * 100, 3);
    expect(
      g.edges
        .filter((e) => e.wallId === through.id)
        .map((e) => e.endDist)
        .sort((a, b) => a - b),
    ).toEqual([2000, 4000]);
  });
  it('splits both walls at a cross junction', () => {
    const a = createWall(P(0, 2000), P(4000, 2000));
    const b = createWall(P(2000, 0), P(2000, 4000));
    const g = expectTiled([a, b]);
    expect(g.edges).toHaveLength(4);
    const total = g.edges.reduce((s, e) => s + polygonArea(e.polygon), 0);
    expect(total).toBeCloseTo(4000 * 230 * 2 - 230 * 230, 2);
  });
  it('joins different thicknesses at a corner', () => {
    const a = createWall(P(0, 0), P(4000, 0), { thickness: 300 });
    const b = createWall(P(4000, 0), P(4000, 3000), { thickness: 100 });
    expectTiled([a, b]);
  });
  it('merges overlapping collinear walls', () => {
    const a = createWall(P(0, 0), P(3000, 0));
    const b = createWall(P(1000, 0), P(4000, 0));
    const g = buildWallGraph([a, b]);
    expect(g.edges).toHaveLength(3);
    expect(g.edges.reduce((s, e) => s + Math.abs(e.endDist - e.startDist), 0)).toBeCloseTo(4000, 3);
  });
  it('ignores tiny walls without crashing', () => {
    const g = buildWallGraph([createWall(P(0, 0), P(1, 0)), createWall(P(0, 0), P(3000, 0))]);
    expect(g.edges).toHaveLength(1);
  });
  it('joins endpoints within tolerance', () => {
    const g = buildWallGraph([createWall(P(0, 0), P(1000, 0)), createWall(P(1001, 0.5), P(1001, 1000))]);
    expect(g.nodes).toHaveLength(3);
  });
  it('honours wall justification', () => {
    const w = createWall(P(0, 0), P(1000, 0), { thickness: 200, justification: 'left' });
    const g = buildWallGraph([w]);
    expect(g.edges[0].leftOffset).toBe(0);
    expect(g.edges[0].rightOffset).toBe(200);
  });
  it('does not let a very acute mitre spike', () => {
    const a = createWall(P(0, 0), P(3000, 0), { thickness: 200 });
    const b = createWall(P(3000, 0), P(0, 60), { thickness: 200 });
    const g = buildWallGraph([a, b]);
    for (const e of g.edges) {
      for (const p of e.polygon) expect(p.x).toBeLessThan(3400);
    }
  });
});

describe('curved walls', () => {
  it('computes length and midpoint of a semicircle', () => {
    const w = createWall(P(0, 0), P(2000, 0), { bulge: 1 });
    expect(wallLength(w)).toBeCloseTo(Math.PI * 1000, 3);
    const m = pointOnWall(w, wallLength(w) / 2).point;
    expect(m.x).toBeCloseTo(1000, 0);
    // Positive bulge leans to the wall's left, which is up the screen.
    expect(m.y).toBeLessThan(-900);
  });
  it('bulges to the other side when negative', () => {
    const w = createWall(P(0, 0), P(2000, 0), { bulge: -1 });
    expect(pointOnWall(w, wallLength(w) / 2).point.y).toBeGreaterThan(900);
  });
  it('detects a circular room made of two arcs', () => {
    const r = rooms([
      createWall(P(0, 0), P(4000, 0), { bulge: 1, thickness: 100 }),
      createWall(P(4000, 0), P(0, 0), { bulge: 1, thickness: 100 }),
    ]);
    expect(r).toHaveLength(1);
    // Clear radius 1950; the 15 degree chords make the polygon slightly smaller than a true circle.
    expect(r[0].area).toBeGreaterThan(Math.PI * 1.95 ** 2 * 0.97);
    expect(r[0].area).toBeLessThan(Math.PI * 1.95 ** 2);
  });
  it('finds the nearest point along a wall', () => {
    const w = createWall(P(0, 0), P(1000, 0));
    const hit = distanceAlongWall(w, P(400, 80));
    expect(hit.along).toBeCloseTo(400, 6);
    expect(hit.distance).toBeCloseTo(80, 6);
  });
  it('walks a polyline wall', () => {
    const w = createWall(P(0, 0), P(1000, 1000), { points: [P(1000, 0)] });
    expect(wallPath(w)).toHaveLength(3);
    expect(wallLength(w)).toBe(2000);
    expect(pointOnWall(w, 1500).point).toEqual(P(1000, 500));
    expect(pointOnWall(w, 9999).point).toEqual(P(1000, 1000));
  });
});

describe('room detection', () => {
  it('finds a rectangle and measures clear area', () => {
    const r = rooms(loop(square(4000), 200));
    expect(r).toHaveLength(1);
    expect(r[0].area).toBeCloseTo(3.8 * 3.8, 3);
    expect(r[0].perimeter).toBeCloseTo(3800 * 4, 3);
  });
  it('finds an L-shape', () => {
    const l = [P(0, 0), P(6000, 0), P(6000, 3000), P(3000, 3000), P(3000, 6000), P(0, 6000)];
    const r = rooms(loop(l, 200));
    expect(r).toHaveLength(1);
    expect(r[0].area).toBeCloseTo(5.8 * 2.8 + 2.8 * 3, 2);
  });
  it('finds two rooms split by a T-connected wall', () => {
    const walls = [...loop(square(6000), 200), createWall(P(3000, 0), P(3000, 6000), { thickness: 100 })];
    const r = rooms(walls);
    expect(r).toHaveLength(2);
    expect(r[0].area).toBeCloseTo(2.85 * 5.8, 2);
  });
  it('handles a room with a courtyard island', () => {
    const walls = [...loop(square(10000), 200), ...loop(square(3000, 3500, 3500), 200)];
    const r = rooms(walls);
    expect(r).toHaveLength(2);
    const big = r.find((x) => x.area > 20)!;
    const court = r.find((x) => x.area < 20)!;
    expect(big.holes).toHaveLength(1);
    expect(big.area).toBeCloseTo(9.8 * 9.8 - 3.2 * 3.2, 2);
    expect(court.area).toBeCloseTo(2.8 * 2.8, 2);
    expect(pointInPolygon(big.centroid, court.polygon)).toBe(false);
  });
  it('ignores dangling walls and open shapes', () => {
    expect(rooms([createWall(P(0, 0), P(3000, 0)), createWall(P(3000, 0), P(3000, 3000))])).toHaveLength(0);
    const r = rooms([...loop(square(4000)), createWall(P(4000, 2000), P(6000, 2000))]);
    expect(r).toHaveLength(1);
  });
  it('ignores compound walls and specks', () => {
    const compound = loop(square(4000)).map((w) => ({ ...w, type: 'compound' as const }));
    expect(rooms(compound)).toHaveLength(0);
    expect(rooms(loop(square(100), 10))).toHaveLength(0);
  });
  it('keeps name and type across a resize', () => {
    const before = rooms(loop(square(4000)));
    const edited = [{ ...before[0], name: 'Kitchen', type: 'kitchen' as const, userNamed: true }];
    const after = detectRooms({ walls: loop(square(4500)), rooms: edited }, 0);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].name).toBe('Kitchen');
    expect(after[0].type).toBe('kitchen');
  });
  it('detects rooms from walls drawn in any direction', () => {
    const r = rooms(loop([...square(4000)].reverse(), 200));
    expect(r).toHaveLength(1);
    expect(r[0].area).toBeCloseTo(3.8 * 3.8, 3);
  });
  it('gives each of a grid of rooms its own area', () => {
    const walls = [
      ...loop(square(8000), 200),
      createWall(P(4000, 0), P(4000, 8000), { thickness: 200 }),
      createWall(P(0, 4000), P(8000, 4000), { thickness: 200 }),
    ];
    const faces = detectFaces(buildWallGraph(walls));
    expect(faces).toHaveLength(4);
    const r = rooms(walls);
    r.forEach((x) => expect(x.area).toBeCloseTo(3.8 * 3.8, 3));
  });
});

describe('compass', () => {
  it('computes bearings', () => {
    expect(bearingOf(0, -1, 0)).toBeCloseTo(0);
    expect(bearingOf(1, 0, 0)).toBeCloseTo(90);
    expect(bearingOf(0, 1, 0)).toBeCloseTo(180);
    expect(bearingOf(-1, 0, 0)).toBeCloseTo(270);
    expect(bearingOf(0, -1, 90)).toBeCloseTo(270);
  });
  it('names 8 directions', () => {
    expect(zoneFromBearing(0)).toBe('N');
    expect(zoneFromBearing(44)).toBe('NE');
    expect(zoneFromBearing(359)).toBe('N');
    expect(zoneFromBearing(225)).toBe('SW');
  });
  it('classifies rooms on the 3 x 3 grid', () => {
    const f = square(9000);
    expect(compassZone(P(1000, 1000), f, 0)).toBe('NW');
    expect(compassZone(P(8000, 1000), f, 0)).toBe('NE');
    expect(compassZone(P(4500, 4500), f, 0)).toBe('C');
    expect(compassZone(P(1000, 8000), f, 0)).toBe('SW');
    expect(compassZone(P(8000, 8000), f, 0)).toBe('SE');
    expect(compassZone(P(1, 1), [], 0)).toBe('C');
  });
  it('rotates the grid with the north arrow', () => {
    // With true north rotated 90 degrees clockwise, the plan's right-hand side faces north.
    expect(compassZone(P(8000, 4500), square(9000), 90)).toBe('N');
  });
});
