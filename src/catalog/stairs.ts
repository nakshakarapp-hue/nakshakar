import type { Stair, Vec2 } from '../core/model/types';
import { pointInPolygon } from '../core/geometry/polygon';
import { rotate } from '../core/geometry/vec';

export interface StairStep {
  polygon: Vec2[];
  /** Top of this step, measured from the floor the stair starts on. */
  z: number;
  landing: boolean;
}

export interface StairLayout {
  steps: StairStep[];
  /** Bounding outline, which also becomes the void in the slab above. */
  outline: Vec2[];
  risers: number;
  actualRiser: number;
  /** Clearest path up the stair, for 2D direction arrows. */
  path: Vec2[];
  /** Hand rails along the open edges: each a line of plan points with the height of the step below. */
  rails: RailPoint[][];
  /** The column at the middle of a spiral. */
  pole?: Vec2;
}

export interface RailPoint extends Vec2 {
  z: number;
}

const rect = (x: number, y: number, w: number, d: number): Vec2[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + d },
  { x, y: y + d },
];

/** Gap between the two flights of a U stair. */
const WELL = 100;

/** Distance of a rail in from the edge of the stair. */
const EDGE = 35;

function localLayout(s: Stair): Omit<StairLayout, 'outline'> & { outline: Vec2[] } {
  const risers = Math.max(2, Math.round(s.totalRise / Math.max(50, s.riser)));
  const rise = s.totalRise / risers;
  const W = s.width;
  const T = s.tread;
  const steps: StairStep[] = [];
  let path: Vec2[] = [];
  let outline: Vec2[];
  let rails: RailPoint[][] = [];
  let pole: Vec2 | undefined;

  switch (s.shape) {
    case 'straight': {
      for (let i = 0; i < risers; i++)
        steps.push({ polygon: rect(0, -(i + 1) * T, W, T), z: (i + 1) * rise, landing: false });
      outline = rect(0, -risers * T, W, risers * T);
      path = [
        { x: W / 2, y: 0 },
        { x: W / 2, y: -risers * T },
      ];
      rails = [EDGE, W - EDGE].map((x) => [
        { x, y: 0, z: 0 },
        { x, y: -risers * T, z: risers * rise },
      ]);
      break;
    }
    case 'l': {
      const n1 = Math.floor((risers - 1) / 2);
      const n2 = risers - 1 - n1;
      const dir = s.turnLeft ? -1 : 1;
      for (let i = 0; i < n1; i++)
        steps.push({ polygon: rect(0, -(i + 1) * T, W, T), z: (i + 1) * rise, landing: false });
      const top = -n1 * T;
      steps.push({ polygon: rect(0, top - W, W, W), z: (n1 + 1) * rise, landing: true });
      for (let i = 0; i < n2; i++) {
        const x = dir > 0 ? W + i * T : -(i + 1) * T;
        steps.push({ polygon: rect(x, top - W, T, W), z: (n1 + 2 + i) * rise, landing: false });
      }
      const minX = dir > 0 ? 0 : -n2 * T;
      const spanX = W + n2 * T;
      outline = rect(minX, top - W, spanX, n1 * T + W);
      path = [
        { x: W / 2, y: 0 },
        { x: W / 2, y: top - W / 2 },
        { x: dir > 0 ? W + n2 * T : -n2 * T, y: top - W / 2 },
      ];
      {
        // Written for a right turn; a left turn is the same mirrored about the middle of the first flight.
        const side = (x: number) => (dir > 0 ? x : W - x);
        const zLanding = (n1 + 1) * rise;
        rails = [
          [
            { x: side(EDGE), y: 0, z: 0 },
            { x: side(EDGE), y: top, z: n1 * rise },
            { x: side(EDGE), y: top - W + EDGE, z: zLanding },
            { x: side(W), y: top - W + EDGE, z: zLanding },
            { x: side(W + n2 * T), y: top - W + EDGE, z: risers * rise },
          ],
          [
            { x: side(W - EDGE), y: 0, z: 0 },
            { x: side(W - EDGE), y: top, z: n1 * rise },
          ],
          [
            { x: side(W), y: top - EDGE, z: zLanding },
            { x: side(W + n2 * T), y: top - EDGE, z: risers * rise },
          ],
        ];
      }
      break;
    }
    case 'u': {
      const n1 = Math.floor((risers - 1) / 2);
      const n2 = risers - 1 - n1;
      const dir = s.turnLeft ? -1 : 1;
      const secondX = dir > 0 ? W + WELL : -(W + WELL);
      for (let i = 0; i < n1; i++)
        steps.push({ polygon: rect(0, -(i + 1) * T, W, T), z: (i + 1) * rise, landing: false });
      const top = -n1 * T;
      const landingX = dir > 0 ? 0 : secondX;
      steps.push({ polygon: rect(landingX, top - W, 2 * W + WELL, W), z: (n1 + 1) * rise, landing: true });
      for (let i = 0; i < n2; i++) {
        steps.push({ polygon: rect(secondX, top + i * T, W, T), z: (n1 + 2 + i) * rise, landing: false });
      }
      const flight = Math.max(n1, n2) * T;
      outline = rect(landingX, top - W, 2 * W + WELL, flight + W);
      path = [
        { x: W / 2, y: 0 },
        { x: W / 2, y: top - W / 2 },
        { x: secondX + W / 2, y: top - W / 2 },
        { x: secondX + W / 2, y: top + n2 * T },
      ];
      {
        const side = (x: number) => (dir > 0 ? x : W - x);
        const far = 2 * W + WELL - EDGE;
        const zLanding = (n1 + 1) * rise;
        rails = [
          [
            { x: side(EDGE), y: 0, z: 0 },
            { x: side(EDGE), y: top, z: n1 * rise },
            { x: side(EDGE), y: top - W + EDGE, z: zLanding },
            { x: side(far), y: top - W + EDGE, z: zLanding },
            { x: side(far), y: top, z: zLanding },
            { x: side(far), y: top + n2 * T, z: risers * rise },
          ],
          [
            { x: side(W - EDGE), y: 0, z: 0 },
            { x: side(W - EDGE), y: top, z: n1 * rise },
          ],
          [
            { x: side(W + WELL + EDGE), y: top, z: zLanding },
            { x: side(W + WELL + EDGE), y: top + n2 * T, z: risers * rise },
          ],
        ];
      }
      break;
    }
    case 'spiral': {
      const outer = W + 100;
      const inner = 100;
      const stepDeg = Math.max(20, Math.min(30, 300 / risers)) * (s.turnLeft ? -1 : 1);
      const rail: RailPoint[] = [];
      for (let i = 0; i < risers; i++) {
        const a0 = (i * stepDeg * Math.PI) / 180;
        const a1 = ((i + 1) * stepDeg * Math.PI) / 180;
        const polygon: Vec2[] = [
          { x: inner * Math.cos(a0), y: inner * Math.sin(a0) },
          { x: outer * Math.cos(a0), y: outer * Math.sin(a0) },
          { x: outer * Math.cos((a0 + a1) / 2), y: outer * Math.sin((a0 + a1) / 2) },
          { x: outer * Math.cos(a1), y: outer * Math.sin(a1) },
          { x: inner * Math.cos(a1), y: inner * Math.sin(a1) },
        ];
        steps.push({ polygon, z: (i + 1) * rise, landing: false });
        path.push({
          x: ((inner + outer) / 2) * Math.cos((a0 + a1) / 2),
          y: ((inner + outer) / 2) * Math.sin((a0 + a1) / 2),
        });
        if (i === 0) rail.push({ x: (outer - EDGE) * Math.cos(a0), y: (outer - EDGE) * Math.sin(a0), z: 0 });
        rail.push({ x: (outer - EDGE) * Math.cos(a1), y: (outer - EDGE) * Math.sin(a1), z: (i + 1) * rise });
      }
      rails = [rail];
      pole = { x: 0, y: 0 };
      outline = rect(-outer, -outer, 2 * outer, 2 * outer);
      break;
    }
  }
  return { steps, outline, risers, actualRiser: rise, path, rails, pole };
}

/** Steps and outline of a stair in plan coordinates, with its transform applied. */
export function stairLayout(s: Stair): StairLayout {
  const local = localLayout(s);
  const t = s.transform;
  const place = (p: Vec2): Vec2 => {
    const r = rotate(p, t.rotation);
    return { x: t.x + r.x, y: t.y + r.y };
  };
  return {
    risers: local.risers,
    actualRiser: local.actualRiser,
    outline: local.outline.map(place),
    path: local.path.map(place),
    steps: local.steps.map((st) => ({ ...st, polygon: st.polygon.map(place) })),
    rails: local.rails.map((rail) => rail.map((p) => ({ ...place(p), z: p.z }))),
    pole: local.pole ? place(local.pole) : undefined,
  };
}

/** Walking height on a stair at a plan point, or null when the point is not on it. */
export function stairHeightAt(s: Stair, p: Vec2): number | null {
  const layout = stairLayout(s);
  for (const step of layout.steps) if (pointInPolygon(p, step.polygon)) return step.z;
  return pointInPolygon(p, layout.outline) ? 0 : null;
}

/**
 * Comfort check using the common 2R + T rule of thumb (550 to 700 mm). The value is reported so the
 * mestri can see it, not enforced: local rules decide the real limits.
 */
export function stairComfort(s: Stair): {
  value: number;
  comfortable: boolean;
  risers: number;
  actualRiser: number;
} {
  const { risers, actualRiser } = stairLayout(s);
  const value = 2 * actualRiser + s.tread;
  return { value, comfortable: value >= 550 && value <= 700, risers, actualRiser };
}
