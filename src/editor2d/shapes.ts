import type { Vec2 } from '../core/model/types';
import { polygonArea, signedArea, offsetPolygon } from '../core/geometry/polygon';
import { add, dist, fromAngle } from '../core/geometry/vec';

export type RoomShape =
  'rectangle' | 'l' | 'u' | 't' | 'plus' | 'bay' | 'trapezium' | 'hexagon' | 'octagon' | 'circle' | 'ngon';

export const ROOM_SHAPES: RoomShape[] = [
  'rectangle',
  'l',
  'u',
  't',
  'plus',
  'bay',
  'trapezium',
  'hexagon',
  'octagon',
  'circle',
  'ngon',
];

export interface ShapeParams {
  length: number;
  breadth: number;
  /** Number of sides for 'ngon'. */
  sides?: number;
  /** Side length for 'ngon'; when absent the shape fits the length. */
  sideLength?: number;
}

/** A regular polygon with flat top, centred on the origin. */
function regular(sides: number, sideLength: number): Vec2[] {
  const radius = sideLength / (2 * Math.sin(Math.PI / sides));
  const offset = -90 - 180 / sides;
  return Array.from({ length: sides }, (_, i) => fromAngle(offset + (i * 360) / sides, radius));
}

/** Outline of a room wizard shape, clockwise on screen, with the bounding box's top-left at the origin. */
export function shapeOutline(
  shape: RoomShape,
  { length: l, breadth: b, sides, sideLength }: ShapeParams,
): Vec2[] {
  const P = (x: number, y: number): Vec2 => ({ x, y });
  switch (shape) {
    case 'rectangle':
      return [P(0, 0), P(l, 0), P(l, b), P(0, b)];
    case 'l':
      return [P(0, 0), P(l, 0), P(l, b / 2), P(l / 2, b / 2), P(l / 2, b), P(0, b)];
    case 'u':
      return [
        P(0, 0),
        P(l / 3, 0),
        P(l / 3, b / 2),
        P((2 * l) / 3, b / 2),
        P((2 * l) / 3, 0),
        P(l, 0),
        P(l, b),
        P(0, b),
      ];
    case 't':
      return [
        P(0, 0),
        P(l, 0),
        P(l, b / 3),
        P((2 * l) / 3, b / 3),
        P((2 * l) / 3, b),
        P(l / 3, b),
        P(l / 3, b / 3),
        P(0, b / 3),
      ];
    case 'plus':
      return [
        P(l / 3, 0),
        P((2 * l) / 3, 0),
        P((2 * l) / 3, b / 3),
        P(l, b / 3),
        P(l, (2 * b) / 3),
        P((2 * l) / 3, (2 * b) / 3),
        P((2 * l) / 3, b),
        P(l / 3, b),
        P(l / 3, (2 * b) / 3),
        P(0, (2 * b) / 3),
        P(0, b / 3),
        P(l / 3, b / 3),
      ];
    case 'bay':
      // A rectangle with a splayed bay window projecting from its top side.
      return [
        P(0, b / 4),
        P(l / 4, b / 4),
        P((7 * l) / 20, 0),
        P((13 * l) / 20, 0),
        P((3 * l) / 4, b / 4),
        P(l, b / 4),
        P(l, b),
        P(0, b),
      ];
    case 'trapezium':
      return [P(l / 4, 0), P((3 * l) / 4, 0), P(l, b), P(0, b)];
    case 'hexagon':
    case 'octagon':
    case 'ngon': {
      const n = shape === 'hexagon' ? 6 : shape === 'octagon' ? 8 : Math.max(3, Math.round(sides ?? 5));
      const side = shape === 'ngon' && sideLength ? sideLength : 2 * (l / 2) * Math.sin(Math.PI / n);
      const pts = regular(n, side);
      const minX = Math.min(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y));
      return pts.map((p) => P(p.x - minX, p.y - minY));
    }
    case 'circle':
      // Two semicircular arcs are built from these two points by the caller.
      return [P(0, l / 2), P(l, l / 2)];
  }
}

export interface PerimeterRow {
  length: number;
  /** Interior turn: degrees clockwise on screen from the previous side; ignored on the first row. */
  turn: number;
  thickness: number;
  height: number;
}

export interface PerimeterResult {
  /** One point per corner, starting at the origin; includes the end of the last side. */
  points: Vec2[];
  /** Distance left between the end of the last side and the start. */
  closingError: number;
  closes: boolean;
}

/** Walks a table of sides and turns, reporting how far the loop misses closing. */
export function walkPerimeter(
  rows: PerimeterRow[],
  startAngle = 0,
  start: Vec2 = { x: 0, y: 0 },
): PerimeterResult {
  const points: Vec2[] = [start];
  let heading = startAngle;
  rows.forEach((row, i) => {
    if (i > 0) heading += row.turn;
    points.push(add(points[points.length - 1], fromAngle(heading, row.length)));
  });
  const closingError = rows.length ? dist(points[points.length - 1], start) : 0;
  return { points, closingError, closes: rows.length >= 3 && closingError <= 5 };
}

/**
 * Builds a plot outline from its measured sides, assuming a right-angled corner at the start unless
 * angles are given. Four sides with no angles solve as the closest-fitting quadrilateral.
 */
export function plotFromSides(sides: number[], turns?: number[]): Vec2[] {
  if (sides.length === 4 && !turns) {
    const [top, right, bottom, left] = sides;
    // Anchor the top side and solve the far corner from the two remaining sides by circle intersection.
    const A = { x: 0, y: 0 };
    const B = { x: top, y: 0 };
    const Dguess = { x: 0, y: left };
    const dx = B.x - A.x;
    const span = Math.hypot(dx, left);
    const a = (right * right - bottom * bottom + span * span) / (2 * span);
    const h2 = right * right - a * a;
    if (h2 < 0) return [A, B, { x: top, y: right }, Dguess];
    const u = { x: (Dguess.x - B.x) / span, y: (Dguess.y - B.y) / span };
    const C = {
      x: B.x + a * u.x - Math.sqrt(h2) * u.y * -1,
      y: B.y + a * u.y + Math.sqrt(h2) * u.x * -1,
    };
    return [A, B, C, Dguess];
  }
  const rows = sides.map((length, i) => ({ length, turn: turns?.[i] ?? 90, thickness: 0, height: 0 }));
  return walkPerimeter(rows).points.slice(0, sides.length);
}

/** Insets a plot by setbacks, given per side in plot order, to give the buildable area. */
export function buildableArea(plot: Vec2[], setbacks: number[]): Vec2[] {
  const clockwise = signedArea(plot) > 0;
  const distances = plot.map((_, i) => (clockwise ? -1 : 1) * (setbacks[i % setbacks.length] ?? 0));
  const inset = offsetPolygon(plot, distances);
  return polygonArea(inset) > 1 ? inset : [];
}
