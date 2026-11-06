import polygonClipping, { type MultiPolygon, type Polygon as ClipPolygon, type Ring } from 'polygon-clipping';
import type { Vec2 } from '../model/types';
import { add, cross, dist, leftNormal, lineIntersection, norm, scale, sub } from './vec';

/** Shoelace area. Positive means clockwise on screen, because +y points down. */
export function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const polygonArea = (poly: Vec2[]): number => Math.abs(signedArea(poly));

export function perimeter(poly: Vec2[]): number {
  let total = 0;
  for (let i = 0; i < poly.length; i++) total += dist(poly[i], poly[(i + 1) % poly.length]);
  return total;
}

export function centroid(poly: Vec2[]): Vec2 {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-6) {
    const s = poly.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
    return poly.length ? scale(s, 1 / poly.length) : s;
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bbox(points: Vec2[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** A point guaranteed to be inside a simple polygon: the centroid if it qualifies, else a scanline midpoint. */
export function interiorPoint(poly: Vec2[], holes: Vec2[][] = []): Vec2 {
  const inArea = (p: Vec2) => pointInPolygon(p, poly) && !holes.some((h) => pointInPolygon(p, h));
  const c = centroid(poly);
  if (inArea(c)) return c;
  const box = bbox(poly);
  for (let k = 1; k < 16; k++) {
    const y = box.minY + ((box.maxY - box.minY) * k) / 16;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const p = { x: (xs[i] + xs[i + 1]) / 2, y };
      if (inArea(p)) return p;
    }
  }
  return c;
}

/** Removes vertices that repeat their neighbour or sit on a straight line between neighbours. */
export function simplifyPolygon(poly: Vec2[], tolerance = 0.5): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) {
    if (!out.length || dist(out[out.length - 1], p) > tolerance) out.push(p);
  }
  while (out.length > 1 && dist(out[0], out[out.length - 1]) <= tolerance) out.pop();
  for (let i = out.length - 1; i >= 0 && out.length > 3; i--) {
    const a = out[(i - 1 + out.length) % out.length];
    const b = out[i];
    const c = out[(i + 1) % out.length];
    const ab = sub(b, a);
    const bc = sub(c, b);
    const l = Math.hypot(ab.x, ab.y) * Math.hypot(bc.x, bc.y);
    if (l > 0 && Math.abs(cross(ab, bc)) / l < 1e-4 && ab.x * bc.x + ab.y * bc.y > 0) out.splice(i, 1);
  }
  return out;
}

/**
 * Offsets each polygon edge along its left normal by distances[i] (negative moves right) and re-joins
 * the moved lines. Parallel neighbours with different distances get a small connecting step.
 * Very sharp corners keep a bevel so the result cannot spike out of the shape.
 */
export function offsetPolygon(poly: Vec2[], distances: number | number[]): Vec2[] {
  const n = poly.length;
  const d = (i: number) => (typeof distances === 'number' ? distances : distances[i]);
  const edges = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const dir = norm(sub(q, p));
    const off = scale(leftNormal(dir), d(i));
    return { a: add(p, off), b: add(q, off), dir };
  });
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = edges[(i - 1 + n) % n];
    const cur = edges[i];
    const hit = lineIntersection(prev.a, prev.dir, cur.a, cur.dir);
    const limit = 4 * Math.max(Math.abs(d((i - 1 + n) % n)), Math.abs(d(i)), 1);
    if (!hit || dist(hit, poly[i]) > limit) {
      out.push(prev.b);
      if (dist(prev.b, cur.a) > 0.01) out.push(cur.a);
    } else {
      out.push(hit);
    }
  }
  return out;
}

/** Keeps the part of a polygon whose coordinate along `axis` from `origin` lies within t0..t1. */
export function clipPolygonRange(poly: Vec2[], origin: Vec2, axis: Vec2, t0: number, t1: number): Vec2[] {
  const clip = (input: Vec2[], keep: (t: number) => number): Vec2[] => {
    const out: Vec2[] = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i];
      const q = input[(i + 1) % input.length];
      const fp = keep((p.x - origin.x) * axis.x + (p.y - origin.y) * axis.y);
      const fq = keep((q.x - origin.x) * axis.x + (q.y - origin.y) * axis.y);
      if (fp >= 0) out.push(p);
      if (fp >= 0 !== fq >= 0) {
        const u = fp / (fp - fq);
        out.push({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u });
      }
    }
    return out;
  };
  return clip(
    clip(poly, (t) => t - t0),
    (t) => t1 - t,
  );
}

const toRing = (poly: Vec2[]): Ring => poly.map((p) => [p.x, p.y] as [number, number]);
const fromRing = (ring: Ring): Vec2[] => {
  const pts = ring.map(([x, y]) => ({ x, y }));
  if (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 1e-9) pts.pop();
  return pts;
};

export interface PolygonWithHoles {
  outer: Vec2[];
  holes: Vec2[][];
}

const fromMulti = (m: MultiPolygon): PolygonWithHoles[] =>
  m.map((rings: ClipPolygon) => ({ outer: fromRing(rings[0]), holes: rings.slice(1).map(fromRing) }));

const usable = (poly: Vec2[]) => poly.length >= 3 && polygonArea(poly) > 1;

/** Union of simple polygons. Used for floor footprints and to verify wall junctions. */
export function unionPolygons(polys: Vec2[][]): PolygonWithHoles[] {
  const rings = polys.filter(usable).map((p) => [toRing(p)] as ClipPolygon);
  if (!rings.length) return [];
  return fromMulti(polygonClipping.union(rings[0], ...rings.slice(1)));
}

/** Subtracts polygons from a shape. Used to cut stair voids out of floor slabs. */
export function subtractPolygons(subject: PolygonWithHoles, cutters: Vec2[][]): PolygonWithHoles[] {
  const s: ClipPolygon = [toRing(subject.outer), ...subject.holes.map(toRing)];
  const c = cutters.filter(usable).map((p) => [toRing(p)] as ClipPolygon);
  if (!c.length) return [subject];
  return fromMulti(polygonClipping.difference(s, ...c));
}

/** Total area of shapes, net of holes. */
export function netArea(shapes: PolygonWithHoles[]): number {
  return shapes.reduce(
    (sum, s) => sum + polygonArea(s.outer) - s.holes.reduce((h, r) => h + polygonArea(r), 0),
    0,
  );
}
