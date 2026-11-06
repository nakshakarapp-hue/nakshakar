import type { Id, Vec2, Wall } from '../model/types';
import {
  add,
  closestOnSegment,
  cross,
  dist,
  dot,
  leftNormal,
  lineIntersection,
  norm,
  scale,
  segmentIntersection,
  sub,
} from './vec';

/** Points closer than this are the same junction. */
export const NODE_TOLERANCE = 2;
const MIN_EDGE = NODE_TOLERANCE * 1.5;

/** Geometry of an arc wall derived from its bulge. */
export function arcInfo(wall: Pick<Wall, 'start' | 'end' | 'bulge'>) {
  const chord = dist(wall.start, wall.end);
  const b = wall.bulge;
  const d = norm(sub(wall.end, wall.start));
  const n = leftNormal(d);
  const sagitta = (b * chord) / 2;
  const radius = (chord * (1 + b * b)) / (4 * Math.abs(b));
  const middle = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
  const center = add(middle, scale(n, sagitta - Math.sign(b) * radius));
  const startAngle = Math.atan2(wall.start.y - center.y, wall.start.x - center.x);
  const sweep = 4 * Math.atan(b);
  return { center, radius, startAngle, sweep, length: radius * Math.abs(sweep) };
}

const isArc = (w: Pick<Wall, 'start' | 'end' | 'bulge'>) =>
  Math.abs(w.bulge) > 1e-3 && dist(w.start, w.end) > 1;

/** The polyline that a wall follows; arcs are subdivided into 15 degree chords. */
export function wallPath(wall: Pick<Wall, 'start' | 'end' | 'bulge' | 'points'>): Vec2[] {
  if (isArc(wall)) {
    const { center, radius, startAngle, sweep } = arcInfo(wall);
    const steps = Math.max(4, Math.min(48, Math.ceil(Math.abs(sweep) / (Math.PI / 12))));
    const pts: Vec2[] = [wall.start];
    for (let i = 1; i < steps; i++) {
      const a = startAngle + (sweep * i) / steps;
      pts.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
    }
    pts.push(wall.end);
    return pts;
  }
  return wall.points?.length ? [wall.start, ...wall.points, wall.end] : [wall.start, wall.end];
}

/** True arc length over chord-path length; distances along a wall are always true lengths. */
function chordFactor(wall: Wall): number {
  if (!isArc(wall)) return 1;
  const path = wallPath(wall);
  let chords = 0;
  for (let i = 1; i < path.length; i++) chords += dist(path[i - 1], path[i]);
  return arcInfo(wall).length / chords;
}

export function wallLength(wall: Pick<Wall, 'start' | 'end' | 'bulge' | 'points'>): number {
  if (isArc(wall)) return arcInfo(wall).length;
  const path = wallPath(wall);
  let total = 0;
  for (let i = 1; i < path.length; i++) total += dist(path[i - 1], path[i]);
  return total;
}

/** Point and unit direction at a distance along a wall's path. */
export function pointOnWall(wall: Wall, distance: number): { point: Vec2; dir: Vec2 } {
  if (isArc(wall)) {
    const { center, radius, startAngle, sweep, length } = arcInfo(wall);
    const a = startAngle + sweep * Math.max(0, Math.min(1, distance / length));
    const s = Math.sign(sweep);
    return {
      point: { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) },
      dir: { x: -Math.sin(a) * s, y: Math.cos(a) * s },
    };
  }
  const path = wallPath(wall);
  let remaining = Math.max(0, distance);
  for (let i = 1; i < path.length; i++) {
    const l = dist(path[i - 1], path[i]);
    if (remaining <= l || i === path.length - 1) {
      const dir = norm(sub(path[i], path[i - 1]));
      return { point: add(path[i - 1], scale(dir, Math.min(remaining, l))), dir };
    }
    remaining -= l;
  }
  return { point: wall.start, dir: { x: 1, y: 0 } };
}

/** Nearest distance along a wall to a point. */
export function distanceAlongWall(wall: Wall, p: Vec2): { along: number; distance: number; point: Vec2 } {
  const path = wallPath(wall);
  const factor = chordFactor(wall);
  let walked = 0;
  let best = { along: 0, distance: Infinity, point: wall.start };
  for (let i = 1; i < path.length; i++) {
    const hit = closestOnSegment(p, path[i - 1], path[i]);
    const l = dist(path[i - 1], path[i]);
    if (hit.distance < best.distance)
      best = { along: (walked + hit.t * l) * factor, distance: hit.distance, point: hit.point };
    walked += l;
  }
  return best;
}

export interface GraphEdge {
  wallId: Id;
  /** Node indices at the edge's two ends. Edges keep the wall's own direction. */
  a: number;
  b: number;
  /** True distances along the wall of this edge's two ends. */
  startDist: number;
  endDist: number;
  /** Clearance from the line to the left and right wall faces. */
  leftOffset: number;
  rightOffset: number;
  /** Clockwise footprint: aLeft, bLeft, [b], bRight, aRight, [a]. */
  polygon: Vec2[];
  aLeft: Vec2;
  bLeft: Vec2;
  aRight: Vec2;
  bRight: Vec2;
  /** True when that end has no other wall and needs a closing cap in plan drawings. */
  aFree: boolean;
  bFree: boolean;
}

export interface WallGraph {
  nodes: Vec2[];
  edges: GraphEdge[];
  /** Edge indices by node, sorted by increasing outgoing angle (clockwise on screen). */
  incident: number[][];
}

function faceOffsets(w: Wall): { left: number; right: number } {
  if (w.justification === 'left') return { left: 0, right: w.thickness };
  if (w.justification === 'right') return { left: w.thickness, right: 0 };
  return { left: w.thickness / 2, right: w.thickness / 2 };
}

interface RawEdge {
  wall: Wall;
  a: Vec2;
  b: Vec2;
  startDist: number;
  factor: number;
}

/** Splits every wall chord at crossings and at the ends of walls that meet it mid-span (T-junctions). */
function splitChords(walls: Wall[]): RawEdge[] {
  const chords: RawEdge[] = [];
  for (const wall of walls) {
    const path = wallPath(wall);
    const factor = chordFactor(wall);
    let walked = 0;
    for (let i = 1; i < path.length; i++) {
      chords.push({ wall, a: path[i - 1], b: path[i], startDist: walked, factor });
      walked += dist(path[i - 1], path[i]) * factor;
    }
  }
  const out: RawEdge[] = [];
  for (let i = 0; i < chords.length; i++) {
    const c = chords[i];
    const l = dist(c.a, c.b);
    if (l < MIN_EDGE) continue;
    const cuts: number[] = [];
    for (let j = 0; j < chords.length; j++) {
      if (i === j) continue;
      const o = chords[j];
      if (
        Math.min(c.a.x, c.b.x) - NODE_TOLERANCE > Math.max(o.a.x, o.b.x) ||
        Math.max(c.a.x, c.b.x) + NODE_TOLERANCE < Math.min(o.a.x, o.b.x) ||
        Math.min(c.a.y, c.b.y) - NODE_TOLERANCE > Math.max(o.a.y, o.b.y) ||
        Math.max(c.a.y, c.b.y) + NODE_TOLERANCE < Math.min(o.a.y, o.b.y)
      ) {
        continue;
      }
      const x = segmentIntersection(c.a, c.b, o.a, o.b);
      if (x) cuts.push(closestOnSegment(x, c.a, c.b).t * l);
      for (const end of [o.a, o.b]) {
        const hit = closestOnSegment(end, c.a, c.b);
        if (hit.distance <= NODE_TOLERANCE) cuts.push(hit.t * l);
      }
    }
    const sorted = [...new Set(cuts.map((t) => Math.round(t * 100) / 100))]
      .filter((t) => t > NODE_TOLERANCE && t < l - NODE_TOLERANCE)
      .sort((m, n) => m - n);
    const dir = norm(sub(c.b, c.a));
    let prev = 0;
    for (const t of [...sorted, l]) {
      if (t - prev < 0.01) continue;
      out.push({
        wall: c.wall,
        a: prev === 0 ? c.a : add(c.a, scale(dir, prev)),
        b: t === l ? c.b : add(c.a, scale(dir, t)),
        startDist: c.startDist + prev * c.factor,
        factor: c.factor,
      });
      prev = t;
    }
  }
  return out;
}

/** Builds the junction graph of a floor, with mitred, T and cross junction footprints for every edge. */
export function buildWallGraph(walls: Wall[]): WallGraph {
  const usable = walls.filter((w) => wallLength(w) > MIN_EDGE);
  const raw = splitChords(usable);

  const nodes: Vec2[] = [];
  const buckets = new Map<string, number[]>();
  const cell = (n: number) => Math.round(n / (NODE_TOLERANCE * 4));
  const nodeAt = (p: Vec2): number => {
    const cx = cell(p.x);
    const cy = cell(p.y);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cy - 1; j <= cy + 1; j++) {
        for (const idx of buckets.get(`${i},${j}`) ?? []) {
          if (dist(nodes[idx], p) <= NODE_TOLERANCE) return idx;
        }
      }
    }
    nodes.push({ x: p.x, y: p.y });
    const key = `${cx},${cy}`;
    const list = buckets.get(key);
    if (list) list.push(nodes.length - 1);
    else buckets.set(key, [nodes.length - 1]);
    return nodes.length - 1;
  };

  const seen = new Map<string, number>();
  const edges: GraphEdge[] = [];
  for (const r of raw) {
    const a = nodeAt(r.a);
    const b = nodeAt(r.b);
    if (a === b) continue;
    const off = faceOffsets(r.wall);
    const edge: GraphEdge = {
      wallId: r.wall.id,
      a,
      b,
      startDist: r.startDist,
      endDist: r.startDist + dist(nodes[a], nodes[b]) * r.factor,
      leftOffset: off.left,
      rightOffset: off.right,
      polygon: [],
      aLeft: nodes[a],
      bLeft: nodes[b],
      aRight: nodes[a],
      bRight: nodes[b],
      aFree: false,
      bFree: false,
    };
    // Overlapping walls: the thicker one wins that span.
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const existing = seen.get(key);
    if (existing !== undefined) {
      const e = edges[existing];
      if (e.leftOffset + e.rightOffset < off.left + off.right) edges[existing] = edge;
      continue;
    }
    seen.set(key, edges.length);
    edges.push(edge);
  }

  const incident: number[][] = nodes.map(() => []);
  edges.forEach((e, i) => {
    incident[e.a].push(i);
    incident[e.b].push(i);
  });

  /** Direction leaving a node along an edge. */
  const outDir = (edgeIdx: number, node: number): Vec2 => {
    const e = edges[edgeIdx];
    return norm(sub(nodes[e.a === node ? e.b : e.a], nodes[node]));
  };
  const angleAt = (edgeIdx: number, node: number): number => {
    const d = outDir(edgeIdx, node);
    return Math.atan2(d.y, d.x);
  };
  incident.forEach((list, node) => list.sort((p, q) => angleAt(p, node) - angleAt(q, node)));

  /** Face clearance on the left or right when looking out from a node along an edge. */
  const clearance = (edgeIdx: number, node: number, side: 'left' | 'right'): number => {
    const e = edges[edgeIdx];
    const forward = e.a === node;
    if (side === 'left') return forward ? e.leftOffset : e.rightOffset;
    return forward ? e.rightOffset : e.leftOffset;
  };

  /** Corner on one side of an edge at a node, joined with the neighbour on that side. */
  const corner = (edgeIdx: number, node: number, side: 'left' | 'right'): Vec2 => {
    const list = incident[node];
    const d = outDir(edgeIdx, node);
    const n = leftNormal(d);
    const c = clearance(edgeIdx, node, side);
    const own = add(nodes[node], scale(n, side === 'left' ? c : -c));
    if (list.length < 2) return own;
    const at = list.indexOf(edgeIdx);
    // Angles grow clockwise on screen, so the next edge in the list lies on this edge's right.
    const other = list[(at + (side === 'right' ? 1 : list.length - 1)) % list.length];
    const od = outDir(other, node);
    const on = leftNormal(od);
    const oc = clearance(other, node, side === 'right' ? 'left' : 'right');
    const otherPoint = add(nodes[node], scale(on, side === 'right' ? oc : -oc));
    if (Math.abs(cross(d, od)) < 1e-3) return own;
    const hit = lineIntersection(own, d, otherPoint, od);
    if (!hit) return own;
    // Keep the mitre from spiking on very acute corners, and from running past the edge itself.
    const limit = 3 * Math.max(c, oc, 1);
    return dist(hit, nodes[node]) > limit ||
      dot(sub(hit, own), d) > dist(nodes[edges[edgeIdx].a], nodes[edges[edgeIdx].b])
      ? own
      : hit;
  };

  edges.forEach((e, i) => {
    e.aLeft = corner(i, e.a, 'left');
    e.aRight = corner(i, e.a, 'right');
    // Looking back from b, the wall's left face is on the viewer's right.
    e.bLeft = corner(i, e.b, 'right');
    e.bRight = corner(i, e.b, 'left');
    e.aFree = incident[e.a].length === 1;
    e.bFree = incident[e.b].length === 1;
    const poly: Vec2[] = [e.aLeft, e.bLeft];
    if (incident[e.b].length >= 3) poly.push(nodes[e.b]);
    poly.push(e.bRight, e.aRight);
    if (incident[e.a].length >= 3) poly.push(nodes[e.a]);
    e.polygon = poly;
  });

  return { nodes, edges, incident };
}

export interface DetectedFace {
  /** Centre-line outline, clockwise on screen. */
  outline: Vec2[];
  /** The clearance from the outline to the room's clear face, per outline edge. */
  clearances: number[];
  /** Outlines of islands inside this face, each with its outward clearance per edge. */
  holes: { outline: Vec2[]; clearances: number[] }[];
}

const SMALLEST_ROOM_MM2 = 40000;

/**
 * Extracts the minimal cycles of the wall graph. Dangling walls are ignored; a loop nested inside
 * another room becomes that room's hole as well as a room of its own.
 */
export function detectFaces(
  graph: WallGraph,
  roomEdge: (wallId: Id) => boolean = () => true,
): DetectedFace[] {
  const { nodes, edges } = graph;
  const alive = edges.map((e) => roomEdge(e.wallId));
  const degree = nodes.map(() => 0);
  edges.forEach((e, i) => {
    if (alive[i]) {
      degree[e.a]++;
      degree[e.b]++;
    }
  });
  // Peel dangling walls until only cycles and the bridges between them remain.
  let changed = true;
  while (changed) {
    changed = false;
    edges.forEach((e, i) => {
      if (alive[i] && (degree[e.a] === 1 || degree[e.b] === 1)) {
        alive[i] = false;
        degree[e.a]--;
        degree[e.b]--;
        changed = true;
      }
    });
  }

  const out: { to: number; edge: number; angle: number }[][] = nodes.map(() => []);
  edges.forEach((e, i) => {
    if (!alive[i]) return;
    const ab = sub(nodes[e.b], nodes[e.a]);
    out[e.a].push({ to: e.b, edge: i, angle: Math.atan2(ab.y, ab.x) });
    out[e.b].push({ to: e.a, edge: i, angle: Math.atan2(-ab.y, -ab.x) });
  });
  out.forEach((list) => list.sort((p, q) => p.angle - q.angle));

  const visited = new Set<string>();
  const inner: { outline: Vec2[]; clearances: number[]; area: number; nodes: number[] }[] = [];
  const outer: { outline: Vec2[]; clearances: number[]; nodes: number[] }[] = [];

  for (let start = 0; start < nodes.length; start++) {
    for (const first of out[start]) {
      if (visited.has(`${start}>${first.to}`)) continue;
      const loop: number[] = [];
      const loopClear: number[] = [];
      let u = start;
      let cur = first;
      let guard = edges.length * 2 + 4;
      while (guard-- > 0) {
        visited.add(`${u}>${cur.to}`);
        loop.push(u);
        const e = edges[cur.edge];
        // The face lies on the right of travel, so use the wall face on that side.
        loopClear.push(e.a === u ? e.rightOffset : e.leftOffset);
        const list = out[cur.to];
        const back = list.findIndex((o) => o.to === u);
        // Sharpest right turn: the outgoing edge just before the reversed edge in clockwise order.
        const next = list[(back - 1 + list.length) % list.length];
        u = cur.to;
        cur = next;
        if (u === start && cur.to === first.to) break;
      }
      const outline = loop.map((n) => nodes[n]);
      let area = 0;
      for (let i = 0; i < outline.length; i++) {
        const p = outline[i];
        const q = outline[(i + 1) % outline.length];
        area += p.x * q.y - q.x * p.y;
      }
      area /= 2;
      if (area > 0) inner.push({ outline, clearances: loopClear, area, nodes: loop });
      else if (area < 0) outer.push({ outline, clearances: loopClear, nodes: loop });
    }
  }

  const faces = inner
    .filter((f) => f.area >= SMALLEST_ROOM_MM2)
    .map((f) => ({ ...f, holes: [] as DetectedFace['holes'] }));

  // Attach each outer boundary to the smallest face from another component that contains it.
  for (const boundary of outer) {
    const own = new Set(boundary.nodes);
    const probe = boundary.outline[0];
    let best: (typeof faces)[number] | null = null;
    for (const f of faces) {
      if (f.nodes.some((n) => own.has(n))) continue;
      if (pointInside(probe, f.outline) && (!best || f.area < best.area)) best = f;
    }
    if (best) best.holes.push({ outline: boundary.outline, clearances: boundary.clearances });
  }

  return faces.map(({ outline, clearances, holes }) => ({ outline, clearances, holes }));
}

function pointInside(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Scalar along the edge direction, measured from the edge's a node, of a point. */
export function alongEdge(graph: WallGraph, edge: GraphEdge, p: Vec2): number {
  const a = graph.nodes[edge.a];
  return dot(sub(p, a), norm(sub(graph.nodes[edge.b], a)));
}
