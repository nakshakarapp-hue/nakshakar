import { objectById, openingTypeById, plantById } from '../catalog/catalog';
import { stairLayout } from '../catalog/stairs';
import { centroid } from '../core/geometry/polygon';
import { roomSideOfWall } from '../core/geometry/rooms';
import { dist, leftNormal, norm, rotate, sub } from '../core/geometry/vec';
import { buildWallGraph, pointOnWall, wallLength, type WallGraph } from '../core/geometry/wallGraph';
import type { Floor, Opening, ProjectSettings, Site, Vec2, Wall } from '../core/model/types';
import { areaUnitFor, formatArea, formatLength } from '../core/units';
import { buildableArea } from './shapes';

/**
 * A plan is reduced to these primitives in plan millimetres. The screen and the PDF both draw from the
 * same list, so printed plans match the editor and stay true vectors. Stroke widths and text sizes are
 * in output units: CSS pixels on screen, points on paper.
 */
export type Prim =
  | { t: 'poly'; pts: Vec2[]; fill?: string; stroke?: string; w?: number; open?: boolean; dash?: number[] }
  | { t: 'line'; a: Vec2; b: Vec2; stroke: string; w: number; dash?: number[] }
  | { t: 'arc'; c: Vec2; r: number; a0: number; a1: number; stroke: string; w: number }
  | { t: 'circle'; c: Vec2; r: number; fill?: string; stroke?: string; w?: number }
  | {
      t: 'text';
      at: Vec2;
      s: string;
      size: number;
      color: string;
      align?: 'left' | 'center' | 'right';
      angle?: number;
      bg?: string;
      bold?: boolean;
    };

export interface DrawOptions {
  settings: ProjectSettings;
  /** Colour for walls and linework. */
  ink: string;
  muted: string;
  wallFill: string;
  paper: string;
  /** Translated room name lookup is applied by the caller through this hook. */
  roomLabel?: (name: string) => string;
  /** Ghost of the floor below, for tracing. */
  ghost?: Floor;
  /** The plot boundary and setback line, drawn on the ground floor. */
  site?: Site;
  /** Print output uses solid colours and omits editor-only hints. */
  forPrint?: boolean;
}

const graphCache = new WeakMap<Wall[], WallGraph>();

/** The junction graph of a wall list, cached by the list's identity. */
export function graphFor(walls: Wall[]): WallGraph {
  let g = graphCache.get(walls);
  if (!g) {
    g = buildWallGraph(walls);
    graphCache.set(walls, g);
  }
  return g;
}

const hiddenCat = (f: Floor, cat: string) => f.hiddenCategories.includes(cat);

export function drawOpeningSymbol(
  out: Prim[],
  o: Opening,
  wall: Wall,
  opt: DrawOptions,
  rooms: Floor['rooms'] = [],
): void {
  const { point, dir } = pointOnWall(wall, o.position);
  const n = leftNormal(dir);
  const half = o.width / 2;
  const t = wall.thickness / 2 + 2;
  const a = { x: point.x - dir.x * half, y: point.y - dir.y * half };
  const b = { x: point.x + dir.x * half, y: point.y + dir.y * half };
  const off = (p: Vec2, s: number): Vec2 => ({ x: p.x + n.x * s, y: p.y + n.y * s });
  out.push({ t: 'poly', pts: [off(a, t), off(b, t), off(b, -t), off(a, -t)], fill: opt.paper });
  out.push({ t: 'line', a: off(a, t), b: off(a, -t), stroke: opt.ink, w: 1.2 });
  out.push({ t: 'line', a: off(b, t), b: off(b, -t), stroke: opt.ink, w: 1.2 });
  const style = openingTypeById.get(o.catalogId)?.style ?? (o.kind === 'door' ? 'swing' : 'sliding');
  if (o.kind === 'window') {
    out.push({ t: 'line', a: off(a, t * 0.35), b: off(b, t * 0.35), stroke: opt.ink, w: 0.8 });
    out.push({ t: 'line', a: off(a, -t * 0.35), b: off(b, -t * 0.35), stroke: opt.ink, w: 0.8 });
    if (style === 'sliding') out.push({ t: 'line', a, b, stroke: '#3a78b5', w: 1.4 });
    return;
  }
  if (style === 'arch') return;
  if (style === 'sliding' || style === 'folding') {
    out.push({
      t: 'line',
      a: off(a, t * 0.3),
      b: { x: point.x + n.x * t * 0.3, y: point.y + n.y * t * 0.3 },
      stroke: opt.ink,
      w: 1.2,
    });
    out.push({
      t: 'line',
      a: { x: point.x - n.x * t * 0.3, y: point.y - n.y * t * 0.3 },
      b: off(b, -t * 0.3),
      stroke: opt.ink,
      w: 1.2,
    });
    return;
  }
  // Swing door: a leaf and its arc per panel. 'in' swings towards the room, however the wall was drawn.
  const roomSide = roomSideOfWall(rooms, point, n, wall.thickness / 2 + 150);
  const side = o.swingDirection === 'in' ? roomSide : -roomSide;
  const leaf = (hinge: Vec2, tip: Vec2, r: number) => {
    const open = off(hinge, side * (r + t));
    const startFace = off(hinge, side * t);
    const faceTip = off(tip, side * t);
    out.push({ t: 'line', a: startFace, b: open, stroke: opt.ink, w: 1.2 });
    const a0 = Math.atan2(open.y - startFace.y, open.x - startFace.x);
    const a1 = Math.atan2(faceTip.y - startFace.y, faceTip.x - startFace.x);
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    out.push({ t: 'arc', c: startFace, r, a0, a1: a0 + d, stroke: opt.muted, w: 0.7 });
  };
  if (o.panels >= 2) {
    leaf(a, point, half);
    leaf(b, point, half);
  } else if (o.swingSide === 'left') {
    leaf(a, b, o.width);
  } else {
    leaf(b, a, o.width);
  }
}

function dimensionPrims(
  out: Prim[],
  a: Vec2,
  b: Vec2,
  side: Vec2,
  offset: number,
  text: string,
  opt: DrawOptions,
  arrow: 'tick' | 'arrow' | 'dot' = opt.settings.dimensionArrow ?? 'tick',
): void {
  const ax = { x: a.x + side.x * offset, y: a.y + side.y * offset };
  const bx = { x: b.x + side.x * offset, y: b.y + side.y * offset };
  const color = opt.forPrint ? '#222222' : '#6b7885';
  out.push({ t: 'line', a: ax, b: bx, stroke: color, w: 0.6 });
  out.push({ t: 'line', a, b: ax, stroke: color, w: 0.35 });
  out.push({ t: 'line', a: b, b: bx, stroke: color, w: 0.35 });
  const d = norm(sub(b, a));
  const mark = (p: Vec2, sign: number) => {
    if (arrow === 'dot') {
      out.push({ t: 'circle', c: p, r: 18, fill: color });
    } else if (arrow === 'arrow') {
      const n = leftNormal(d);
      const back = { x: p.x + d.x * sign * 90, y: p.y + d.y * sign * 90 };
      out.push({
        t: 'poly',
        pts: [
          p,
          { x: back.x + n.x * 28, y: back.y + n.y * 28 },
          { x: back.x - n.x * 28, y: back.y - n.y * 28 },
        ],
        fill: color,
      });
    } else {
      const k = { x: (d.x + side.x) * 45, y: (d.y + side.y) * 45 };
      out.push({
        t: 'line',
        a: { x: p.x - k.x, y: p.y - k.y },
        b: { x: p.x + k.x, y: p.y + k.y },
        stroke: color,
        w: 0.9,
      });
    }
  };
  mark(ax, 1);
  mark(bx, -1);
  let angle = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  if (angle > 90 || angle <= -90) angle += 180;
  out.push({
    t: 'text',
    at: { x: (ax.x + bx.x) / 2, y: (ax.y + bx.y) / 2 },
    s: text,
    size: 9.5 * opt.settings.dimensionTextScale,
    color,
    align: 'center',
    angle,
    bg: opt.paper,
    bold: opt.settings.dimensionBold,
  });
}

/** Everything drawn for a floor, back to front. */
export function floorPrims(floor: Floor, opt: DrawOptions): Prim[] {
  const out: Prim[] = [];
  const { settings } = opt;
  const fmt = (mm: number) => formatLength(mm, settings.displayUnit, settings.precision);

  if (opt.ghost) {
    for (const e of graphFor(opt.ghost.walls).edges)
      out.push({ t: 'poly', pts: e.polygon, stroke: opt.ghost.colorTag || '#9aa5b1', w: 0.6, dash: [4, 3] });
    // Stairs arrive from below, so keep this floor clear of them.
    for (const st of opt.ghost.stairs) {
      if (!st.hidden)
        out.push({ t: 'poly', pts: stairLayout(st).outline, stroke: '#6b7885', w: 0.8, dash: [6, 3] });
    }
  }

  const plot = opt.site?.plot ?? [];
  if (opt.site && plot.length >= 3) {
    const brown = '#8c7a62';
    out.push({ t: 'poly', pts: plot, stroke: brown, w: 1.4, dash: [10, 4, 2, 4] });
    const { front, right, rear, left } = opt.site.setbacks;
    const inset = buildableArea(plot, opt.site.setbackList ?? [front, right, rear, left]);
    if (inset.length >= 3) out.push({ t: 'poly', pts: inset, stroke: brown, w: 0.7, dash: [3, 4] });
    plot.forEach((a, i) => {
      const b = plot[(i + 1) % plot.length];
      const d = sub(b, a);
      let angle = (Math.atan2(d.y, d.x) * 180) / Math.PI;
      if (angle > 90 || angle <= -90) angle += 180;
      out.push({
        t: 'text',
        at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        s: fmt(dist(a, b)),
        size: 9,
        color: brown,
        align: 'center',
        angle,
        bg: opt.paper,
      });
    });
  }

  for (const r of floor.rooms) {
    out.push({ t: 'poly', pts: r.polygon, fill: opt.forPrint ? '#ffffff' : `${r.floorColor}2e` });
  }

  for (const slab of floor.slabs) {
    out.push({
      t: 'poly',
      pts: slab.polygon,
      fill: `${slab.color}55`,
      stroke: opt.muted,
      w: 0.5,
      dash: [5, 3],
    });
  }

  if (!hiddenCat(floor, 'plants')) {
    for (const plant of floor.plants) {
      if (plant.hidden) continue;
      const c = { x: plant.transform.x, y: plant.transform.y };
      const form = plantById.get(plant.catalogId)?.form ?? 'tree';
      out.push({
        t: 'circle',
        c,
        r: plant.spread / 2,
        fill: `${plant.foliageColor}1f`,
        stroke: `${plant.foliageColor}99`,
        w: 0.6,
      });
      if (form === 'tree' || form === 'palm')
        out.push({ t: 'circle', c, r: 50, fill: `${plant.foliageColor}99` });
    }
  }

  if (!hiddenCat(floor, 'objects')) {
    for (const item of floor.objects) {
      if (item.hidden) continue;
      const cat = objectById.get(item.catalogId);
      const t = item.transform;
      const W = item.width * t.scaleX;
      const D = item.depth * t.scaleY;
      const place = (x: number, y: number): Vec2 => {
        const p = rotate({ x: (x - 0.5) * W, y: (y - 0.5) * D }, t.rotation);
        return { x: t.x + p.x, y: t.y + p.y };
      };
      out.push({
        t: 'poly',
        pts: [place(0, 0), place(1, 0), place(1, 1), place(0, 1)],
        fill: opt.forPrint ? '#ffffff' : `${item.colors[Object.keys(item.colors)[0]] ?? '#999999'}26`,
        stroke: opt.ink,
        w: 0.45,
      });
      for (const part of cat?.parts ?? []) {
        // Only parts high enough to be seen from above and smaller than the outline are worth drawing.
        if (part.w > 0.97 && part.d > 0.97) continue;
        if (part.s === 'cyl' || part.s === 'sphere') {
          const c = place(part.x + part.w / 2, part.y + part.d / 2);
          out.push({
            t: 'circle',
            c,
            r: (Math.min(part.w * W, part.d * D) / 2) * 0.95,
            stroke: opt.muted,
            w: 0.45,
          });
        } else {
          const x1 = part.x + part.w;
          const y1 = part.y + part.d;
          out.push({
            t: 'poly',
            pts: [place(part.x, part.y), place(x1, part.y), place(x1, y1), place(part.x, y1)],
            stroke: opt.muted,
            w: 0.45,
          });
        }
      }
      if (settings.showFurnitureLabels) {
        out.push({
          t: 'text',
          at: { x: t.x, y: t.y },
          s: item.name,
          size: 8,
          color: opt.muted,
          align: 'center',
        });
      }
    }
  }

  if (!hiddenCat(floor, 'stairs')) {
    for (const s of floor.stairs) {
      if (s.hidden) continue;
      const layout = stairLayout(s);
      for (const step of layout.steps)
        out.push({
          t: 'poly',
          pts: step.polygon,
          fill: opt.forPrint ? '#ffffff' : `${s.treadColor}aa`,
          stroke: opt.ink,
          w: 0.5,
        });
      if (layout.path.length > 1) {
        out.push({ t: 'poly', pts: layout.path, open: true, stroke: '#c0392b', w: 0.9 });
        const end = layout.path[layout.path.length - 1];
        const prev = layout.path[layout.path.length - 2];
        const d = norm(sub(end, prev));
        const n = leftNormal(d);
        out.push({
          t: 'poly',
          pts: [
            end,
            { x: end.x - d.x * 180 + n.x * 70, y: end.y - d.y * 180 + n.y * 70 },
            { x: end.x - d.x * 180 - n.x * 70, y: end.y - d.y * 180 - n.y * 70 },
          ],
          fill: '#c0392b',
        });
        out.push({ t: 'text', at: layout.path[0], s: 'UP', size: 8, color: '#c0392b', align: 'center' });
      }
    }
  }

  if (!hiddenCat(floor, 'beams')) {
    for (const b of floor.beams) {
      if (b.hidden) continue;
      const n = leftNormal(norm(sub(b.end, b.start)));
      const h = b.width / 2;
      out.push({
        t: 'poly',
        pts: [
          { x: b.start.x + n.x * h, y: b.start.y + n.y * h },
          { x: b.end.x + n.x * h, y: b.end.y + n.y * h },
          { x: b.end.x - n.x * h, y: b.end.y - n.y * h },
          { x: b.start.x - n.x * h, y: b.start.y - n.y * h },
        ],
        stroke: '#8e44ad',
        w: 0.8,
        dash: [6, 4],
      });
    }
  }

  const graph = graphFor(floor.walls);
  const byId = new Map(floor.walls.map((w) => [w.id, w]));
  if (!hiddenCat(floor, 'walls')) {
    for (const e of graph.edges) {
      const w = byId.get(e.wallId);
      if (!w || w.hidden) continue;
      const fill = w.type === 'glass' ? '#bcd9e6' : w.type === 'compound' ? '#8d99a6' : opt.wallFill;
      out.push({ t: 'poly', pts: e.polygon, fill });
    }
    for (const e of graph.edges) {
      const w = byId.get(e.wallId);
      if (!w || w.hidden) continue;
      out.push({ t: 'line', a: e.aLeft, b: e.bLeft, stroke: opt.ink, w: 1.1 });
      out.push({ t: 'line', a: e.aRight, b: e.bRight, stroke: opt.ink, w: 1.1 });
      if (e.aFree) out.push({ t: 'line', a: e.aLeft, b: e.aRight, stroke: opt.ink, w: 1.1 });
      if (e.bFree) out.push({ t: 'line', a: e.bLeft, b: e.bRight, stroke: opt.ink, w: 1.1 });
    }
  }

  if (!hiddenCat(floor, 'pillars')) {
    for (const c of floor.pillars) {
      if (c.hidden) continue;
      const t = c.transform;
      if (c.shape === 'round') {
        out.push({
          t: 'circle',
          c: { x: t.x, y: t.y },
          r: c.width / 2,
          fill: opt.ink,
          stroke: opt.ink,
          w: 0.8,
        });
      } else {
        const place = (x: number, y: number): Vec2 => {
          const p = rotate({ x, y }, t.rotation);
          return { x: t.x + p.x, y: t.y + p.y };
        };
        const hw = c.width / 2;
        const hd = c.depth / 2;
        out.push({
          t: 'poly',
          pts: [place(-hw, -hd), place(hw, -hd), place(hw, hd), place(-hw, hd)],
          fill: opt.ink,
          stroke: opt.ink,
          w: 0.8,
        });
      }
    }
  }

  if (!hiddenCat(floor, 'openings') && !hiddenCat(floor, 'walls')) {
    for (const o of floor.openings) {
      const w = byId.get(o.wallId);
      if (w && !w.hidden) drawOpeningSymbol(out, o, w, opt, floor.rooms);
    }
  }

  if (!hiddenCat(floor, 'electrical')) {
    for (const pt of floor.electrical) {
      out.push({ t: 'circle', c: pt.at, r: 90, fill: '#f1c40f', stroke: '#7d6608', w: 0.7 });
      out.push({
        t: 'text',
        at: pt.at,
        s: pt.kind[0].toUpperCase(),
        size: 7,
        color: '#3d3200',
        align: 'center',
      });
    }
  }
  if (!hiddenCat(floor, 'plumbing')) {
    for (const pt of floor.plumbing) {
      out.push({ t: 'circle', c: pt.at, r: 90, fill: '#5dade2', stroke: '#1b4f72', w: 0.7 });
      out.push({
        t: 'text',
        at: pt.at,
        s: pt.kind[0].toUpperCase(),
        size: 7,
        color: '#0b2536',
        align: 'center',
      });
    }
  }

  if (settings.showDimensions && !hiddenCat(floor, 'dimensions')) {
    const center = floor.walls.length ? centroid(graph.nodes) : { x: 0, y: 0 };
    // Outer walls go last, so their dimensions win when space is short.
    const ranked = [...graph.edges].sort(
      (m, n) => Number(byId.get(m.wallId)?.type === 'outer') - Number(byId.get(n.wallId)?.type === 'outer'),
    );
    for (const e of ranked) {
      const w = byId.get(e.wallId);
      if (!w || w.hidden) continue;
      const a = graph.nodes[e.a];
      const b = graph.nodes[e.b];
      const span = dist(a, b);
      if (span < 150) continue;
      const isArc = Math.abs(w.bulge) > 1e-3;
      if (isArc && e.startDist > 0) continue;
      const n = leftNormal(norm(sub(b, a)));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const outward = (mid.x - center.x) * n.x + (mid.y - center.y) * n.y >= 0 ? n : { x: -n.x, y: -n.y };
      const faceIsLeft = outward === n;
      const leftLen = dist(e.aLeft, e.bLeft);
      const rightLen = dist(e.aRight, e.bRight);
      const longer = Math.max(leftLen, rightLen);
      const shorter = Math.min(leftLen, rightLen);
      const measure = isArc
        ? wallLength(w)
        : settings.dimensionMode === 'outer'
          ? longer
          : settings.dimensionMode === 'inner'
            ? shorter
            : span;
      const ext = (faceIsLeft ? e.leftOffset : e.rightOffset) + (w.type === 'inner' ? 120 : 420);
      dimensionPrims(out, a, b, outward, ext, fmt(measure), opt);
    }
    for (const d of floor.dimensions) {
      const n = leftNormal(norm(sub(d.b, d.a)));
      dimensionPrims(out, d.a, d.b, n, d.offset, fmt(dist(d.a, d.b)), opt, d.arrow);
    }
  }

  if (!hiddenCat(floor, 'labels')) {
    for (const l of floor.labels) {
      out.push({
        t: 'text',
        at: l.at,
        s: opt.roomLabel ? opt.roomLabel(l.text) : l.text,
        size: Math.max(8, l.size / 20),
        color: l.color,
        align: 'center',
      });
    }
  }

  // Room labels go last so nothing covers them. Later text outranks earlier text when space is short,
  // so areas come first, then sizes, and every room's name last.
  if (settings.showArea) {
    for (const r of floor.rooms) {
      out.push({
        t: 'text',
        at: { x: r.centroid.x, y: r.centroid.y + 210 },
        s: formatArea(r.area, areaUnitFor(settings.displayUnit), 1),
        size: 8.5,
        color: opt.muted,
        align: 'center',
      });
    }
    for (const r of floor.rooms) {
      const xs = r.polygon.map((p) => p.x);
      const ys = r.polygon.map((p) => p.y);
      const size = `${fmt(Math.max(...xs) - Math.min(...xs))} x ${fmt(Math.max(...ys) - Math.min(...ys))}`;
      out.push({
        t: 'text',
        at: { x: r.centroid.x, y: r.centroid.y + 40 },
        s: size,
        size: 8.5,
        color: opt.muted,
        align: 'center',
      });
    }
  }
  // Larger rooms come last, so a big room's name wins over a neighbouring small one that could not fit it anyway.
  for (const r of [...floor.rooms].sort((m, n) => m.area - n.area)) {
    const name = opt.roomLabel ? opt.roomLabel(r.name) : r.name;
    out.push({
      t: 'text',
      at: { x: r.centroid.x, y: r.centroid.y - 150 },
      s: name,
      size: 10.5,
      color: opt.ink,
      align: 'center',
      bold: true,
    });
  }
  return out;
}

/**
 * Chooses which text to draw so that labels never overprint. Later primitives are more important,
 * so room names beat dimensions; whatever is left out appears on zooming in or on a larger sheet.
 */
export function visibleTexts(
  prims: Prim[],
  box: (p: Extract<Prim, { t: 'text' }>) => { x0: number; y0: number; x1: number; y1: number } | null,
): Set<Prim> {
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const out = new Set<Prim>();
  for (let i = prims.length - 1; i >= 0; i--) {
    const p = prims[i];
    if (p.t !== 'text') continue;
    const r = box(p);
    if (!r) continue;
    if (placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue;
    placed.push(r);
    out.add(p);
  }
  return out;
}

/** Text extents around an anchor, for a horizontal or near-vertical label. */
export function textBox(
  cx: number,
  cy: number,
  width: number,
  height: number,
  align: 'left' | 'center' | 'right' | undefined,
  angle: number | undefined,
) {
  const vertical = Math.abs(Math.abs(angle ?? 0) - 90) < 45;
  const w = vertical ? height : width;
  const h = vertical ? width : height;
  const left = vertical || align === 'center' || !align ? cx - w / 2 : align === 'right' ? cx - w : cx;
  return { x0: left, y0: cy - h / 2, x1: left + w, y1: cy + h / 2 };
}

/** Bounds of a primitive list, used to fit plans to a screen or a sheet. */
export function primBounds(prims: Prim[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (p: Vec2) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const p of prims) {
    if (p.t === 'poly') p.pts.forEach(add);
    else if (p.t === 'line') {
      add(p.a);
      add(p.b);
    } else if (p.t === 'circle') {
      add({ x: p.c.x - p.r, y: p.c.y - p.r });
      add({ x: p.c.x + p.r, y: p.c.y + p.r });
    } else if (p.t === 'text') add(p.at);
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}
