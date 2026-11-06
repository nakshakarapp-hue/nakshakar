import { stairLayout } from '../catalog/stairs';
import { pointInPolygon } from '../core/geometry/polygon';
import { closestOnSegment, dist, rotate, sub } from '../core/geometry/vec';
import { distanceAlongWall, pointOnWall } from '../core/geometry/wallGraph';
import type { Floor, Transform, Vec2 } from '../core/model/types';
import type { ItemKind, ItemRef } from './commands';

function inRotatedRect(p: Vec2, t: Transform, w: number, d: number, pad: number): boolean {
  const local = rotate(sub(p, t), -t.rotation);
  return Math.abs(local.x) <= (w * t.scaleX) / 2 + pad && Math.abs(local.y) <= (d * t.scaleY) / 2 + pad;
}

const shown = (f: Floor, cat: string) => !f.hiddenCategories.includes(cat);

/**
 * Finds what is under a plan point, smallest and most deliberate targets first, so a door can be
 * picked from its wall and a chair from its room. `reach` is the finger tolerance in millimetres.
 */
export function hitTest(f: Floor, p: Vec2, reach: number): ItemRef | null {
  if (shown(f, 'electrical'))
    for (const e of f.electrical)
      if (dist(p, e.at) <= Math.max(120, reach)) return { kind: 'electrical', id: e.id };
  if (shown(f, 'plumbing'))
    for (const e of f.plumbing)
      if (dist(p, e.at) <= Math.max(120, reach)) return { kind: 'plumbing', id: e.id };
  if (shown(f, 'labels'))
    for (const l of f.labels) if (dist(p, l.at) <= Math.max(300, reach)) return { kind: 'label', id: l.id };
  if (shown(f, 'openings')) {
    for (const o of f.openings) {
      const wall = f.walls.find((w) => w.id === o.wallId);
      if (!wall) continue;
      const hit = distanceAlongWall(wall, p);
      if (hit.distance <= wall.thickness / 2 + reach && Math.abs(hit.along - o.position) <= o.width / 2)
        return { kind: 'opening', id: o.id };
    }
  }
  if (shown(f, 'pillars')) {
    for (const c of f.pillars)
      if (!c.hidden && inRotatedRect(p, c.transform, c.width, c.depth, reach / 2))
        return { kind: 'pillar', id: c.id };
  }
  if (shown(f, 'dimensions')) {
    for (const d of f.dimensions) {
      if (closestOnSegment(p, d.a, d.b).distance <= Math.abs(d.offset) + reach)
        return { kind: 'dimension', id: d.id };
    }
  }
  if (shown(f, 'walls')) {
    let best: { id: string; d: number } | null = null;
    for (const w of f.walls) {
      if (w.hidden) continue;
      const hit = distanceAlongWall(w, p);
      if (hit.distance <= w.thickness / 2 + reach && (!best || hit.distance < best.d))
        best = { id: w.id, d: hit.distance };
    }
    if (best) return { kind: 'wall', id: best.id };
  }
  if (shown(f, 'objects')) {
    for (let i = f.objects.length - 1; i >= 0; i--) {
      const o = f.objects[i];
      if (!o.hidden && inRotatedRect(p, o.transform, o.width, o.depth, 0))
        return { kind: 'object', id: o.id };
    }
  }
  if (shown(f, 'stairs')) {
    for (const s of f.stairs)
      if (!s.hidden && pointInPolygon(p, stairLayout(s).outline)) return { kind: 'stair', id: s.id };
  }
  if (shown(f, 'beams')) {
    for (const b of f.beams)
      if (!b.hidden && closestOnSegment(p, b.start, b.end).distance <= b.width / 2 + reach)
        return { kind: 'beam', id: b.id };
  }
  if (shown(f, 'plants')) {
    for (const t of f.plants)
      if (!t.hidden && dist(p, t.transform) <= Math.max(t.spread / 2, reach))
        return { kind: 'plant', id: t.id };
  }
  for (const s of f.slabs) if (pointInPolygon(p, s.polygon)) return { kind: 'slab', id: s.id };
  for (const r of f.rooms) {
    if (pointInPolygon(p, r.polygon) && !r.holes.some((h) => pointInPolygon(p, h)))
      return { kind: 'room', id: r.id };
  }
  return null;
}

/** A single representative point of an item, for marquee and lasso selection. */
export function anchorOf(f: Floor, kind: ItemKind, id: string): Vec2[] {
  switch (kind) {
    case 'wall': {
      const w = f.walls.find((x) => x.id === id);
      return w ? [w.start, w.end] : [];
    }
    case 'opening': {
      const o = f.openings.find((x) => x.id === id);
      const w = o && f.walls.find((x) => x.id === o.wallId);
      return o && w ? [pointOnWall(w, o.position).point] : [];
    }
    case 'slab': {
      return f.slabs.find((x) => x.id === id)?.polygon ?? [];
    }
    case 'object': {
      const o = f.objects.find((x) => x.id === id);
      return o ? [o.transform] : [];
    }
    case 'pillar': {
      const o = f.pillars.find((x) => x.id === id);
      return o ? [o.transform] : [];
    }
    case 'plant': {
      const o = f.plants.find((x) => x.id === id);
      return o ? [o.transform] : [];
    }
    case 'stair': {
      const o = f.stairs.find((x) => x.id === id);
      return o ? stairLayout(o).outline : [];
    }
    case 'beam': {
      const o = f.beams.find((x) => x.id === id);
      return o ? [o.start, o.end] : [];
    }
    case 'label': {
      const o = f.labels.find((x) => x.id === id);
      return o ? [o.at] : [];
    }
    case 'electrical': {
      const o = f.electrical.find((x) => x.id === id);
      return o ? [o.at] : [];
    }
    case 'plumbing': {
      const o = f.plumbing.find((x) => x.id === id);
      return o ? [o.at] : [];
    }
    default:
      return [];
  }
}

/** Items wholly inside a region, tested by every anchor point. */
export function itemsInside(f: Floor, inside: (p: Vec2) => boolean): ItemRef[] {
  const out: ItemRef[] = [];
  const check = (kind: ItemKind, list: { id: string; hidden?: boolean }[]) => {
    for (const it of list) {
      if (it.hidden) continue;
      const pts = anchorOf(f, kind, it.id);
      if (pts.length && pts.every(inside)) out.push({ kind, id: it.id });
    }
  };
  check('wall', f.walls);
  check('opening', f.openings);
  check('object', f.objects);
  check('pillar', f.pillars);
  check('plant', f.plants);
  check('stair', f.stairs);
  check('beam', f.beams);
  check('slab', f.slabs);
  check('label', f.labels);
  check('electrical', f.electrical);
  check('plumbing', f.plumbing);
  return out;
}
