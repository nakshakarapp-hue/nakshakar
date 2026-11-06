import { stairLayout } from '../catalog/stairs';
import { bbox } from '../core/geometry/polygon';
import { add, dist, dot, rotate, sub } from '../core/geometry/vec';
import { pointOnWall, wallLength } from '../core/geometry/wallGraph';
import type {
  Beam,
  Floor,
  Opening,
  Pillar,
  PlacedObject,
  Plant,
  Slab,
  Stair,
  Vec2,
} from '../core/model/types';
import type { ItemRef } from './commands';
import { findItem } from './commands';

export interface Handle {
  id: string;
  at: Vec2;
  shape: 'corner' | 'rotate' | 'edge' | 'point';
  name: string;
  /** Where a rotate handle's stem starts. */
  from?: Vec2;
  /** What the item becomes when the handle is dragged to `cur`. Shift turns freely instead of in steps. */
  edit(cur: Vec2, shift: boolean): (floor: Floor) => void;
}

const snap10 = (v: number) => Math.round(v / 10) * 10;
const turnTo = (center: Vec2, cur: Vec2, free: boolean) => {
  const deg = (Math.atan2(cur.x - center.x, -(cur.y - center.y)) * 180) / Math.PI;
  return free ? Math.round(deg) : Math.round(deg / 15) * 15;
};

/** The centre of a stair's outline, which it turns about so it does not jump away. */
export function stairCenter(s: Stair): Vec2 {
  const b = bbox(stairLayout(s).outline);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Turns a stair to face a compass-free direction on the plan: 0 is up the screen. */
export function setStairRotation(s: Stair, deg: number): void {
  const center = stairCenter(s);
  const moved = rotate(s.transform, deg - s.transform.rotation, center);
  s.transform.x = moved.x;
  s.transform.y = moved.y;
  s.transform.rotation = ((deg % 360) + 360) % 360;
}

function rectHandles(
  ref: ItemRef,
  item: PlacedObject | Pillar,
  name: string,
  turnable: boolean,
  offset: number,
): Handle[] {
  const t = item.transform;
  const sx = 'scaleX' in t ? (t as { scaleX: number }).scaleX || 1 : 1;
  const sy = 'scaleY' in t ? (t as { scaleY: number }).scaleY || 1 : 1;
  const w = item.width * sx;
  const d = item.depth * sy;
  const center = { x: t.x, y: t.y };
  const corner = (cx: number, cy: number) =>
    add(center, rotate({ x: (cx * w) / 2, y: (cy * d) / 2 }, t.rotation));
  const handles: Handle[] = (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
  ).map(([cx, cy]) => {
    const opposite = corner(-cx, -cy);
    return {
      id: `corner:${cx}:${cy}`,
      at: corner(cx, cy),
      shape: 'corner' as const,
      name,
      edit: (cur: Vec2) => (f: Floor) => {
        const k = findItem<PlacedObject | Pillar>(f, ref);
        if (!k) return;
        const v = rotate(sub(cur, opposite), -t.rotation);
        const W = Math.max(50, snap10(Math.abs(v.x)));
        const D = Math.max(50, snap10(Math.abs(v.y)));
        const round = 'shape' in k && k.shape === 'round';
        const size = Math.max(W, D);
        k.width = (round ? size : W) / sx;
        k.depth = (round ? size : D) / sy;
        const middle = add(
          opposite,
          rotate({ x: (cx * (round ? size : W)) / 2, y: (cy * (round ? size : D)) / 2 }, t.rotation),
        );
        k.transform.x = Math.round(middle.x);
        k.transform.y = Math.round(middle.y);
      },
    };
  });
  if (turnable) {
    const top = corner(0, -1);
    handles.push({
      id: 'rotate',
      from: top,
      at: add(top, rotate({ x: 0, y: -offset }, t.rotation)),
      shape: 'rotate',
      name: 'Rotate',
      edit: (cur, shift) => (f) => {
        const k = findItem<PlacedObject | Pillar>(f, ref);
        if (k) k.transform.rotation = turnTo(center, cur, shift);
      },
    });
  }
  return handles;
}

/**
 * What can be dragged on the plan for one selected item, to resize or turn it. Walls have their own
 * handles in the editor. `offset` is how far out a rotate handle sits, in plan millimetres.
 */
export function itemHandles(floor: Floor, ref: ItemRef, offset: number): Handle[] {
  switch (ref.kind) {
    case 'object': {
      const o = findItem<PlacedObject>(floor, ref);
      return o && !o.locked ? rectHandles(ref, o, 'Resize object', true, offset) : [];
    }
    case 'pillar': {
      const p = findItem<Pillar>(floor, ref);
      return p && !p.locked ? rectHandles(ref, p, 'Change pillar', p.shape !== 'round', offset) : [];
    }
    case 'plant': {
      const p = findItem<Plant>(floor, ref);
      if (!p || p.locked) return [];
      const center = { x: p.transform.x, y: p.transform.y };
      return [
        {
          id: 'spread',
          at: { x: center.x + p.spread / 2, y: center.y },
          shape: 'edge',
          name: 'Resize plant',
          edit: (cur) => (f) => {
            const k = findItem<Plant>(f, ref);
            if (k) k.spread = Math.max(100, snap10(dist(cur, center) * 2));
          },
        },
      ];
    }
    case 'stair': {
      const s = findItem<Stair>(floor, ref);
      if (!s || s.locked) return [];
      const center = stairCenter(s);
      const b = stairLayout(s).outline;
      // The turning handle sits beyond the outline, in the direction the stair is facing.
      const reach = Math.max(...b.map((p) => dist(p, center))) + offset;
      const handles: Handle[] = [
        {
          id: 'rotate',
          from: center,
          at: add(center, rotate({ x: 0, y: -reach }, s.transform.rotation)),
          shape: 'rotate',
          name: 'Rotate',
          edit: (cur, shift) => (f) => {
            const k = findItem<Stair>(f, ref);
            if (k) {
              // Always from the stair as it was when the drag began.
              k.transform = { ...s.transform };
              setStairRotation(k, turnTo(center, cur, shift));
            }
          },
        },
      ];
      if (s.shape !== 'spiral') {
        handles.push({
          id: 'width',
          at: add(s.transform, rotate({ x: s.width, y: -s.tread / 2 }, s.transform.rotation)),
          shape: 'edge',
          name: 'Change stair width',
          edit: (cur) => (f) => {
            const k = findItem<Stair>(f, ref);
            if (!k) return;
            const v = rotate(sub(cur, s.transform), -s.transform.rotation);
            k.width = Math.max(500, Math.min(4000, snap10(v.x)));
          },
        });
      }
      return handles;
    }
    case 'slab': {
      const s = findItem<Slab>(floor, ref);
      if (!s) return [];
      return s.polygon.map((p, i) => ({
        id: `point:${i}`,
        at: p,
        shape: 'point' as const,
        name: 'Change slab',
        edit: (cur: Vec2) => (f: Floor) => {
          const k = findItem<Slab>(f, ref);
          if (!k) return;
          const before = s.polygon[i];
          const to = { x: snap10(cur.x), y: snap10(cur.y) };
          // A rectangle stays a rectangle: its two neighbours follow along their own sides.
          const square =
            s.polygon.length === 4 &&
            s.polygon.every((q, n) => {
              const r = s.polygon[(n + 1) % 4];
              return Math.abs(q.x - r.x) < 1 || Math.abs(q.y - r.y) < 1;
            });
          k.polygon[i] = to;
          if (square) {
            const prev = (i + 3) % 4;
            const next = (i + 1) % 4;
            for (const n of [prev, next]) {
              const q = s.polygon[n];
              k.polygon[n] = Math.abs(q.x - before.x) < 1 ? { x: to.x, y: q.y } : { x: q.x, y: to.y };
            }
          }
        },
      }));
    }
    case 'beam': {
      const b = findItem<Beam>(floor, ref);
      if (!b || b.locked) return [];
      return (['start', 'end'] as const).map((end) => ({
        id: end,
        at: b[end],
        shape: 'point' as const,
        name: 'Change beam',
        edit: (cur: Vec2) => (f: Floor) => {
          const k = findItem<Beam>(f, ref);
          if (k) k[end] = { x: snap10(cur.x), y: snap10(cur.y) };
        },
      }));
    }
    case 'opening': {
      const o = findItem<Opening>(floor, ref);
      const wall = o && floor.walls.find((w) => w.id === o.wallId);
      if (!o || !wall || wall.locked) return [];
      const m = pointOnWall(wall, o.position);
      return ([-1, 1] as const).map((side) => ({
        id: `end:${side}`,
        at: add(m.point, { x: (m.dir.x * side * o.width) / 2, y: (m.dir.y * side * o.width) / 2 }),
        shape: 'edge' as const,
        name: 'Change opening width',
        edit: (cur: Vec2) => (f: Floor) => {
          const k = findItem<Opening>(f, ref);
          if (!k) return;
          const along = Math.abs(dot(sub(cur, m.point), m.dir));
          const room = 2 * Math.min(o.position, wallLength(wall) - o.position);
          k.width = Math.max(300, Math.min(room, snap10(along * 2)));
        },
      }));
    }
    default:
      return [];
  }
}
