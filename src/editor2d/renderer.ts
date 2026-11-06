import type { Vec2 } from '../core/model/types';
import { textBox, visibleTexts, type Prim } from './drawing';

/** Canvas fonts cannot use CSS variables, so the family is spelt out. */
export const CANVAS_FONT =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans Devanagari', 'Noto Sans Telugu', sans-serif";

export interface View {
  /** Plan point at the centre of the canvas. */
  cx: number;
  cy: number;
  /** Pixels per millimetre. */
  zoom: number;
  w: number;
  h: number;
  /** How far the plan is turned on screen, clockwise, in radians. Two fingers turn it. */
  rot?: number;
}

export const toScreen = (v: View, p: Vec2): Vec2 => {
  const dx = (p.x - v.cx) * v.zoom;
  const dy = (p.y - v.cy) * v.zoom;
  if (!v.rot) return { x: dx + v.w / 2, y: dy + v.h / 2 };
  const c = Math.cos(v.rot);
  const s = Math.sin(v.rot);
  return { x: dx * c - dy * s + v.w / 2, y: dx * s + dy * c + v.h / 2 };
};

export const toWorld = (v: View, p: Vec2): Vec2 => {
  const sx = p.x - v.w / 2;
  const sy = p.y - v.h / 2;
  if (!v.rot) return { x: sx / v.zoom + v.cx, y: sy / v.zoom + v.cy };
  const c = Math.cos(v.rot);
  const s = Math.sin(v.rot);
  return { x: (sx * c + sy * s) / v.zoom + v.cx, y: (-sx * s + sy * c) / v.zoom + v.cy };
};

/** Moves the plan by a distance on screen, whichever way it is turned. */
export function panBy(v: View, dx: number, dy: number): View {
  const c = Math.cos(v.rot ?? 0);
  const s = Math.sin(v.rot ?? 0);
  return { ...v, cx: v.cx - (dx * c + dy * s) / v.zoom, cy: v.cy - (-dx * s + dy * c) / v.zoom };
}

/** Places the view so that a plan point sits under a screen point. */
export function pinAt(v: View, world: Vec2, screen: Vec2): View {
  const now = toWorld(v, screen);
  return { ...v, cx: v.cx + world.x - now.x, cy: v.cy + world.y - now.y };
}

/** The four corners of the screen on the plan. */
export const screenCorners = (v: View): Vec2[] =>
  [
    { x: 0, y: 0 },
    { x: v.w, y: 0 },
    { x: v.w, y: v.h },
    { x: 0, y: v.h },
  ].map((p) => toWorld(v, p));

/** Zooms about a screen point, so that what is under the fingers stays there. */
export function zoomAt(v: View, screen: Vec2, factor: number): View {
  const zoom = Math.max(0.004, Math.min(2.5, v.zoom * factor));
  const before = toWorld(v, screen);
  const next = { ...v, zoom };
  const after = toWorld(next, screen);
  return { ...next, cx: v.cx + before.x - after.x, cy: v.cy + before.y - after.y };
}

const widths = new Map<string, number>();

/** Real text width, cached because labels are checked on every frame. */
function measuredWidth(ctx: CanvasRenderingContext2D, text: string, size: number, bold: boolean): number {
  const key = `${size}|${bold ? 1 : 0}|${text}`;
  const known = widths.get(key);
  if (known !== undefined) return known;
  ctx.font = `${bold ? '600 ' : ''}${size}px ${CANVAS_FONT}`;
  const width = ctx.measureText(text).width;
  if (widths.size > 3000) widths.clear();
  widths.set(key, width);
  return width;
}

/** Draws primitives on a canvas. Line widths and text keep a constant size at any zoom. */
export function drawPrims(ctx: CanvasRenderingContext2D, v: View, prims: Prim[]): void {
  const c = Math.cos(v.rot ?? 0);
  const sn = Math.sin(v.rot ?? 0);
  const px = (p: Vec2) => ((p.x - v.cx) * c - (p.y - v.cy) * sn) * v.zoom + v.w / 2;
  const py = (p: Vec2) => ((p.x - v.cx) * sn + (p.y - v.cy) * c) * v.zoom + v.h / 2;
  const turnDeg = ((v.rot ?? 0) * 180) / Math.PI;
  /** Text follows the plan round, but never ends up upside down. */
  const upright = (deg: number) => {
    let a = (((deg + turnDeg) % 360) + 360) % 360;
    if (a > 90 && a <= 270) a -= 180;
    return a;
  };
  // Text is skipped once the plan is too small to read, which also keeps large plans smooth.
  const showText = v.zoom > 0.012;
  const shown = showText
    ? visibleTexts(prims, (p) => {
        const x = px(p.at);
        const y = py(p.at);
        if (x < -200 || y < -60 || x > v.w + 200 || y > v.h + 60) return null;
        const size = p.size * 1.25;
        return textBox(
          x,
          y,
          measuredWidth(ctx, p.s, size, !!p.bold) + 4,
          size * 1.2,
          p.align,
          p.angle ? upright(p.angle) : undefined,
        );
      })
    : null;
  for (const p of prims) {
    switch (p.t) {
      case 'poly': {
        if (!p.pts.length) break;
        ctx.beginPath();
        ctx.moveTo(px(p.pts[0]), py(p.pts[0]));
        for (let i = 1; i < p.pts.length; i++) ctx.lineTo(px(p.pts[i]), py(p.pts[i]));
        if (!p.open) ctx.closePath();
        if (p.fill) {
          ctx.fillStyle = p.fill;
          ctx.fill();
        }
        if (p.stroke) {
          ctx.strokeStyle = p.stroke;
          ctx.lineWidth = p.w ?? 1;
          ctx.setLineDash(p.dash ?? []);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        break;
      }
      case 'line': {
        ctx.beginPath();
        ctx.moveTo(px(p.a), py(p.a));
        ctx.lineTo(px(p.b), py(p.b));
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.w;
        ctx.setLineDash(p.dash ?? []);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case 'arc': {
        ctx.beginPath();
        ctx.arc(px(p.c), py(p.c), p.r * v.zoom, p.a0 + (v.rot ?? 0), p.a1 + (v.rot ?? 0), p.a1 < p.a0);
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.w;
        ctx.stroke();
        break;
      }
      case 'circle': {
        ctx.beginPath();
        ctx.arc(px(p.c), py(p.c), Math.max(0.5, p.r * v.zoom), 0, Math.PI * 2);
        if (p.fill) {
          ctx.fillStyle = p.fill;
          ctx.fill();
        }
        if (p.stroke) {
          ctx.strokeStyle = p.stroke;
          ctx.lineWidth = p.w ?? 1;
          ctx.stroke();
        }
        break;
      }
      case 'text': {
        if (!shown?.has(p)) break;
        const x = px(p.at);
        const y = py(p.at);
        ctx.save();
        ctx.translate(x, y);
        if (p.angle) ctx.rotate((upright(p.angle) * Math.PI) / 180);
        ctx.font = `${p.bold ? '600 ' : ''}${p.size * 1.25}px ${CANVAS_FONT}`;
        ctx.textAlign = p.align ?? 'left';
        ctx.textBaseline = 'middle';
        if (p.bg) {
          const m = ctx.measureText(p.s).width;
          ctx.fillStyle = p.bg;
          ctx.fillRect(-m / 2 - 2, -p.size * 0.75, m + 4, p.size * 1.5);
        }
        ctx.fillStyle = p.color;
        ctx.fillText(p.s, 0, 0);
        ctx.restore();
        break;
      }
    }
  }
}

/** A ruler and grid step in plan millimetres that stays readable at this zoom. */
export function adaptiveStep(base: number, zoom: number, minPx: number): number {
  const factors = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  for (const f of factors) if (base * f * zoom >= minPx) return base * f;
  return base * 1000;
}

const IMPERIAL = new Set(['ft', 'ftin', 'in', 'yd', 'gaj', 'hath']);

/** Grid spacing: major at 1 m or 5 ft, minor at 10 cm or 6 in, thinned out as the plan zooms away. */
export function gridSteps(unit: string, zoom: number): { minor: number; major: number } {
  const imperial = IMPERIAL.has(unit);
  const minorBase = imperial ? 152.4 : 100;
  const majorBase = imperial ? 1524 : 1000;
  return { minor: adaptiveStep(minorBase, zoom, 9), major: adaptiveStep(majorBase, zoom, 42) };
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  v: View,
  unit: string,
  minorColor: string,
  majorColor: string,
): void {
  const { minor, major } = gridSteps(unit, v.zoom);
  if (v.rot) {
    const corners = screenCorners(v);
    const x0 = Math.min(...corners.map((p) => p.x));
    const x1 = Math.max(...corners.map((p) => p.x));
    const y0 = Math.min(...corners.map((p) => p.y));
    const y1 = Math.max(...corners.map((p) => p.y));
    const turned = (step: number, color: string) => {
      ctx.beginPath();
      for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
        const a = toScreen(v, { x, y: y0 });
        const b = toScreen(v, { x, y: y1 });
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
        const a = toScreen(v, { x: x0, y });
        const b = toScreen(v, { x: x1, y });
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    if (minor !== major) turned(minor, minorColor);
    turned(major, majorColor);
    return;
  }
  const tl = toWorld(v, { x: 0, y: 0 });
  const br = toWorld(v, { x: v.w, y: v.h });
  const stroke = (step: number, color: string) => {
    ctx.beginPath();
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
      const s = Math.round((x - v.cx) * v.zoom + v.w / 2) + 0.5;
      ctx.moveTo(s, 0);
      ctx.lineTo(s, v.h);
    }
    for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) {
      const s = Math.round((y - v.cy) * v.zoom + v.h / 2) + 0.5;
      ctx.moveTo(0, s);
      ctx.lineTo(v.w, s);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  if (minor !== major) stroke(minor, minorColor);
  stroke(major, majorColor);
}

export function drawRulers(
  ctx: CanvasRenderingContext2D,
  v: View,
  unit: string,
  label: (mm: number) => string,
  colors: { bg: string; ink: string },
): void {
  const size = 20;
  const { major } = gridSteps(unit, v.zoom);
  const step = adaptiveStep(major, v.zoom, 70);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, v.w, size);
  ctx.fillRect(0, 0, size, v.h);
  ctx.fillStyle = colors.ink;
  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = 1;
  ctx.font = `10px ${CANVAS_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const tl = toWorld(v, { x: 0, y: 0 });
  const br = toWorld(v, { x: v.w, y: v.h });
  ctx.beginPath();
  for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
    const s = Math.round((x - v.cx) * v.zoom + v.w / 2) + 0.5;
    if (s < size) continue;
    ctx.moveTo(s, 10);
    ctx.lineTo(s, size);
    ctx.fillText(label(x), s + 3, 8);
  }
  for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) {
    const s = Math.round((y - v.cy) * v.zoom + v.h / 2) + 0.5;
    if (s < size) continue;
    ctx.moveTo(10, s);
    ctx.lineTo(size, s);
    ctx.save();
    ctx.translate(8, s - 3);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(label(y), 0, 0);
    ctx.restore();
  }
  ctx.stroke();
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, size, size);
}

export function drawCompass(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  northDeg: number,
  colors: { ink: string; bg: string },
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = colors.bg;
  ctx.fill();
  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.rotate((northDeg * Math.PI) / 180);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const len = i % 2 === 0 ? r * 0.72 : r * 0.42;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.sin(a) * len, -Math.cos(a) * len);
    ctx.strokeStyle = colors.ink;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.95);
  ctx.lineTo(r * 0.3, -r * 0.12);
  ctx.lineTo(-r * 0.3, -r * 0.12);
  ctx.closePath();
  ctx.fillStyle = '#c0392b';
  ctx.fill();
  // The letter sits in the red pointer, so it can only be read as the north end.
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(r * 0.34)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', 0, -r * 0.38);
  ctx.restore();
}

export function drawMiniMap(
  ctx: CanvasRenderingContext2D,
  v: View,
  walls: { start: Vec2; end: Vec2 }[],
  rect: { x: number; y: number; w: number; h: number },
  colors: { bg: string; ink: string; accent: string },
): void {
  if (!walls.length) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const w of walls) {
    for (const q of [w.start, w.end]) {
      minX = Math.min(minX, q.x);
      minY = Math.min(minY, q.y);
      maxX = Math.max(maxX, q.x);
      maxY = Math.max(maxY, q.y);
    }
  }
  const pad = 1000;
  const k = Math.min(rect.w / (maxX - minX + 2 * pad), rect.h / (maxY - minY + 2 * pad));
  const mapX = (x: number) => rect.x + (x - minX + pad) * k;
  const mapY = (y: number) => rect.y + (y - minY + pad) * k;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = colors.bg;
  ctx.fill();
  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.clip();
  ctx.beginPath();
  for (const w of walls) {
    ctx.moveTo(mapX(w.start.x), mapY(w.start.y));
    ctx.lineTo(mapX(w.end.x), mapY(w.end.y));
  }
  ctx.stroke();
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  screenCorners(v).forEach((p, i) => (i ? ctx.lineTo(mapX(p.x), mapY(p.y)) : ctx.moveTo(mapX(p.x), mapY(p.y))));
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}
