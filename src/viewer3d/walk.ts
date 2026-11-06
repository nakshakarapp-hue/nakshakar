import { stairLayout } from '../catalog/stairs';
import { pointInPolygon } from '../core/geometry/polygon';
import { closestOnSegment } from '../core/geometry/vec';
import type { Floor, Vec2 } from '../core/model/types';
import type { WalkFloor } from './builder';

const BODY_RADIUS_MM = 220;
/** A person can step up about one riser and a bit; anything higher blocks. */
const STEP_UP_M = 0.5;

export const EYE_HEIGHT_M = 1.55;

/** Pushes a position out of any wall it is overlapping, sliding along the wall. */
export function collide(
  pos: Vec2,
  walk: WalkFloor | undefined,
  open: ReadonlySet<string> | null = null,
): Vec2 {
  if (!walk) return pos;
  let p = pos;
  // With no door state given, doors are simply gaps: the plain planning view has no shut doors.
  const shut = open ? walk.doors.filter((d) => !open.has(d.id)) : [];
  const blockers = [...walk.segments, ...walk.furniture, ...shut];
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const s of blockers) {
      const hit = closestOnSegment(p, s.a, s.b);
      if (hit.distance >= BODY_RADIUS_MM) continue;
      const dx = p.x - hit.point.x;
      const dy = p.y - hit.point.y;
      const d = Math.hypot(dx, dy);
      // Exactly on the wall's line there is no "away" direction, so use the wall's own normal.
      const ax = s.b.x - s.a.x;
      const ay = s.b.y - s.a.y;
      const al = Math.hypot(ax, ay) || 1;
      const ux = d > 1e-6 ? dx / d : ay / al;
      const uy = d > 1e-6 ? dy / d : -ax / al;
      p = { x: hit.point.x + ux * BODY_RADIUS_MM, y: hit.point.y + uy * BODY_RADIUS_MM };
      moved = true;
    }
    if (!moved) break;
  }
  return p;
}

/** Height of everything that can be stood on at a plan point, in metres. */
export function standHeights(p: Vec2, walk: WalkFloor[], floors: Floor[]): number[] {
  const out: number[] = [];
  walk.forEach((w) => {
    const floor = floors[w.floorIndex];
    if (!floor) return;
    const below = floors[w.floorIndex - 1];
    const inVoid = below?.stairs.some((s) => pointInPolygon(p, stairLayout(s).outline));
    const onFloor = w.shape.some(
      (s) => pointInPolygon(p, s.outer) && !s.holes.some((h) => pointInPolygon(p, h)),
    );
    if (onFloor && !inVoid) out.push(w.level);
    for (const s of floor.stairs) {
      const layout = stairLayout(s);
      for (const step of layout.steps) {
        if (pointInPolygon(p, step.polygon)) out.push(w.level + step.z / 1000);
      }
    }
  });
  return out;
}

/** Picks the floor under the feet: the highest surface within a stride up from the current height. */
export function nextFeetHeight(current: number, heights: number[], groundLevel: number): number {
  let best: number | null = null;
  for (const h of heights) {
    if (h <= current + STEP_UP_M && (best === null || h > best)) best = h;
  }
  return best ?? groundLevel;
}

/** Which storey's walls apply at a feet height. */
export function floorAtHeight(feet: number, walk: WalkFloor[]): WalkFloor | undefined {
  let found = walk[0];
  for (const w of walk) if (w.level <= feet + 0.3) found = w;
  return found;
}
