import type { Floor, ProjectSettings, Vec2 } from '../core/model/types';
import {
  closestOnSegment,
  dist,
  dot,
  fromAngle,
  norm,
  segmentIntersection,
  sub,
  add,
  scale,
  angleDeg,
} from '../core/geometry/vec';
import { wallPath, buildWallGraph } from '../core/geometry/wallGraph';

export type SnapKind =
  | 'none'
  | 'grid'
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'face'
  | 'intersection'
  | 'perpendicular'
  | 'parallel'
  | 'angle'
  | 'equal';

export interface Guide {
  a: Vec2;
  b: Vec2;
}

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  guides: Guide[];
}

export interface SnapContext {
  floor: Pick<Floor, 'walls'>;
  settings: Pick<ProjectSettings, 'snapEnabled' | 'snapOptions' | 'gridSize'>;
  /** Snap reach in plan millimetres, normally about 12 pixels at the current zoom. */
  tolerance: number;
  /** Start of the segment being drawn, enabling angle and perpendicular snaps. */
  anchor?: Vec2;
  /** Walls to ignore, such as the one being dragged. */
  ignoreIds?: Set<string>;
  /** Constrain to 45 degree steps from the anchor (Shift key). */
  constrain?: boolean;
  /** Extra points that smart guides line up with, such as furniture. */
  alignTo?: Vec2[];
}

const ANGLES = [
  0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, -165, -150, -135, -120, -105, -90, -75, -60, -45,
  -30, -15,
];

/** Finds the best snap for a pointer position. Stronger snap kinds win over weaker ones. */
export function snap(p: Vec2, ctx: SnapContext): SnapResult {
  const { settings, tolerance, anchor } = ctx;
  if (!settings.snapEnabled && !ctx.constrain) return { point: p, kind: 'none', guides: [] };
  const o = settings.snapOptions;
  const walls = ctx.floor.walls.filter((w) => !ctx.ignoreIds?.has(w.id) && !w.hidden);
  const guides: Guide[] = [];
  const enabled = settings.snapEnabled;

  type Cand = { point: Vec2; kind: SnapKind; rank: number; d: number };
  const cands: Cand[] = [];
  const consider = (point: Vec2, kind: SnapKind, rank: number) => {
    const d = dist(p, point);
    if (d <= tolerance) cands.push({ point, kind, rank, d });
  };

  if (enabled) {
    for (const w of walls) {
      const path = wallPath(w);
      if (o.endpoint) {
        consider(w.start, 'endpoint', 0);
        consider(w.end, 'endpoint', 0);
      }
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        if (o.midpoint && Math.abs(w.bulge) < 1e-3)
          consider({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'midpoint', 2);
        if (o.centerLine) {
          const hit = closestOnSegment(p, a, b);
          consider(hit.point, 'center', 4);
        }
        if (o.face) {
          const d = norm(sub(b, a));
          const n = { x: d.y, y: -d.x };
          for (const side of [w.thickness / 2, -w.thickness / 2]) {
            const fa = add(a, scale(n, side));
            const fb = add(b, scale(n, side));
            consider(closestOnSegment(p, fa, fb).point, 'face', 5);
          }
        }
        if (anchor && o.perpendicular) {
          const hit = closestOnSegment(anchor, a, b);
          if (hit.t > 0 && hit.t < 1) consider(hit.point, 'perpendicular', 3);
        }
      }
    }
    if (o.intersection) {
      const nodes = buildWallGraph(walls as Floor['walls']).nodes;
      for (const n of nodes) consider(n, 'intersection', 1);
      for (let i = 0; i < walls.length; i++) {
        for (let j = i + 1; j < walls.length; j++) {
          const hit = segmentIntersection(walls[i].start, walls[i].end, walls[j].start, walls[j].end);
          if (hit) consider(hit, 'intersection', 1);
        }
      }
    }
  }

  const best = cands.sort((m, n) => m.rank - n.rank || m.d - n.d)[0];
  if (best && best.rank <= 5) {
    // Angle snapping must not override a real point on a wall if the user is deliberately at it.
    if (best.kind !== 'center' && best.kind !== 'face') return { point: best.point, kind: best.kind, guides };
  }

  let result = best ? best.point : p;
  let kind: SnapKind = best ? best.kind : 'none';

  if (anchor) {
    const v = sub(p, anchor);
    const length = Math.hypot(v.x, v.y);
    if (length > 1) {
      if (ctx.constrain || (enabled && o.angle)) {
        const a = angleDeg(v);
        const list = ctx.constrain ? ANGLES.filter((x) => x % 45 === 0) : ANGLES;
        const closest = list.reduce((m, n) => (Math.abs(diff(a, n)) < Math.abs(diff(a, m)) ? n : m), list[0]);
        const offLine = length * Math.sin((Math.abs(diff(a, closest)) * Math.PI) / 180);
        if (ctx.constrain || offLine <= tolerance) {
          const along = dot(v, fromAngle(closest));
          result = add(anchor, fromAngle(closest, along));
          kind = 'angle';
          guides.push({ a: anchor, b: add(anchor, fromAngle(closest, along * 1.5 + 1000)) });
        }
      }
      if (enabled && o.parallel && kind !== 'angle') {
        for (const w of walls) {
          const d = norm(sub(w.end, w.start));
          const along = dot(v, d);
          const onLine = add(anchor, scale(d, along));
          if (dist(onLine, p) <= tolerance) {
            result = onLine;
            kind = 'parallel';
            guides.push({ a: w.start, b: w.end });
            break;
          }
        }
      }
      if (enabled && o.equalLength) {
        const dir = norm(sub(result, anchor));
        const current = dist(result, anchor);
        for (const w of walls) {
          const l = dist(w.start, w.end);
          if (Math.abs(l - current) <= tolerance) {
            result = add(anchor, scale(dir, l));
            kind = kind === 'none' ? 'equal' : kind;
            guides.push({ a: w.start, b: w.end });
            break;
          }
        }
      }
    }
  }

  if (enabled && kind === 'none' && o.grid && settings.gridSize > 0) {
    const g = settings.gridSize;
    result = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
    kind = 'grid';
  }

  // Smart guides: line up with the corners of other walls while dragging.
  if (enabled) {
    let alignedX = false;
    let alignedY = false;
    for (const q of [...walls.flatMap((w) => [w.start, w.end]), ...(ctx.alignTo ?? [])]) {
      {
        if (!alignedX && Math.abs(q.x - result.x) <= tolerance / 2 && kind !== 'angle') {
          result = { ...result, x: q.x };
          guides.push({ a: q, b: { x: q.x, y: result.y } });
          alignedX = true;
        }
        if (!alignedY && Math.abs(q.y - result.y) <= tolerance / 2 && kind !== 'angle') {
          result = { ...result, y: q.y };
          guides.push({ a: q, b: { x: result.x, y: q.y } });
          alignedY = true;
        }
      }
    }
  }

  return { point: result, kind, guides };
}

function diff(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

/** True when a pen stroke should finish by closing back onto the chain's start. */
export function nearStart(p: Vec2, start: Vec2 | undefined, tolerance: number): boolean {
  return !!start && dist(p, start) <= tolerance * 1.5;
}
