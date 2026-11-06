import * as THREE from 'three';
import { objectById, openingTypeById, plantById, type Part } from '../catalog/catalog';
import { stairLayout } from '../catalog/stairs';
import {
  bbox,
  clipPolygonRange,
  polygonArea,
  signedArea,
  subtractPolygons,
  unionPolygons,
  type PolygonWithHoles,
} from '../core/geometry/polygon';
import { triangulate } from '../core/geometry/triangulate';
import { roomSideOfWall } from '../core/geometry/rooms';
import { dist, leftNormal, norm, rotate, sub } from '../core/geometry/vec';
import { buildWallGraph, pointOnWall, type GraphEdge, type WallGraph } from '../core/geometry/wallGraph';
import type { Floor, MaterialOverride, Opening, Project, TextureId, Vec2, Wall } from '../core/model/types';

/** What a surface belongs to. A tap in 3D reads this to know what to paint. */
/** How far in front of the house Explore begins: close enough to see the front door clearly. */
export const EXPLORE_START_MM = 7000;

export type SurfaceTag =
  | { kind: 'wall'; id: string; floorId: string; side: 'left' | 'right' }
  | { kind: 'floor' | 'ceiling'; id: string; floorId: string }
  | { kind: 'roof' }
  | { kind: 'object'; id: string; floorId: string; part: string }
  | { kind: 'plant'; id: string; floorId: string }
  | { kind: 'pillar'; id: string; floorId: string }
  | { kind: 'opening'; id: string; floorId: string };

let activeTag: SurfaceTag | null = null;

/** Textures are generated, never downloaded. 'none' is plain vertex colour. */
export type BucketKey = TextureId | 'glass';

const M = 0.001;

function colorOf(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

/**
 * Collects triangles for one material into a single buffer, so a whole house draws in a handful of
 * draw calls. This is what keeps the walkthrough smooth on modest phones.
 */
export class MeshBucket {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly uvs: number[] = [];
  /** One per triangle. */
  readonly tags: (SurfaceTag | null)[] = [];

  /** Adds a flat triangle in plan-millimetre coordinates (x, y plan; z up). */
  tri(a: number[], b: number[], c: number[], color: [number, number, number]): void {
    const ax = a[0] * M;
    const ay = a[2] * M;
    const az = a[1] * M;
    const bx = b[0] * M;
    const by = b[2] * M;
    const bz = b[1] * M;
    const cx = c[0] * M;
    const cy = c[2] * M;
    const cz = c[1] * M;
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return;
    this.tags.push(activeTag);
    nx /= l;
    ny /= l;
    nz /= l;
    this.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.colors.push(...color, ...color, ...color);
    // World-space UVs keep brick and tile patterns the same size on every surface.
    const uv = (x: number, y: number, z: number) => {
      if (Math.abs(ny) > 0.7) this.uvs.push(x, z);
      else if (Math.abs(nx) > Math.abs(nz)) this.uvs.push(z, y);
      else this.uvs.push(x, y);
    };
    uv(ax, ay, az);
    uv(bx, by, bz);
    uv(cx, cy, cz);
  }

  quad(a: number[], b: number[], c: number[], d: number[], color: [number, number, number]): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  get triangles(): number {
    return this.positions.length / 9;
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    return g;
  }
}

class Buckets {
  private readonly map = new Map<BucketKey, MeshBucket>();
  get(key: BucketKey): MeshBucket {
    let b = this.map.get(key);
    if (!b) {
      b = new MeshBucket();
      this.map.set(key, b);
    }
    return b;
  }
  entries(): [BucketKey, MeshBucket][] {
    return [...this.map.entries()];
  }
}

type SideColor = (
  nx: number,
  ny: number,
) => { color: [number, number, number]; bucket: BucketKey; tag?: SurfaceTag };

/** Extrudes a plan polygon. `topZ` can vary across the plan, which is how gable-topped walls work. */
function prism(
  buckets: Buckets,
  polygon: Vec2[],
  z0: number,
  topZ: number | ((p: Vec2) => number),
  side: SideColor,
  cap: { color: [number, number, number]; bucket?: BucketKey } | null,
  bottom = false,
): void {
  if (polygon.length < 3 || polygonArea(polygon) < 1) return;
  const poly = signedArea(polygon) > 0 ? polygon : [...polygon].reverse();
  const top = typeof topZ === 'number' ? () => topZ : topZ;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const l = dist(p, q);
    if (l < 0.01) continue;
    // Clockwise plan polygons have their outside on the left of travel.
    const nx = (q.y - p.y) / l;
    const ny = -(q.x - p.x) / l;
    const s = side(nx, ny);
    const pt = top(p);
    const qt = top(q);
    if (pt <= z0 && qt <= z0) continue;
    const outerTag = activeTag;
    if (s.tag) activeTag = s.tag;
    buckets.get(s.bucket).quad([p.x, p.y, z0], [p.x, p.y, pt], [q.x, q.y, qt], [q.x, q.y, z0], s.color);
    activeTag = outerTag;
  }
  if (cap || bottom) {
    const { vertices, indices } = triangulate(poly);
    const capBucket = buckets.get(cap?.bucket ?? 'none');
    const color = cap?.color ?? ([0.9, 0.9, 0.9] as [number, number, number]);
    for (let i = 0; i < indices.length; i += 3) {
      const a = vertices[indices[i]];
      const b = vertices[indices[i + 1]];
      const c = vertices[indices[i + 2]];
      if (cap) capBucket.tri([a.x, a.y, top(a)], [c.x, c.y, top(c)], [b.x, b.y, top(b)], color);
      if (bottom) capBucket.tri([a.x, a.y, z0], [b.x, b.y, z0], [c.x, c.y, z0], color);
    }
  }
}

/** A flat horizontal surface with holes. */
function flat(
  bucket: MeshBucket,
  outer: Vec2[],
  holes: Vec2[][],
  z: number,
  color: [number, number, number],
  faceUp = true,
): void {
  if (outer.length < 3) return;
  const { vertices, indices } = triangulate(outer, holes);
  for (let i = 0; i < indices.length; i += 3) {
    const a = vertices[indices[i]];
    const b = vertices[indices[i + 1]];
    const c = vertices[indices[i + 2]];
    if (faceUp) bucket.tri([a.x, a.y, z], [c.x, c.y, z], [b.x, b.y, z], color);
    else bucket.tri([a.x, a.y, z], [b.x, b.y, z], [c.x, c.y, z], color);
  }
}

const solid =
  (hex: string, bucket: BucketKey = 'none'): SideColor =>
  () => ({ color: colorOf(hex), bucket });

/** A box along an arbitrary 3D line, used for railings. */
function bar(
  bucket: MeshBucket,
  a: [number, number, number],
  b: [number, number, number],
  size: number,
  color: [number, number, number],
): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  const nx = l > 1e-6 ? (-dy / l) * (size / 2) : size / 2;
  const ny = l > 1e-6 ? (dx / l) * (size / 2) : 0;
  const up = size / 2;
  const c = (p: [number, number, number], sx: number, sz: number): number[] => [
    p[0] + nx * sx,
    p[1] + ny * sx,
    p[2] + up * sz,
  ];
  const faces = [
    [c(a, 1, 1), c(b, 1, 1), c(b, -1, 1), c(a, -1, 1)],
    [c(a, -1, -1), c(b, -1, -1), c(b, 1, -1), c(a, 1, -1)],
    [c(a, 1, -1), c(b, 1, -1), c(b, 1, 1), c(a, 1, 1)],
    [c(a, -1, 1), c(b, -1, 1), c(b, -1, -1), c(a, -1, -1)],
  ];
  for (const f of faces) bucket.quad(f[0], f[1], f[2], f[3], color);
}

/** Which wall face a side belongs to: its left face, right face, or an end or reveal. */
function wallSides(
  wall: Wall,
  edge: { dir: Vec2 },
  overrides?: { outerColor?: string; roomOnLeft?: boolean; material?: MaterialOverride; floorId?: string },
  band?: { color: string },
): SideColor {
  const n = leftNormal(edge.dir);
  const isOuter = wall.type === 'outer';
  const faces = wallFaces(wall, overrides?.outerColor, overrides?.roomOnLeft, overrides?.material);
  return (nx, ny) => {
    const d = nx * n.x + ny * n.y;
    const floorId = overrides?.floorId ?? '';
    if (d > 0.5)
      return {
        ...(band ? { color: colorOf(band.color), bucket: 'none' as BucketKey } : faces.left),
        tag: { kind: 'wall', id: wall.id, floorId, side: 'left' },
      };
    if (d < -0.5)
      return {
        ...(band ? { color: colorOf(band.color), bucket: 'none' as BucketKey } : faces.right),
        tag: { kind: 'wall', id: wall.id, floorId, side: 'right' },
      };
    return { color: colorOf(isOuter ? '#d9d4c8' : wall.topColor), bucket: 'none' };
  };
}

function wallFaces(wall: Wall, outerColor?: string, roomOnLeft = false, material?: MaterialOverride) {
  const glass = wall.type === 'glass' || wall.material === 'glass';
  // A material override changes every wall of that material, unless a face has its own finish.
  const bucketOf = (t: TextureId): BucketKey =>
    glass ? 'glass' : t === 'none' && material?.texture ? material.texture : t;
  const colorFor = (c: string) => colorOf(c);
  // Only outer walls take the elevation colour, and only on their outdoor face.
  const elevation = outerColor && wall.type === 'outer' ? outerColor : null;
  const left = elevation && !roomOnLeft ? elevation : (material?.color ?? wall.leftColor);
  const right = elevation && roomOnLeft ? elevation : (material?.color ?? wall.rightColor);
  return {
    left: { color: colorFor(left), bucket: bucketOf(wall.leftTexture) },
    right: { color: colorFor(right), bucket: bucketOf(wall.rightTexture) },
  };
}

interface Span {
  t0: number;
  t1: number;
  opening: Opening | null;
}

/** Divides an edge into stretches of plain wall and stretches holding an opening. */
function edgeSpans(edge: GraphEdge, openings: Opening[], length: number): Span[] {
  const factor = length / Math.max(0.001, edge.endDist - edge.startDist);
  const cuts = openings
    .map((o) => ({
      o,
      t0: (o.position - o.width / 2 - edge.startDist) * factor,
      t1: (o.position + o.width / 2 - edge.startDist) * factor,
    }))
    .filter((c) => c.t1 > 0 && c.t0 < length)
    .sort((a, b) => a.t0 - b.t0);
  const spans: Span[] = [];
  const pad = 600; // Mitred ends lie past the node line, so plain spans extend to include them.
  let at = -pad;
  for (const c of cuts) {
    const start = Math.max(0, c.t0);
    const end = Math.min(length, c.t1);
    if (start > at + 0.01) spans.push({ t0: at, t1: start, opening: null });
    spans.push({ t0: start, t1: end, opening: c.o });
    at = end;
  }
  spans.push({ t0: at, t1: length + pad, opening: null });
  return spans;
}

/** One moving door or window leaf, with its geometry kept apart from the merged house. */
export interface MovablePart {
  openingId: string;
  floorId: string;
  kind: 'door' | 'window';
  bucketKey: BucketKey;
  bucket: MeshBucket;
  /** Pivot in world metres. */
  pivot: [number, number, number];
  /** Fully open: a turn about the vertical axis in radians, and a move in metres. */
  turn: number;
  move: [number, number, number];
}

function buildOpening(
  buckets: Buckets,
  o: Opening,
  wall: Wall,
  base: number,
  doorsOpen: boolean,
  rooms: Floor['rooms'],
  floorId: string,
  movables?: MovablePart[],
): void {
  const { point, dir } = pointOnWall(wall, o.position);
  const n = leftNormal(dir);
  const half = o.width / 2;
  const depth = wall.thickness / 2;
  const frameW = Math.max(30, o.frameThickness);
  const frame = colorOf(o.frameColor);
  const z0 = base + o.sillHeight;
  const z1 = z0 + o.height;
  const style = openingTypeById.get(o.catalogId)?.style ?? (o.kind === 'door' ? 'swing' : 'sliding');
  if (style === 'arch') return;
  const at = (along: number, across: number): Vec2 => ({
    x: point.x + dir.x * along + n.x * across,
    y: point.y + dir.y * along + n.y * across,
  });
  const box = (a0: number, a1: number, c0: number, c1: number): Vec2[] => [
    at(a0, c0),
    at(a1, c0),
    at(a1, c1),
    at(a0, c1),
  ];
  const frameDepth = Math.min(depth, 60);
  const frameSide = solid(o.frameColor);
  const addBox = (
    a0: number,
    a1: number,
    c0: number,
    c1: number,
    zA: number,
    zB: number,
    color: string,
    bucket: BucketKey = 'none',
    into: Buckets = buckets,
  ) =>
    prism(into, box(a0, a1, c0, c1), zA, zB, solid(color, bucket), { color: colorOf(color), bucket }, true);
  /** A new moving part, or the merged house when moving parts were not asked for. */
  const movingPart = (
    build: (into: Buckets) => void,
    pivotPlan: Vec2,
    turn: number,
    move: [number, number, number],
  ) => {
    if (!movables) {
      build(buckets);
      return;
    }
    const own = new Buckets();
    const before = activeTag;
    activeTag = { kind: 'opening', id: o.id, floorId };
    build(own);
    activeTag = before;
    for (const [bucketKey, bucket] of own.entries()) {
      movables.push({
        openingId: o.id,
        floorId,
        kind: o.kind,
        bucketKey,
        bucket,
        pivot: [pivotPlan.x * M, base * M, pivotPlan.y * M],
        turn,
        move,
      });
    }
  };

  // Frame: jambs and head, with a sill for windows.
  prism(buckets, box(-half, -half + frameW, -frameDepth, frameDepth), z0, z1, frameSide, { color: frame });
  prism(buckets, box(half - frameW, half, -frameDepth, frameDepth), z0, z1, frameSide, { color: frame });
  prism(
    buckets,
    box(-half, half, -frameDepth, frameDepth),
    z1 - frameW,
    z1,
    frameSide,
    { color: frame },
    true,
  );
  if (o.kind === 'window')
    prism(buckets, box(-half, half, -frameDepth, frameDepth), z0, z0 + frameW, frameSide, { color: frame });

  const panels = Math.max(1, o.panels);
  const innerW = o.width - 2 * frameW;
  const innerZ0 = z0 + (o.kind === 'window' ? frameW : 10);
  const innerZ1 = z1 - frameW;
  const isGlass = o.shutterMaterial === 'glass';
  const shutterColor = isGlass ? o.glassTint || o.shutterColor : o.shutterColor;
  const leafBucket: BucketKey = isGlass ? 'glass' : o.shutterMaterial === 'teak' ? 'wood' : 'none';

  // In the game every swinging leaf is built shut and opened by turning it about its hinge.
  if (movables && style === 'swing') {
    const leafW = innerW / panels;
    const roomSide = roomSideOfWall(rooms, point, n, wall.thickness / 2 + 150);
    const openSide = (
      o.kind === 'door' ? (o.swingDirection === 'in' ? roomSide : -roomSide) : -roomSide
    ) as number;
    for (let i = 0; i < panels; i++) {
      const fromLeft = panels >= 2 ? i < panels / 2 : o.swingSide === 'left';
      const hingeAlong = fromLeft
        ? -half + frameW + (panels > 2 ? i * leafW : 0)
        : half - frameW - (panels > 2 ? (panels - 1 - i) * leafW : 0);
      const signAlong = fromLeft ? 1 : -1;
      const closedX = dir.x * signAlong;
      const closedZ = dir.y * signAlong;
      const a = (82 * Math.PI) / 180;
      const openX = closedX * Math.cos(a) + n.x * openSide * Math.sin(a);
      const openZ = closedZ * Math.cos(a) + n.y * openSide * Math.sin(a);
      const turn = Math.atan2(closedZ, closedX) - Math.atan2(openZ, openX);
      const a0 = fromLeft ? hingeAlong : hingeAlong - leafW;
      movingPart(
        (into) => addBox(a0, a0 + leafW, -20, 20, innerZ0, innerZ1, shutterColor, leafBucket, into),
        at(hingeAlong, 0),
        Math.atan2(Math.sin(turn), Math.cos(turn)),
        [0, 0, 0],
      );
    }
    return;
  }
  if (o.kind === 'door' && style === 'swing') {
    const leafW = innerW / panels;
    for (let i = 0; i < panels; i++) {
      const hingeLeft = panels === 2 ? i === 0 : o.swingSide === 'left';
      const hingeAlong = hingeLeft ? -half + frameW : half - frameW;
      // Leaf direction in wall axes: along the wall when shut, swung to the plan symbol's side when open.
      // 'in' opens towards the room, the same side the 2D door arc is drawn on.
      const angle = doorsOpen ? (80 * Math.PI) / 180 : 0;
      const leafX = (hingeLeft ? 1 : -1) * Math.cos(angle);
      const roomSide = roomSideOfWall(rooms, point, n, wall.thickness / 2 + 150);
      const leafY = (o.swingDirection === 'in' ? roomSide : -roomSide) * Math.sin(angle);
      const hinge = at(hingeAlong, 0);
      const corner = (along: number, across: number): Vec2 => {
        const u = leafX * along - leafY * across;
        const w = leafY * along + leafX * across;
        return { x: hinge.x + dir.x * u + n.x * w, y: hinge.y + dir.y * u + n.y * w };
      };
      const leaf = [corner(0, -20), corner(leafW, -20), corner(leafW, 20), corner(0, 20)];
      prism(
        buckets,
        leaf,
        innerZ0,
        innerZ1,
        solid(shutterColor, leafBucket),
        { color: colorOf(shutterColor), bucket: leafBucket },
        true,
      );
    }
    return;
  }

  // Sliding, fixed, louvred, folding and casement windows are drawn closed within the frame.
  const paneW = innerW / panels;
  for (let i = 0; i < panels; i++) {
    const a0 = -half + frameW + i * paneW;
    const offset = panels > 1 && style === 'sliding' ? (i % 2 === 0 ? 12 : -12) : 0;
    // Sliding panes run behind their neighbour; a shutter with no panes to slide past rolls up.
    const rollsUp = style === 'fixed' && o.kind === 'door';
    const slides = style === 'sliding' || style === 'folding';
    const moves = (rollsUp || slides) && (panels === 1 || i % 2 === 1);
    const back = i === 0 ? paneW : -paneW;
    const part = (into: Buckets) =>
      addBox(
        a0 + 8,
        a0 + paneW - 8,
        offset - 5,
        offset + 5,
        innerZ0,
        innerZ1,
        shutterColor,
        leafBucket,
        into,
      );
    if (movables && moves) {
      const distance = panels === 1 ? -paneW * 0.92 : back * 0.98;
      movingPart(
        part,
        at(a0, 0),
        0,
        rollsUp ? [0, (innerZ1 - innerZ0) * M * 0.94, 0] : [dir.x * distance * M, 0, dir.y * distance * M],
      );
    } else {
      part(buckets);
    }
    if (i > 0) prism(buckets, box(a0 - 12, a0 + 12, -20, 20), innerZ0, innerZ1, frameSide, null);
  }
  if (style === 'louvre') {
    const slats = Math.max(3, Math.floor((innerZ1 - innerZ0) / 120));
    for (let i = 0; i < slats; i++) {
      const z = innerZ0 + ((i + 0.5) * (innerZ1 - innerZ0)) / slats;
      addBox(-half + frameW, half - frameW, -25, 25, z, z + 18, o.frameColor);
    }
  }
  if (o.grill) {
    const bars = Math.max(2, Math.floor(innerW / 110));
    for (let i = 1; i < bars; i++) {
      const a = -half + frameW + (i * innerW) / bars;
      addBox(a - 6, a + 6, 28, 40, innerZ0, innerZ1, '#30343a');
    }
    if (o.grillPattern === 'diamond') {
      const span = innerZ1 - innerZ0;
      const rail = buckets.get('none');
      const c = colorOf('#30343a');
      const a0 = -half + frameW;
      const lattice = (along: number, z: number) => {
        const p = at(a0 + along, 34);
        return [p.x, p.y, innerZ0 + z] as [number, number, number];
      };
      for (let d = -span; d < innerW; d += 260) {
        const s0 = Math.max(0, -d);
        const s1 = Math.min(span, innerW - d);
        if (s1 > s0) {
          bar(rail, lattice(d + s0, s0), lattice(d + s1, s1), 12, c);
          bar(rail, lattice(innerW - d - s0, s0), lattice(innerW - d - s1, s1), 12, c);
        }
      }
    } else if (o.grillPattern !== 'bars') {
      const rows = Math.max(2, Math.floor((innerZ1 - innerZ0) / 150));
      for (let i = 1; i < rows; i++) {
        const z = innerZ0 + (i * (innerZ1 - innerZ0)) / rows;
        addBox(-half + frameW, half - frameW, 28, 40, z - 6, z + 6, '#30343a');
      }
    }
  }
  if (o.mosquitoNet) addBox(-half + frameW, half - frameW, -28, -24, innerZ0, innerZ1, '#2b2f33', 'glass');
  if (o.curtain)
    addBox(
      -half - 80,
      -half + innerW * 0.22,
      -depth - 40,
      -depth - 10,
      innerZ0 - 100,
      innerZ1 + 120,
      o.curtainColor,
    );
  if (o.curtain)
    addBox(
      half - innerW * 0.22,
      half + 80,
      -depth - 40,
      -depth - 10,
      innerZ0 - 100,
      innerZ1 + 120,
      o.curtainColor,
    );
}

function buildWalls(
  buckets: Buckets,
  floor: Floor,
  graph: WallGraph,
  base: number,
  project: Project,
  doorsOpen: boolean,
  movables?: MovablePart[],
): void {
  const byId = new Map(floor.walls.map((w) => [w.id, w]));
  const outerColor = project.elevationOverrides.wallColor;
  for (const e of graph.edges) {
    const wall = byId.get(e.wallId);
    if (!wall || wall.hidden) continue;
    const a = graph.nodes[e.a];
    const b = graph.nodes[e.b];
    const dir = norm(sub(b, a));
    const length = dist(a, b);
    const openings = floor.openings.filter((o) => o.wallId === wall.id);
    const wallBase = base + wall.baseOffset;
    const wallTop = wallBase + wall.height;
    const gable = wall.gableRise > 0 && wall.bulge === 0;
    const startDistScale = (e.endDist - e.startDist) / Math.max(0.001, length);
    const topZ = (p: Vec2): number => {
      if (!gable) return wallTop;
      const along = e.startDist + ((p.x - a.x) * dir.x + (p.y - a.y) * dir.y) * startDistScale;
      const total = dist(wall.start, wall.end);
      return wallTop + wall.gableRise * Math.max(0, 1 - Math.abs(along - total / 2) / (total / 2));
    };

    const roomOnLeft =
      roomSideOfWall(
        floor.rooms,
        { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        leftNormal(dir),
        wall.thickness / 2 + 150,
      ) === 1;
    const accent = project.elevationOverrides.accentColor;
    const sides = wallSides(
      wall,
      { dir },
      { outerColor, roomOnLeft, material: project.materials[wall.material], floorId: floor.id },
    );
    const topCap = { color: colorOf(wall.type === 'parapet' && accent ? accent : wall.topColor) };

    for (const span of edgeSpans(e, openings, length)) {
      const piece = clipPolygonRange(e.polygon, a, dir, span.t0, span.t1);
      if (piece.length < 3) continue;
      if (!span.opening) {
        wallBands(buckets, piece, wall, wallBase, topZ, sides, topCap, { dir }, floor.id);
        continue;
      }
      const o = span.opening;
      const sillTop = wallBase + o.sillHeight;
      const headZ = sillTop + o.height;
      // These overlap their neighbours slightly, which closes the hairline cracks where their edges meet.
      const lapped = clipPolygonRange(e.polygon, a, dir, span.t0 - 2, span.t1 + 2);
      if (o.sillHeight > 0) prism(buckets, lapped, wallBase, sillTop, sides, { color: colorOf('#d9d4c8') });
      if (headZ < wallTop) prism(buckets, lapped, headZ, topZ, sides, topCap, true);
      if (wall.gableRise > 0 && headZ >= wallTop) prism(buckets, lapped, wallTop, topZ, sides, topCap);
    }
    for (const o of openings) {
      // Each opening is built once, by the edge holding its centre.
      if (o.position >= e.startDist && o.position < e.endDist)
        buildOpening(buckets, o, wall, wallBase, doorsOpen, floor.rooms, floor.id, movables);
    }
  }
}

/** Solid wall with optional skirting and dado bands on its faces. */
function wallBands(
  buckets: Buckets,
  piece: Vec2[],
  wall: Wall,
  base: number,
  topZ: (p: Vec2) => number,
  sides: SideColor,
  topCap: { color: [number, number, number] },
  edge: { dir: Vec2 },
  floorId: string,
): void {
  const bands: { z0: number; z1: number; color: string }[] = [];
  if (wall.type !== 'parapet' && wall.type !== 'compound') {
    if (wall.dadoHeight > 0) bands.push({ z0: base, z1: base + wall.dadoHeight, color: wall.dadoColor });
    else if (wall.skirtingHeight > 0)
      bands.push({ z0: base, z1: base + wall.skirtingHeight, color: '#b9b2a3' });
  }
  let bottom = base;
  for (const band of bands) {
    prism(buckets, piece, band.z0, band.z1, wallSides(wall, edge, { floorId }, { color: band.color }), null);
    bottom = band.z1;
  }
  prism(buckets, piece, bottom, topZ, sides, topCap);
}

function partGeometry(
  bucket: MeshBucket,
  part: Part,
  place: (x: number, y: number) => Vec2,
  z0: number,
  h: number,
  W: number,
  D: number,
  color: [number, number, number],
): void {
  const pz0 = z0 + part.z * h;
  const pz1 = pz0 + part.h * h;
  if (part.s === 'box') {
    const a = place(part.x, part.y);
    const b = place(part.x + part.w, part.y);
    const c = place(part.x + part.w, part.y + part.d);
    const d = place(part.x, part.y + part.d);
    const P = (p: Vec2, z: number) => [p.x, p.y, z];
    bucket.quad(P(a, pz1), P(d, pz1), P(c, pz1), P(b, pz1), color);
    bucket.quad(P(a, pz0), P(b, pz0), P(c, pz0), P(d, pz0), color);
    bucket.quad(P(a, pz0), P(a, pz1), P(b, pz1), P(b, pz0), color);
    bucket.quad(P(b, pz0), P(b, pz1), P(c, pz1), P(c, pz0), color);
    bucket.quad(P(c, pz0), P(c, pz1), P(d, pz1), P(d, pz0), color);
    bucket.quad(P(d, pz0), P(d, pz1), P(a, pz1), P(a, pz0), color);
    return;
  }
  const c = place(part.x + part.w / 2, part.y + part.d / 2);
  const rx = (part.w * W) / 2;
  const ry = (part.d * D) / 2;
  const ring = (radius: number, z: number, sides: number): number[][] =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2;
      return [c.x + Math.cos(a) * rx * radius, c.y + Math.sin(a) * ry * radius, z];
    });
  if (part.s === 'cyl' || part.s === 'cone') {
    const sides = 10;
    const bottom = ring(1, pz0, sides);
    const top = ring(part.s === 'cone' ? 0.02 : 1, pz1, sides);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      bucket.quad(bottom[i], top[i], top[j], bottom[j], color);
      bucket.tri([c.x, c.y, pz1], top[j], top[i], color);
      bucket.tri([c.x, c.y, pz0], bottom[i], bottom[j], color);
    }
    return;
  }
  // Sphere as stacked rings; low-poly on purpose, for phones.
  const stacks = 5;
  const sides = 8;
  const zMid = (pz0 + pz1) / 2;
  const zr = (pz1 - pz0) / 2;
  const rows: number[][][] = [];
  for (let s = 0; s <= stacks; s++) {
    const a = (s / stacks) * Math.PI - Math.PI / 2;
    rows.push(ring(Math.max(0.001, Math.cos(a)), zMid + Math.sin(a) * zr, sides));
  }
  for (let s = 0; s < stacks; s++) {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      bucket.quad(rows[s][i], rows[s + 1][i], rows[s + 1][j], rows[s][j], color);
    }
  }
}

function buildObjects(buckets: Buckets, floor: Floor, base: number): void {
  const bucket = buckets.get('none');
  for (const item of floor.objects) {
    if (item.hidden) continue;
    const cat = objectById.get(item.catalogId);
    if (!cat) continue;
    const t = item.transform;
    const W = item.width * t.scaleX;
    const D = item.depth * t.scaleY;
    const H = item.height * t.scaleZ;
    const place = (x: number, y: number): Vec2 => {
      const p = rotate({ x: (x - 0.5) * W, y: (y - 0.5) * D }, t.rotation);
      return { x: t.x + p.x, y: t.y + p.y };
    };
    for (const part of cat.parts) {
      activeTag = { kind: 'object', id: item.id, floorId: floor.id, part: part.c };
      const color = colorOf(item.colors[part.c] ?? cat.colors[part.c] ?? '#999999');
      partGeometry(bucket, part, place, base + t.z, H, W, D, color);
    }
    activeTag = null;
  }
}

function buildPlants(buckets: Buckets, floor: Floor, base: number): void {
  const bucket = buckets.get('none');
  for (const plant of floor.plants) {
    if (plant.hidden) continue;
    const form = plantById.get(plant.catalogId)?.form ?? 'tree';
    const t = plant.transform;
    const S = plant.spread;
    const H = plant.height;
    const place = (x: number, y: number): Vec2 => ({ x: t.x + (x - 0.5) * S, y: t.y + (y - 0.5) * S });
    const leaf = colorOf(plant.foliageColor);
    const trunk = colorOf(plant.trunkColor);
    activeTag = { kind: 'plant', id: plant.id, floorId: floor.id };
    const add = (
      s: Part['s'],
      x: number,
      y: number,
      z: number,
      w: number,
      d: number,
      h: number,
      c: [number, number, number],
    ) => partGeometry(bucket, { s, x, y, z, w, d, h, c: '' }, place, base, H, S, S, c);
    if (form === 'grass') {
      add('cyl', 0, 0, 0, 1, 1, 1, leaf);
    } else if (form === 'pot') {
      add('cyl', 0.2, 0.2, 0, 0.6, 0.6, 0.35, trunk);
      add('sphere', 0, 0, 0.3, 1, 1, 0.7, leaf);
    } else if (form === 'shrub') {
      add('sphere', 0, 0, 0, 1, 1, 1, leaf);
    } else if (form === 'palm') {
      add('cyl', 0.47, 0.47, 0, 0.06, 0.06, 0.85, trunk);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const cx = 0.5 + Math.cos(a) * 0.28;
        const cy = 0.5 + Math.sin(a) * 0.28;
        add('sphere', cx - 0.22, cy - 0.22, 0.8, 0.44, 0.44, 0.1, leaf);
      }
    } else {
      add('cyl', 0.44, 0.44, 0, 0.12, 0.12, 0.45, trunk);
      add('sphere', 0, 0, 0.32, 1, 1, 0.55, leaf);
      add('sphere', 0.18, 0.18, 0.62, 0.64, 0.64, 0.38, leaf);
    }
    activeTag = null;
  }
}

function buildStairs(buckets: Buckets, floor: Floor, base: number): void {
  for (const s of floor.stairs) {
    if (s.hidden) continue;
    const layout = stairLayout(s);
    const tread = colorOf(s.treadColor);
    const rail = colorOf(s.railColor);
    for (const step of layout.steps) {
      const thick = s.shape === 'spiral' ? 60 : Math.min(step.z, step.landing ? 220 : 340);
      prism(
        buckets,
        step.polygon,
        base + step.z - thick,
        base + step.z,
        () => ({ color: tread, bucket: 'none' }),
        { color: tread },
        true,
      );
    }
    if (!s.hasRailing) continue;
    const bucket = buckets.get('none');
    // Hand rails along the open edges, 900 mm above the steps, with a post about every metre.
    if (layout.pole)
      bar(
        bucket,
        [layout.pole.x, layout.pole.y, base],
        [layout.pole.x + 1, layout.pole.y, base + s.totalRise + 900],
        90,
        rail,
      );
    for (const line of layout.rails) {
      line.forEach((b, i) => {
        if (i === 0) return;
        const a = line[i - 1];
        bar(bucket, [a.x, a.y, base + a.z + 900], [b.x, b.y, base + b.z + 900], 44, rail);
        const span = Math.hypot(b.x - a.x, b.y - a.y);
        const posts = Math.max(1, Math.round(span / 1000));
        for (let k = i === 1 ? 0 : 1; k <= posts; k++) {
          const f = k / posts;
          const x = a.x + (b.x - a.x) * f;
          const y = a.y + (b.y - a.y) * f;
          const z = base + a.z + (b.z - a.z) * f;
          bar(bucket, [x, y, z], [x + 1, y, z + 900], 30, rail);
        }
      });
    }
  }
}

function buildPillarsAndBeams(buckets: Buckets, floor: Floor, base: number): void {
  for (const c of floor.pillars) {
    if (c.hidden) continue;
    const t = c.transform;
    const col = colorOf(c.color);
    if (c.shape === 'round') {
      const sides = 16;
      const pts = Array.from({ length: sides }, (_, i) => {
        const a = (i / sides) * Math.PI * 2;
        return { x: t.x + (Math.cos(a) * c.width) / 2, y: t.y + (Math.sin(a) * c.width) / 2 };
      });
      prism(buckets, pts, base, base + c.height, () => ({ color: col, bucket: 'none' }), { color: col });
    } else {
      const place = (x: number, y: number): Vec2 => {
        const p = rotate({ x, y }, t.rotation);
        return { x: t.x + p.x, y: t.y + p.y };
      };
      const hw = c.width / 2;
      const hd = c.depth / 2;
      prism(
        buckets,
        [place(-hw, -hd), place(hw, -hd), place(hw, hd), place(-hw, hd)],
        base,
        base + c.height,
        () => ({ color: col, bucket: 'none' }),
        { color: col },
      );
    }
  }
  for (const b of floor.beams) {
    if (b.hidden) continue;
    const n = leftNormal(norm(sub(b.end, b.start)));
    const h = b.width / 2;
    const col = colorOf(b.color);
    prism(
      buckets,
      [
        { x: b.start.x + n.x * h, y: b.start.y + n.y * h },
        { x: b.end.x + n.x * h, y: b.end.y + n.y * h },
        { x: b.end.x - n.x * h, y: b.end.y - n.y * h },
        { x: b.start.x - n.x * h, y: b.start.y - n.y * h },
      ],
      base + b.soffit,
      base + b.soffit + b.depth,
      () => ({ color: col, bucket: 'none' }),
      { color: col },
      true,
    );
  }
  for (const s of floor.slabs) {
    const col = colorOf(s.color);
    const z = base + s.zOffset;
    prism(
      buckets,
      s.polygon,
      z - s.thickness,
      z,
      () => ({ color: col, bucket: 'none' }),
      { color: col },
      true,
    );
  }
}

const FINISH_TEXTURE: Record<string, BucketKey> = {
  vitrified: 'tile',
  ceramic: 'tile',
  marble: 'marble',
  granite: 'marble',
  kota: 'stone',
  wood: 'wood',
  cement: 'concrete',
  grass: 'grass',
};

function floorFootprint(graph: WallGraph, rooms: Floor['rooms']): PolygonWithHoles[] {
  const polys = [...graph.edges.map((e) => e.polygon), ...rooms.map((r) => r.polygon)];
  if (!polys.length) return [];
  try {
    return unionPolygons(polys);
  } catch {
    return [];
  }
}

function buildSlabs(
  buckets: Buckets,
  floor: Floor,
  below: Floor | null,
  graph: WallGraph,
  belowGraph: WallGraph | null,
  base: number,
  plinth: number,
  accent?: string,
): void {
  const slabBucket = buckets.get('concrete');
  const shape = floorFootprint(graph, floor.rooms);
  const lower = below && belowGraph ? floorFootprint(belowGraph, below.rooms) : [];
  // A floor's slab must also cover the storey beneath, as a roof over any part this floor does not use.
  let outline: PolygonWithHoles[] = shape;
  if (lower.length) {
    try {
      outline = unionPolygons([...shape.map((s) => s.outer), ...lower.map((s) => s.outer)]);
    } catch {
      outline = shape.length ? shape : lower;
    }
  }
  const voids = below ? below.stairs.filter((s) => !s.hidden).map((s) => stairLayout(s).outline) : [];
  const edgeColor = colorOf(accent ?? '#cfcabd');
  const ceiling = colorOf('#f5f3ee');
  const slabTop = base - floor.finishThickness;
  const slabBottom = slabTop - floor.slabThickness;
  for (const piece of outline) {
    let parts: PolygonWithHoles[] = [piece];
    if (voids.length) {
      try {
        parts = subtractPolygons(piece, voids);
      } catch {
        parts = [piece];
      }
    }
    for (const part of parts) {
      flat(slabBucket, part.outer, part.holes, base - 2, colorOf('#c7c2b6'));
      flat(buckets.get('none'), part.outer, part.holes, slabBottom, ceiling, false);
      prism(
        buckets,
        part.outer,
        slabBottom,
        base - 2,
        () => ({ color: edgeColor, bucket: 'concrete' }),
        null,
      );
      for (const hole of part.holes)
        prism(buckets, hole, slabBottom, base - 2, () => ({ color: edgeColor, bucket: 'concrete' }), null);
    }
  }
  if (!below) {
    // Plinth wall down to the ground level around the footprint.
    for (const part of outline)
      prism(
        buckets,
        part.outer,
        base - plinth,
        base - 2,
        () => ({ color: colorOf('#a39d90'), bucket: 'stone' }),
        null,
      );
  }
  for (const r of floor.rooms) {
    const key = FINISH_TEXTURE[r.floorFinish] ?? 'tile';
    const holesWithStairs = [...r.holes];
    let polys: PolygonWithHoles[] = [{ outer: r.polygon, holes: holesWithStairs }];
    if (voids.length) {
      try {
        polys = polys.flatMap((p) => subtractPolygons(p, voids));
      } catch {
        // Keep the whole room floor rather than lose it.
      }
    }
    activeTag = { kind: 'floor', id: r.id, floorId: floor.id };
    for (const p of polys) flat(buckets.get(key), p.outer, p.holes, base, colorOf(r.floorColor));
    activeTag = null;
  }
}

/** Each room's own ceiling: its colour, material and height. Open to the sky rooms have none. */
function buildCeilings(buckets: Buckets, floor: Floor, base: number): void {
  const voids = floor.stairs.filter((s) => !s.hidden).map((s) => stairLayout(s).outline);
  for (const r of floor.rooms) {
    if (r.type === 'terrace' || r.type === 'open_court') continue;
    let parts: PolygonWithHoles[] = [{ outer: r.polygon, holes: r.holes }];
    if (voids.length) {
      try {
        parts = parts.flatMap((p) => subtractPolygons(p, voids));
      } catch {
        // A whole ceiling is better than none.
      }
    }
    const bucket = buckets.get(r.ceilingType === 'wood' ? 'wood' : 'none');
    activeTag = { kind: 'ceiling', id: r.id, floorId: floor.id };
    for (const p of parts)
      flat(bucket, p.outer, p.holes, base + r.ceilingHeight - 2, colorOf(r.ceilingColor), false);
    activeTag = null;
  }
}

function buildRoof(buckets: Buckets, project: Project, top: Floor, graph: WallGraph): void {
  const rooms = top.rooms;
  if (!rooms.length && !graph.edges.length) return;
  if (rooms.some((r) => r.type === 'terrace')) return; // A terrace floor is itself the roof.
  activeTag = { kind: 'roof' };
  const roof = project.roof;
  const wallTop =
    top.elevation + Math.max(...top.walls.filter((w) => w.type !== 'compound').map((w) => w.height), 0);
  const footprint = floorFootprint(graph, rooms);
  const b = bbox(footprint.flatMap((s) => s.outer));
  if (!Number.isFinite(b.minX)) return;
  const color = colorOf(roof.color);
  const ceiling = colorOf('#f5f3ee');
  const bucket = buckets.get('none');
  const h = roof.overhang;
  const x0 = b.minX - h;
  const x1 = b.maxX + h;
  const y0 = b.minY - h;
  const y1 = b.maxY + h;
  const z = wallTop;
  const rise = roof.rise;
  const corners = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  if (roof.type === 'flat') {
    for (const s of footprint) {
      prism(
        buckets,
        s.outer,
        z,
        z + roof.thickness,
        () => ({ color: colorOf('#d9d4c8'), bucket: 'concrete' }),
        { color: colorOf('#b8b3a6'), bucket: 'concrete' },
        true,
      );
      if (roof.parapetHeight > 0) {
        const thick = 115;
        const cw = signedArea(s.outer) > 0 ? s.outer : [...s.outer].reverse();
        for (let i = 0; i < cw.length; i++) {
          const p = cw[i];
          const q = cw[(i + 1) % cw.length];
          const n = leftNormal(norm(sub(q, p)));
          const inner = (v: Vec2): Vec2 => ({ x: v.x - n.x * thick, y: v.y - n.y * thick });
          const c = colorOf(roof.parapetColor);
          prism(
            buckets,
            [p, q, inner(q), inner(p)],
            z + roof.thickness,
            z + roof.thickness + roof.parapetHeight,
            () => ({ color: c, bucket: 'none' }),
            { color: colorOf('#d9d4c8') },
          );
        }
      }
    }
    return;
  }
  flat(bucket, corners, [], z, ceiling, false);
  if (roof.type === 'shed') {
    const P = (p: Vec2, up: number) => [p.x, p.y, z + up];
    const a = corners[0];
    const c1 = corners[1];
    const c2 = corners[2];
    const d = corners[3];
    const tileB = buckets.get('tile');
    tileB.quad(P(a, rise), P(d, 0), P(c2, 0), P(c1, rise), color);
    bucket.quad(P(a, 0), P(a, rise), P(c1, rise), P(c1, 0), colorOf(roof.parapetColor));
    bucket.tri(P(c1, 0), P(c1, rise), P(c2, 0), colorOf(roof.parapetColor));
    bucket.tri(P(d, 0), P(a, rise), P(a, 0), colorOf(roof.parapetColor));
    return;
  }
  const tileB = buckets.get('tile');
  const P = (p: Vec2, up: number) => [p.x, p.y, z + up];
  const alongX = roof.ridgeAlongX;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (roof.type === 'gable') {
    const gableColor = colorOf(project.elevationOverrides.wallColor ?? '#f4efe6');
    if (alongX) {
      const r0 = { x: x0, y: cy };
      const r1 = { x: x1, y: cy };
      tileB.quad(P(corners[0], 0), P(r0, rise), P(r1, rise), P(corners[1], 0), color);
      tileB.quad(P(corners[2], 0), P(r1, rise), P(r0, rise), P(corners[3], 0), color);
      bucket.tri(P(corners[3], 0), P(r0, rise), P(corners[0], 0), gableColor);
      bucket.tri(P(corners[1], 0), P(r1, rise), P(corners[2], 0), gableColor);
    } else {
      const r0 = { x: cx, y: y0 };
      const r1 = { x: cx, y: y1 };
      tileB.quad(P(corners[3], 0), P(r1, rise), P(r0, rise), P(corners[0], 0), color);
      tileB.quad(P(corners[1], 0), P(r0, rise), P(r1, rise), P(corners[2], 0), color);
      bucket.tri(P(corners[0], 0), P(r0, rise), P(corners[1], 0), gableColor);
      bucket.tri(P(corners[2], 0), P(r1, rise), P(corners[3], 0), gableColor);
    }
    return;
  }
  // Hip roof: the ridge runs along the longer side, inset by half the shorter side.
  const w = x1 - x0;
  const d = y1 - y0;
  if (w >= d) {
    const r0 = { x: x0 + d / 2, y: cy };
    const r1 = { x: x1 - d / 2, y: cy };
    tileB.quad(P(corners[0], 0), P(r0, rise), P(r1, rise), P(corners[1], 0), color);
    tileB.quad(P(corners[2], 0), P(r1, rise), P(r0, rise), P(corners[3], 0), color);
    tileB.tri(P(corners[3], 0), P(r0, rise), P(corners[0], 0), color);
    tileB.tri(P(corners[1], 0), P(r1, rise), P(corners[2], 0), color);
  } else {
    const r0 = { x: cx, y: y0 + w / 2 };
    const r1 = { x: cx, y: y1 - w / 2 };
    tileB.quad(P(corners[3], 0), P(r1, rise), P(r0, rise), P(corners[0], 0), color);
    tileB.quad(P(corners[1], 0), P(r0, rise), P(r1, rise), P(corners[2], 0), color);
    tileB.tri(P(corners[0], 0), P(r0, rise), P(corners[1], 0), color);
    tileB.tri(P(corners[2], 0), P(r1, rise), P(corners[3], 0), color);
  }
}

function buildGround(
  buckets: Buckets,
  project: Project,
  plinth: number,
  extents: Vec2[],
  withLand: boolean,
): void {
  const plot = project.site.plot;
  const b = extents.length ? bbox(extents) : { minX: -5000, minY: -5000, maxX: 5000, maxY: 5000 };
  const reach = 60000;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const ground = -plinth;
  const land = [
    { x: cx - reach, y: cy - reach },
    { x: cx + reach, y: cy - reach },
    { x: cx + reach, y: cy + reach },
    { x: cx - reach, y: cy + reach },
  ];
  if (withLand) flat(buckets.get('grass'), land, [], ground - 10, colorOf('#7fa861'));
  if (plot.length >= 3) flat(buckets.get('stone'), plot, [], ground, colorOf('#c9c2ad'));
}

export interface WalkSegment {
  a: Vec2;
  b: Vec2;
}

export interface WalkFloor {
  floorIndex: number;
  floorId: string;
  /** Doors, which block the way only while shut. */
  doors: (WalkSegment & { id: string })[];
  /** Furniture that is too low to duck under and too big to walk through. */
  furniture: WalkSegment[];
  /** Finished floor level in metres. */
  level: number;
  top: number;
  /** Wall stretches that block walking. Doors are gaps. */
  segments: WalkSegment[];
  /** Plan areas where this floor can be stood on. */
  shape: PolygonWithHoles[];
}

export interface BuiltHouse {
  buckets: [BucketKey, MeshBucket][];
  movables: MovablePart[];
  /** Where the Explore page starts: a few metres in front of the house, looking at it. */
  explore: { x: number; z: number; yaw: number; fromDoor: boolean; door: { x: number; z: number } };
  walk: WalkFloor[];
  triangles: number;
  /** Bounds in metres, used to frame the camera. */
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  /** Good place to start walking: just inside the main entrance when one is marked. */
  start: { x: number; z: number; floorIndex: number; yaw: number };
}

export interface BuildOptions {
  /** Highest floor index drawn; used for the cutaway view. */
  topFloor?: number;
  doorsOpen?: boolean;
  /** Leave out the roof, to look into the top storey from outside. */
  hideRoof?: boolean;
  /** Build door and window leaves as separate moving parts, shut, for the walking game. */
  movable?: boolean;
  /** The caller draws its own land, so only the plot surface is added here. */
  noLand?: boolean;
  /** Only the items themselves: no slab, ceiling, plinth or ground. For catalogue pictures. */
  bare?: boolean;
}

/** Turns a project into merged geometry plus the data the walking controls need. Pure and synchronous. */
export function buildHouse(project: Project, options: BuildOptions = {}): BuiltHouse {
  const buckets = new Buckets();
  const doorsOpen = options.doorsOpen ?? true;
  const plinth = project.site.groundLevelOffset;
  const floors = project.floors.filter((f) => f.visible);
  const top = Math.min(options.topFloor ?? floors.length - 1, floors.length - 1);
  const walk: WalkFloor[] = [];
  const movables: MovablePart[] = [];
  const allPts: Vec2[] = [];
  const graphs = floors.map((f) => buildWallGraph(f.walls));

  floors.forEach((floor, i) => {
    const graph = graphs[i];
    const hideAbove = i > top;
    const base = floor.elevation;
    allPts.push(...graph.nodes);
    if (!hideAbove) {
      if (!options.bare) {
        buildSlabs(
          buckets,
          floor,
          floors[i - 1] ?? null,
          graph,
          graphs[i - 1] ?? null,
          base,
          plinth,
          project.elevationOverrides.accentColor,
        );
        buildCeilings(buckets, floor, base);
      }
      buildWalls(buckets, floor, graph, base, project, doorsOpen, options.movable ? movables : undefined);
      if (!floor.hiddenCategories.includes('stairs')) buildStairs(buckets, floor, base);
      if (!floor.hiddenCategories.includes('pillars')) buildPillarsAndBeams(buckets, floor, base);
      if (!floor.hiddenCategories.includes('objects')) buildObjects(buckets, floor, base);
      if (!floor.hiddenCategories.includes('plants')) buildPlants(buckets, floor, base);
    }
    const byId = new Map(floor.walls.map((w) => [w.id, w]));
    const segments: WalkSegment[] = [];
    // A compound wall drawn with no gate would lock the visitor out, so until it has one it does not block.
    const hasGate = floor.openings.some((o) => o.kind === 'door' && byId.get(o.wallId)?.type === 'compound');
    for (const e of graph.edges) {
      const wall = byId.get(e.wallId);
      if (!wall || wall.hidden || (wall.type === 'compound' && !hasGate)) continue;
      const a = graph.nodes[e.a];
      const b = graph.nodes[e.b];
      const length = dist(a, b);
      const dir = norm(sub(b, a));
      const point = (t: number): Vec2 => ({ x: a.x + dir.x * t, y: a.y + dir.y * t });
      const openings = floor.openings.filter(
        (o) => o.wallId === wall.id && o.kind === 'door' && o.sillHeight < 200,
      );
      for (const span of edgeSpans(e, openings, length)) {
        if (span.opening) continue;
        const t0 = Math.max(0, span.t0);
        const t1 = Math.min(length, span.t1);
        if (t1 > t0 + 1) segments.push({ a: point(t0), b: point(t1) });
      }
    }
    const doorSegments: WalkFloor['doors'] = [];
    for (const o of floor.openings) {
      const wall = byId.get(o.wallId);
      const style = openingTypeById.get(o.catalogId)?.style;
      if (!wall || o.kind !== 'door' || o.sillHeight >= 200 || style === 'arch') continue;
      const m = pointOnWall(wall, o.position);
      doorSegments.push({
        id: o.id,
        a: { x: m.point.x - (m.dir.x * o.width) / 2, y: m.point.y - (m.dir.y * o.width) / 2 },
        b: { x: m.point.x + (m.dir.x * o.width) / 2, y: m.point.y + (m.dir.y * o.width) / 2 },
      });
    }
    const furniture: WalkSegment[] = [];
    for (const it of floor.objects) {
      const t = it.transform;
      if (it.hidden || t.z > 500 || it.height < 350) continue;
      const hw = (it.width * t.scaleX) / 2;
      const hd = (it.depth * t.scaleY) / 2;
      const c = [
        { x: -hw, y: -hd },
        { x: hw, y: -hd },
        { x: hw, y: hd },
        { x: -hw, y: hd },
      ].map((p) => {
        const r = rotate(p, t.rotation);
        return { x: t.x + r.x, y: t.y + r.y };
      });
      c.forEach((p, k) => furniture.push({ a: p, b: c[(k + 1) % 4] }));
    }
    walk.push({
      floorIndex: i,
      floorId: floor.id,
      doors: doorSegments,
      furniture,
      level: base * M,
      top: (base + floor.floorToFloor) * M,
      segments,
      shape: floorFootprint(graph, floor.rooms),
    });
  });

  if (!options.hideRoof && !options.bare && top === floors.length - 1 && floors.length) {
    buildRoof(buckets, project, floors[floors.length - 1], graphs[floors.length - 1]);
    activeTag = null;
  }
  // Looking only at a basement, the ground would hide it.
  if (!options.bare && (floors[top]?.levelIndex ?? 0) >= 0)
    buildGround(buckets, project, plinth, allPts, !options.noLand);

  // Bounds from the house itself, not the far-reaching ground.
  const box = allPts.length ? bbox(allPts) : { minX: -3000, minY: -3000, maxX: 3000, maxY: 3000 };
  const highest = floors.reduce((m, f) => Math.max(m, f.elevation + f.floorToFloor), 3000);

  let start = {
    x: ((box.minX + box.maxX) / 2) * M,
    z: ((box.minY + box.maxY) / 2) * M,
    floorIndex: 0,
    yaw: 0,
  };
  for (const [i, f] of floors.entries()) {
    const main = f.openings.find((o) => o.isMainEntrance);
    const wall = main && f.walls.find((w) => w.id === main.wallId);
    if (main && wall) {
      const { point, dir } = pointOnWall(wall, main.position);
      const n = leftNormal(dir);
      const c = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
      const inward = (c.x - point.x) * n.x + (c.y - point.y) * n.y > 0 ? n : { x: -n.x, y: -n.y };
      start = {
        x: (point.x + inward.x * 900) * M,
        z: (point.y + inward.y * 900) * M,
        floorIndex: i,
        yaw: Math.atan2(-inward.x, -inward.y),
      };
      break;
    }
  }

  // Explore starts in front of the front door, or on the road side when no door is marked.
  const centerX = (box.minX + box.maxX) / 2;
  const centerY = (box.minY + box.maxY) / 2;
  let outX = 0;
  let outY = 1;
  let originX = centerX;
  let originY = centerY;
  const front = floors.flatMap((f) => f.openings.filter((o) => o.isMainEntrance).map((o) => ({ o, f })))[0];
  const frontWall = front?.f.walls.find((w) => w.id === front.o.wallId);
  if (front && frontWall) {
    const { point, dir } = pointOnWall(frontWall, front.o.position);
    const n = leftNormal(dir);
    const away = (point.x - centerX) * n.x + (point.y - centerY) * n.y > 0 ? 1 : -1;
    outX = n.x * away;
    outY = n.y * away;
    originX = point.x;
    originY = point.y;
    if (!options.bare && plinth > 100) {
      // Steps up to the front door.
      const steps = Math.max(1, Math.round(plinth / 150));
      const stepBucketColor = colorOf('#b8b3a6');
      const along = (o: number, a: number, across: number): Vec2 => ({
        x: point.x + dir.x * o + outX * (across + a),
        y: point.y + dir.y * o + outY * (across + a),
      });
      const halfW = front.o.width / 2 + 350;
      const startAt = frontWall.thickness / 2;
      for (let s = 0; s < steps; s++) {
        const depth = 300 * (steps - s);
        const shape = [
          along(-halfW, 0, startAt),
          along(halfW, 0, startAt),
          along(halfW, depth, startAt),
          along(-halfW, depth, startAt),
        ];
        const z0 = -plinth + (s * plinth) / steps;
        prism(buckets, shape, z0, z0 + plinth / steps, () => ({ color: stepBucketColor, bucket: 'stone' }), {
          color: stepBucketColor,
          bucket: 'stone',
        });
      }
    }
  } else if (project.site.roadSide !== 'none') {
    const angle =
      (project.settings.northAngleDeg * Math.PI) / 180 +
      ({ N: 0, E: Math.PI / 2, S: Math.PI, W: -Math.PI / 2 } as const)[project.site.roadSide];
    outX = Math.sin(angle);
    outY = -Math.cos(angle);
  }
  // A few steps out from the front door, so the walk starts at the house, not across a field.
  const halfDepth = front && frontWall ? 0 : (Math.abs(outX) * (box.maxX - box.minX) + Math.abs(outY) * (box.maxY - box.minY)) / 2;
  const out = halfDepth + EXPLORE_START_MM + (front && frontWall ? Math.max(0, plinth / 150) * 300 : 0);
  const explore = {
    x: (originX + outX * out) * M,
    z: (originY + outY * out) * M,
    yaw: Math.atan2(outX, outY),
    fromDoor: Boolean(front && frontWall),
    /** Two metres out from the front door, close enough to open it, facing it. */
    door: {
      x: (originX + outX * (front && frontWall ? 2000 : out - EXPLORE_START_MM + 2000)) * M,
      z: (originY + outY * (front && frontWall ? 2000 : out - EXPLORE_START_MM + 2000)) * M,
    },
  };

  const list = buckets.entries();
  return {
    buckets: list,
    movables,
    explore,
    walk,
    triangles: list.reduce((s, [, b]) => s + b.triangles, 0),
    bounds: {
      minX: box.minX * M,
      minY: -plinth * M,
      minZ: box.minY * M,
      maxX: box.maxX * M,
      maxY: highest * M,
      maxZ: box.maxY * M,
    },
    start,
  };
}
