import type { Vec2 } from '../model/types';
import { signedArea } from './polygon';

interface Vert {
  x: number;
  y: number;
  /** Index into the returned vertex list. */
  i: number;
}

function isConvex(a: Vert, b: Vert, c: Vert): boolean {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0;
}

function pointInTriangle(p: Vert, a: Vert, b: Vert, c: Vert): boolean {
  const s1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const s2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
  const s3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
  return s1 >= -1e-9 && s2 >= -1e-9 && s3 >= -1e-9;
}

function segmentsCross(a: Vert, b: Vert, c: Vert, d: Vert): boolean {
  const o = (p: Vert, q: Vert, r: Vert) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < -1e-9 && o(c, d, a) * o(c, d, b) < -1e-9;
}

function strictlyInside(p: Vert, a: Vert, b: Vert, c: Vert): boolean {
  const s1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const s2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
  const s3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
  return s1 > 1e-9 && s2 > 1e-9 && s3 > 1e-9;
}

/** True when p lies on segment a-b but is not one of its ends. A bridge through a vertex can pass through a hole. */
function onOpenSegment(p: Vert, a: Vert, b: Vert): boolean {
  if ((p.x === a.x && p.y === a.y) || (p.x === b.x && p.y === b.y)) return false;
  const area = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(area) > 1e-6) return false;
  const along = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  return along > 0 && along < (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
}

/** Connects a hole to the outer ring with a zero-width bridge that crosses nothing. */
function bridgeHole(ring: Vert[], hole: Vert[], otherHoles: Vert[][]): Vert[] {
  const allHoles = [hole, ...otherHoles];
  let hi = 0;
  for (let i = 1; i < hole.length; i++) if (hole[i].x > hole[hi].x) hi = i;
  const hv = hole[hi];
  const candidates = ring
    .map((r, idx) => ({ idx, d: (r.x - hv.x) ** 2 + (r.y - hv.y) ** 2 }))
    .sort((m, n) => m.d - n.d);
  const blocks = (r: Vert, loop: Vert[]) =>
    loop.some((p, i) => segmentsCross(hv, r, p, loop[(i + 1) % loop.length]) || onOpenSegment(p, hv, r));
  // After earlier bridges a location appears twice in the ring; only the copy whose interior wedge holds the bridge is valid.
  const inWedge = (idx: number) => {
    const n = ring.length;
    const r = ring[idx];
    const before = ring[(idx - 1 + n) % n];
    const after = ring[(idx + 1) % n];
    const left = (a: Vert, b: Vert) => (b.x - a.x) * (hv.y - a.y) - (b.y - a.y) * (hv.x - a.x) > 0;
    return isConvex(before, r, after) ? left(before, r) && left(r, after) : left(before, r) || left(r, after);
  };
  const clear = (idx: number) =>
    inWedge(idx) && !blocks(ring[idx], ring) && !allHoles.some((h) => blocks(ring[idx], h));
  const pick = candidates.find((c) => clear(c.idx)) ?? candidates[0];
  const rv = ring[pick.idx];
  const rotated = [...hole.slice(hi), ...hole.slice(0, hi)];
  return [...ring.slice(0, pick.idx + 1), ...rotated, { ...hv }, { ...rv }, ...ring.slice(pick.idx + 1)];
}

/**
 * Ear clipping with holes. Returns the flattened vertices and triangle indices, which wind so that
 * the triangle area is positive in plan coordinates.
 */
export function triangulate(outer: Vec2[], holes: Vec2[][] = []): { vertices: Vec2[]; indices: number[] } {
  const vertices: Vec2[] = [];
  const toRing = (poly: Vec2[], positive: boolean): Vert[] => {
    const ordered = signedArea(poly) > 0 === positive ? poly : [...poly].reverse();
    return ordered.map((p) => {
      vertices.push(p);
      return { x: p.x, y: p.y, i: vertices.length - 1 };
    });
  };
  let ring = toRing(outer, true);
  const holeRings = holes.filter((h) => h.length >= 3).map((h) => toRing(h, false));
  // Rightmost holes first keeps bridges from crossing later holes.
  const order = [...holeRings].sort(
    (a, b) => Math.max(...b.map((p) => p.x)) - Math.max(...a.map((p) => p.x)),
  );
  order.forEach((h, k) => {
    ring = bridgeHole(ring, h, order.slice(k + 1));
  });

  const indices: number[] = [];
  clipEars(ring.slice(), indices);
  return { vertices, indices };
}

/** A diagonal between two ring vertices that stays inside the ring and touches nothing on the way. */
function validDiagonal(ring: Vert[], i: number, j: number): boolean {
  const a = ring[i];
  const b = ring[j];
  if (a.x === b.x && a.y === b.y) return false;
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k];
    if (segmentsCross(a, b, p, ring[(k + 1) % ring.length]) || onOpenSegment(p, a, b)) return false;
  }
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let inside = false;
  for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) {
    const p = ring[k];
    const q = ring[l];
    if (p.y > m.y !== q.y > m.y && m.x < ((q.x - p.x) * (m.y - p.y)) / (q.y - p.y) + p.x) inside = !inside;
  }
  return inside;
}

function clipEars(verts: Vert[], indices: number[]): void {
  let idx = 0;
  let sinceEar = 0;
  while (verts.length > 3) {
    const n = verts.length;
    const a = verts[(idx - 1 + n) % n];
    const b = verts[idx % n];
    const c = verts[(idx + 1) % n];
    if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-9) {
      verts.splice(idx % n, 1);
      sinceEar = 0;
      continue;
    }
    let ear = isConvex(a, b, c);
    if (ear) {
      for (let k = 0; k < n; k++) {
        const p = verts[k];
        if (p === a || p === b || p === c) continue;
        const coincident =
          (p.x === a.x && p.y === a.y) || (p.x === b.x && p.y === b.y) || (p.x === c.x && p.y === c.y);
        if (coincident || !pointInTriangle(p, a, b, c)) continue;
        // Anything strictly inside blocks. On the ear's edge only a reflex or collinear vertex does; a convex one just touches.
        if (strictlyInside(p, a, b, c) || !isConvex(verts[(k - 1 + n) % n], p, verts[(k + 1) % n])) {
          ear = false;
          break;
        }
      }
    }
    if (ear) {
      indices.push(a.i, b.i, c.i);
      verts.splice(idx % n, 1);
      idx = Math.max(0, idx - 1);
      sinceEar = 0;
    } else {
      idx = (idx + 1) % n;
      // A fruitless lap means bridge twins are blocking every ear: divide the ring along a valid diagonal.
      if (++sinceEar > n) {
        for (let i = 0; i < n; i++) {
          for (let j = i + 2; j < n; j++) {
            if ((i === 0 && j === n - 1) || !validDiagonal(verts, i, j)) continue;
            clipEars(verts.slice(i, j + 1), indices);
            clipEars([...verts.slice(j), ...verts.slice(0, i + 1)], indices);
            return;
          }
        }
        return;
      }
    }
  }
  if (verts.length === 3) indices.push(verts[0].i, verts[1].i, verts[2].i);
}

/** Sum of triangle areas, used to check that triangulation covers the shape exactly. */
export function triangulatedArea(vertices: Vec2[], indices: number[]): number {
  let total = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = vertices[indices[i]];
    const b = vertices[indices[i + 1]];
    const c = vertices[indices[i + 2]];
    total += Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  }
  return total;
}
