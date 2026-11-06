import type { jsPDF } from 'jspdf';
import { formatArea, formatIndian, formatLength } from '../core/units';
import type { Floor, Project, Vec2 } from '../core/model/types';
import { assessVastu } from '../vastu/rules';
import { estimateProject, type Range } from '../estimate/estimate';
import { formatMoney } from '../estimate/money';
import { wallLength } from '../core/geometry/wallGraph';
import {
  floorPrims,
  primBounds,
  textBox,
  visibleTexts,
  type DrawOptions,
  type Prim,
} from '../editor2d/drawing';

export type PaperSize = 'a4' | 'a3' | 'a2';
export type PaperScale = 'fit' | 50 | 75 | 100 | 150 | 200;

export interface PdfOptions {
  paper: PaperSize;
  orientation: 'landscape' | 'portrait';
  scale: PaperScale;
  includePlans: boolean;
  includeSchedule: boolean;
  includeVastu: boolean;
  includeEstimate: boolean;
  /** Translated section titles and labels. */
  label: (key: string, fallback?: string) => string;
  /** Translates sentences produced by the app, such as estimate notes. */
  text: (s: string) => string;
  template: (template: string, vars: Record<string, string>) => string;
}

const MARGIN = 10;
const MM_PER_PT = 25.4 / 72;
const hasNonLatin = (s: string) => /[\u0100-\u1FFF\u20A0-\uFFFF]/.test(s);

function hexRgb(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

/**
 * jsPDF cannot shape Indic scripts: Devanagari and Telugu come out with broken conjuncts and misplaced
 * vowel signs. Such text is therefore laid out by the browser's text engine, with the fonts bundled in
 * the app, and placed as a high-resolution image. All Latin text and all plan linework stay vector.
 */
function shapedTextImage(
  text: string,
  sizePt: number,
  color: string,
  bold: boolean,
): { data: string; widthMm: number; heightMm: number } | null {
  if (typeof document === 'undefined') return null;
  const px = sizePt * 4;
  const font = `${bold ? '600 ' : ''}${px}px "Noto Sans Devanagari", "Noto Sans Telugu", system-ui, sans-serif`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 8;
  const h = Math.ceil(px * 1.7);
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 4, h / 2);
  const toMm = (sizePt * MM_PER_PT) / px;
  return { data: canvas.toDataURL('image/png'), widthMm: w * toMm, heightMm: h * toMm };
}

/** Breaks Indic text at spaces to fit a width in millimetres, measured by the browser's text engine. */
function wrapShaped(text: string, widthMm: number, sizePt: number): string[] {
  if (typeof document === 'undefined') return [text];
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return [text];
  ctx.font = `${sizePt * 4}px "Noto Sans Devanagari", "Noto Sans Telugu", system-ui, sans-serif`;
  const toMm = (sizePt * MM_PER_PT) / (sizePt * 4);
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width * toMm > widthMm) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  sizePt: number,
  opts: { color?: string; align?: 'left' | 'center' | 'right'; bold?: boolean; angle?: number } = {},
) {
  const color = opts.color ?? '#111111';
  if (hasNonLatin(text)) {
    const img = shapedTextImage(text, sizePt, color, !!opts.bold);
    if (img) {
      const left =
        opts.align === 'center' ? x - img.widthMm / 2 : opts.align === 'right' ? x - img.widthMm : x;
      doc.addImage(img.data, 'PNG', left, y - img.heightMm / 2, img.widthMm, img.heightMm);
      return;
    }
  }
  doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
  doc.setFontSize(sizePt);
  doc.setTextColor(...hexRgb(color));
  doc.text(text, x, y, {
    align: opts.align ?? 'left',
    baseline: 'middle',
    angle: opts.angle ? -opts.angle : 0,
  });
}

/** Draws plan primitives as real PDF vectors. */
function drawPrimsToPdf(
  doc: jsPDF,
  prims: Prim[],
  X: (p: Vec2) => number,
  Y: (p: Vec2) => number,
  scale: number,
) {
  const LINE = MM_PER_PT;
  const polyline = (pts: Vec2[], style: string, closed: boolean) => {
    if (pts.length < 2) return;
    const deltas: [number, number][] = [];
    for (let i = 1; i < pts.length; i++) deltas.push([X(pts[i]) - X(pts[i - 1]), Y(pts[i]) - Y(pts[i - 1])]);
    doc.lines(deltas, X(pts[0]), Y(pts[0]), [1, 1], style, closed);
  };
  const shown = visibleTexts(prims, (p) => {
    const size = p.size * 0.85 * MM_PER_PT;
    return textBox(X(p.at), Y(p.at), p.s.length * size * 0.52 + 0.6, size * 1.2, p.align, p.angle);
  });
  for (const p of prims) {
    switch (p.t) {
      case 'poly': {
        if (p.fill) doc.setFillColor(...hexRgb(p.fill));
        if (p.stroke) {
          doc.setDrawColor(...hexRgb(p.stroke));
          doc.setLineWidth((p.w ?? 1) * LINE);
        }
        doc.setLineDashPattern(p.dash ? p.dash.map((d) => d * LINE) : [], 0);
        const style = p.fill && p.stroke ? 'FD' : p.fill ? 'F' : 'S';
        polyline(p.pts, style, !p.open);
        doc.setLineDashPattern([], 0);
        break;
      }
      case 'line':
        doc.setDrawColor(...hexRgb(p.stroke));
        doc.setLineWidth(p.w * LINE);
        doc.setLineDashPattern(p.dash ? p.dash.map((d) => d * LINE) : [], 0);
        doc.line(X(p.a), Y(p.a), X(p.b), Y(p.b));
        doc.setLineDashPattern([], 0);
        break;
      case 'arc': {
        const steps = 14;
        const pts: Vec2[] = [];
        for (let i = 0; i <= steps; i++) {
          const a = p.a0 + ((p.a1 - p.a0) * i) / steps;
          pts.push({ x: p.c.x + p.r * Math.cos(a), y: p.c.y + p.r * Math.sin(a) });
        }
        doc.setDrawColor(...hexRgb(p.stroke));
        doc.setLineWidth(p.w * LINE);
        polyline(pts, 'S', false);
        break;
      }
      case 'circle': {
        if (p.fill) doc.setFillColor(...hexRgb(p.fill));
        if (p.stroke) {
          doc.setDrawColor(...hexRgb(p.stroke));
          doc.setLineWidth((p.w ?? 1) * LINE);
        }
        doc.circle(
          X(p.c),
          Y(p.c),
          Math.max(0.15, p.r * scale),
          p.fill && p.stroke ? 'FD' : p.fill ? 'F' : 'S',
        );
        break;
      }
      case 'text': {
        if (!shown.has(p)) break;
        const size = p.size * 0.85;
        if (p.bg) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(size);
          const w = doc.getTextWidth(p.s) + 0.8;
          const h = size * MM_PER_PT * 1.1;
          if (!p.angle) {
            doc.setFillColor(255, 255, 255);
            doc.rect(X(p.at) - w / 2, Y(p.at) - h / 2, w, h, 'F');
          }
        }
        drawText(doc, p.s, X(p.at), Y(p.at), size, {
          color: p.color,
          align: p.align,
          angle: p.angle,
          bold: p.bold,
        });
        break;
      }
    }
  }
}

function drawNorth(doc: jsPDF, x: number, y: number, r: number, north: number) {
  const a = (north * Math.PI) / 180;
  const tip = { x: x + Math.sin(a) * r, y: y - Math.cos(a) * r };
  const left = { x: x + Math.sin(a + 2.5) * r * 0.6, y: y - Math.cos(a + 2.5) * r * 0.6 };
  const right = { x: x + Math.sin(a - 2.5) * r * 0.6, y: y - Math.cos(a - 2.5) * r * 0.6 };
  doc.setDrawColor(0);
  doc.setLineWidth(0.2);
  doc.circle(x, y, r, 'S');
  doc.setFillColor(20, 20, 20);
  doc.triangle(tip.x, tip.y, left.x, left.y, right.x, right.y, 'F');
  drawText(doc, 'N', tip.x, tip.y - 2, 8, { align: 'center', bold: true });
}

function titleBlock(doc: jsPDF, p: Project, title: string, scaleText: string) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN / 2, MARGIN / 2, W - MARGIN, H - MARGIN, 'S');
  const y = H - MARGIN / 2 - 12;
  doc.line(MARGIN / 2, y, W - MARGIN / 2, y);
  drawText(doc, p.name, MARGIN, y + 4, 11, { bold: true });
  drawText(doc, title, MARGIN, y + 9, 9);
  drawText(doc, scaleText, W - MARGIN, y + 4, 9, { align: 'right' });
  drawText(doc, new Date().toLocaleDateString('en-IN'), W - MARGIN, y + 9, 9, { align: 'right' });
  return { top: MARGIN, bottom: y - 3, left: MARGIN, right: W - MARGIN };
}

function planPage(doc: jsPDF, p: Project, floor: Floor, opt: PdfOptions, first: boolean) {
  if (!first) doc.addPage(opt.paper, opt.orientation);
  const draw: DrawOptions = {
    settings: p.settings,
    ink: '#111111',
    muted: '#555555',
    wallFill: '#c9c9c9',
    paper: '#ffffff',
    forPrint: true,
    roomLabel: opt.text,
    site: floor.levelIndex === 0 ? p.site : undefined,
  };
  const prims = floorPrims(floor, draw);
  const box = primBounds(prims);
  // Lay out the frame first using a placeholder scale, then redraw its text with the real one.
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const area = { top: MARGIN, bottom: H - MARGIN / 2 - 15, left: MARGIN, right: W - MARGIN };
  const availW = area.right - area.left;
  const availH = area.bottom - area.top;
  let scale = 1 / 100;
  if (box) {
    const fit = Math.min(
      availW / Math.max(1, box.maxX - box.minX),
      availH / Math.max(1, box.maxY - box.minY),
    );
    scale = opt.scale === 'fit' ? fit : Math.min(1 / opt.scale, fit);
  }
  const ratio = Math.round(1 / scale);
  const reduced = opt.scale !== 'fit' && Math.abs(ratio - opt.scale) > 1;
  titleBlock(
    doc,
    p,
    opt.text(floor.name),
    `${opt.label('print.scale')} 1:${ratio}${reduced ? ` (${opt.label('print.reducedToFit')})` : ''}`,
  );
  if (!box) {
    drawText(doc, opt.label('print.emptyFloor'), W / 2, H / 2, 12, { align: 'center' });
    return;
  }
  const ox = area.left + (availW - (box.maxX - box.minX) * scale) / 2 - box.minX * scale;
  const oy = area.top + (availH - (box.maxY - box.minY) * scale) / 2 - box.minY * scale;
  drawPrimsToPdf(
    doc,
    prims,
    (q) => ox + q.x * scale,
    (q) => oy + q.y * scale,
    scale,
  );
  drawNorth(doc, area.right - 10, area.top + 12, 7, p.settings.northAngleDeg);

  // Scale bar: a round number of metres, to measure from the printed sheet.
  const barMetres = [1, 2, 5, 10, 20].find((m) => m * 1000 * scale > 25) ?? 20;
  const barMm = barMetres * 1000 * scale;
  const bx = area.left + 2;
  const by = area.bottom - 4;
  doc.setDrawColor(0);
  doc.setLineWidth(0.4);
  doc.line(bx, by, bx + barMm, by);
  doc.line(bx, by - 1.5, bx, by + 1.5);
  doc.line(bx + barMm, by - 1.5, bx + barMm, by + 1.5);
  drawText(doc, `${barMetres} m`, bx + barMm / 2, by - 3, 8, { align: 'center' });
}

interface Column {
  head: string;
  width: number;
  align?: 'left' | 'right';
}

class Report {
  private y = 0;
  private page = 0;
  private readonly W: number;
  private readonly H: number;
  constructor(
    private readonly doc: jsPDF,
    private readonly p: Project,
    private readonly title: string,
    private fresh: boolean,
  ) {
    this.W = 210;
    this.H = 297;
    this.newPage();
  }
  private newPage() {
    if (!this.fresh || this.page > 0) this.doc.addPage('a4', 'portrait');
    this.fresh = false;
    this.page += 1;
    drawText(this.doc, `${this.p.name}: ${this.title}`, MARGIN, 10, 11, { bold: true });
    drawText(this.doc, `${this.page}`, this.W - MARGIN, 10, 9, { align: 'right' });
    this.doc.setDrawColor(0);
    this.doc.setLineWidth(0.3);
    this.doc.line(MARGIN, 13, this.W - MARGIN, 13);
    this.y = 19;
  }
  private need(h: number) {
    if (this.y + h > this.H - 12) this.newPage();
  }
  heading(text: string) {
    this.need(12);
    this.y += 2;
    drawText(this.doc, text, MARGIN, this.y, 12, { bold: true });
    this.y += 6;
  }
  para(text: string, size = 9, color = '#222222') {
    const width = this.W - 2 * MARGIN;
    const lineH = size * MM_PER_PT * 1.3;
    if (hasNonLatin(text)) {
      for (const line of wrapShaped(text, width, size)) {
        this.need(lineH * 1.25);
        drawText(this.doc, line, MARGIN, this.y, size, { color });
        this.y += lineH * 1.25;
      }
      this.y += 1;
      return;
    }
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(size);
    for (const line of this.doc.splitTextToSize(text, width) as string[]) {
      this.need(lineH);
      drawText(this.doc, line, MARGIN, this.y, size, { color });
      this.y += lineH;
    }
    this.y += 1;
  }
  table(columns: Column[], rows: string[][], boldRows: Set<number> = new Set()) {
    const header = () => {
      this.need(8);
      let x = MARGIN;
      this.doc.setFillColor(235, 235, 235);
      this.doc.rect(MARGIN, this.y - 3.2, this.W - 2 * MARGIN, 5.6, 'F');
      for (const c of columns) {
        drawText(this.doc, c.head, c.align === 'right' ? x + c.width - 1 : x + 1, this.y, 8.5, {
          bold: true,
          align: c.align ?? 'left',
        });
        x += c.width;
      }
      this.y += 5.5;
    };
    header();
    rows.forEach((row, r) => {
      const wrapped = row.map((cell, i) => {
        this.doc.setFont('helvetica', boldRows.has(r) ? 'bold' : 'normal');
        this.doc.setFontSize(8.5);
        return hasNonLatin(cell)
          ? wrapShaped(cell, columns[i].width - 2, 8.5)
          : (this.doc.splitTextToSize(cell, columns[i].width - 2) as string[]);
      });
      const lines = Math.max(...wrapped.map((w) => w.length));
      const h = lines * 3.8 + 1.2;
      if (this.y + h > this.H - 12) {
        this.newPage();
        header();
      }
      let x = MARGIN;
      wrapped.forEach((cellLines, i) => {
        const c = columns[i];
        cellLines.forEach((line, k) => {
          drawText(this.doc, line, c.align === 'right' ? x + c.width - 1 : x + 1, this.y + k * 3.8, 8.5, {
            align: c.align ?? 'left',
            bold: boldRows.has(r),
          });
        });
        x += c.width;
      });
      this.doc.setDrawColor(210);
      this.doc.setLineWidth(0.1);
      this.doc.line(MARGIN, this.y + h - 2.9, this.W - MARGIN, this.y + h - 2.9);
      this.y += h;
    });
    this.y += 3;
  }
}

/** The built-in Latin PDF font has no rupee sign, so rupees print as Rs. */
const moneyIn = (currency: string) => (n: number) => formatMoney(n, currency).replace('₹', 'Rs ');
const qty = (n: number) => (n >= 100 ? formatIndian(n) : n.toFixed(n >= 10 ? 1 : 2));
const r3 = (r: Range, f: (n: number) => string) => [f(r.min), f(r.likely), f(r.max)];

function schedulePages(doc: jsPDF, p: Project, opt: PdfOptions, first: boolean) {
  const L = opt.label;
  const rep = new Report(doc, p, L('print.schedule'), first);
  const unit = p.settings.displayUnit;
  for (const floor of p.floors) {
    rep.heading(opt.text(floor.name));
    if (floor.rooms.length) {
      rep.table(
        [
          { head: L('room.name'), width: 62 },
          { head: L('room.type'), width: 42 },
          { head: L('room.zone'), width: 16 },
          { head: 'sq ft', width: 24, align: 'right' },
          { head: 'sq m', width: 24, align: 'right' },
          { head: L('room.perimeter'), width: 22, align: 'right' },
        ],
        floor.rooms.map((r) => [
          opt.text(r.name),
          L(`room.${r.type}`, r.type),
          L(`zone.${r.zone}`, r.zone),
          formatArea(r.area, 'sqft', 1).replace(' sq ft', ''),
          formatArea(r.area, 'sqm', 2).replace(' sq m', ''),
          formatLength(r.perimeter, unit, 0),
        ]),
      );
    }
    if (floor.openings.length) {
      rep.table(
        [
          { head: L('opening.type'), width: 70 },
          { head: L('opening.width'), width: 30, align: 'right' },
          { head: L('opening.height'), width: 30, align: 'right' },
          { head: L('opening.sill'), width: 30, align: 'right' },
          { head: L('wall.length'), width: 30, align: 'right' },
        ],
        floor.openings.map((o) => {
          const w = floor.walls.find((x) => x.id === o.wallId);
          return [
            L(`obj.${o.catalogId}`, o.catalogId),
            formatLength(o.width, unit, 'eighth'),
            formatLength(o.height, unit, 'eighth'),
            formatLength(o.sillHeight, unit, 'eighth'),
            w ? formatLength(wallLength(w), unit, 'eighth') : '',
          ];
        }),
      );
    }
  }
}

function vastuPages(doc: jsPDF, p: Project, opt: PdfOptions, first: boolean) {
  const L = opt.label;
  const report = assessVastu(p);
  const rep = new Report(doc, p, L('menu.vastu'), first);
  rep.heading(report.score === null ? L('vastu.noScore') : `${L('vastu.score')}: ${report.score} / 100`);
  rep.para(L('vastu.disclaimer'));
  rep.table(
    [
      { head: L('vastu.rule'), width: 46 },
      { head: L('vastu.status'), width: 18 },
      { head: L('vastu.found'), width: 58 },
      { head: L('vastu.suggestion'), width: 68 },
    ],
    report.findings.map((f) => [
      L(`vastu.${f.ruleId}`, f.title),
      L(`vastu.status.${f.status}`),
      `${f.floor ? `${opt.text(f.floor)}: ` : ''}${opt.template(f.template, f.vars)}`,
      opt.text(f.suggestion),
    ]),
  );
}

function estimatePages(doc: jsPDF, p: Project, opt: PdfOptions, first: boolean) {
  const L = opt.label;
  const e = estimateProject(p);
  const T = opt.text;
  const money = moneyIn(p.settings.currency);
  const rep = new Report(doc, p, L('menu.estimate'), first);
  rep.heading(L('estimate.total'));
  const summary: [string, Range, (n: number) => string][] = [
    [L('estimate.cost'), e.total, money],
    [L('estimate.perSqft'), e.perSqft, money],
    [L('estimate.duration'), e.totalDays, (n) => `${Math.round(n)} ${L('estimate.days')}`],
  ];
  const range3 = [
    { head: L('estimate.min'), width: 40, align: 'right' as const },
    { head: L('estimate.likely'), width: 40, align: 'right' as const },
    { head: L('estimate.max'), width: 40, align: 'right' as const },
  ];
  rep.table(
    [{ head: '', width: 70 }, ...range3],
    summary.map(([label, r, f]) => [label, ...r3(r, f)]),
  );
  rep.para(
    `${L('estimate.builtUp')}: ${e.builtUpSqm.toFixed(1)} sq m (${(e.builtUpSqm * 10.7639).toFixed(0)} sq ft). ${L('estimate.carpet')}: ${e.carpetSqm.toFixed(1)} sq m.`,
  );

  rep.heading(L('estimate.byStage'));
  const stageRows = e.stages.map((s) => [L(`stage.${s.stage}`, s.stage), ...r3(s.cost, money)]);
  stageRows.push([L('estimate.contingency'), ...r3(e.contingency, money)]);
  stageRows.push([L('estimate.total'), ...r3(e.total, money)]);
  rep.table(
    [{ head: L('estimate.stage'), width: 70 }, ...range3],
    stageRows,
    new Set([stageRows.length - 1]),
  );

  rep.heading(L('estimate.materials'));
  rep.table(
    [{ head: L('estimate.material'), width: 58 }, { head: L('estimate.unit'), width: 12 }, ...range3],
    e.materials.map((m) => [
      L(`material.${m.key.replace('unit_', '')}`, m.name),
      T(m.unit),
      ...r3(m.quantity, qty),
    ]),
  );

  rep.heading(L('estimate.schedule'));
  rep.table(
    [{ head: L('estimate.task'), width: 70 }, ...range3],
    [
      ...e.schedule.map((t) => [L(`task.${t.id}`, t.name), ...r3(t.days, (n) => `${Math.round(n)}`)]),
      [L('estimate.total'), ...r3(e.totalDays, (n) => `${Math.round(n)}`)],
    ],
    new Set([e.schedule.length]),
  );

  rep.heading(L('estimate.curing'));
  rep.table(
    [
      { head: L('estimate.element'), width: 46 },
      { head: L('estimate.cureDays'), width: 28, align: 'right' },
      { head: L('estimate.stripDays'), width: 38, align: 'right' },
      { head: L('estimate.notes'), width: 78 },
    ],
    e.curing.map((c) => [
      T(c.element),
      `${Math.round(c.cureDays.min)}-${Math.round(c.cureDays.max)}`,
      c.stripDays ? `${Math.round(c.stripDays.min)}-${Math.round(c.stripDays.max)}` : '-',
      T(c.note),
    ]),
  );

  rep.heading(L('estimate.details'));
  rep.table(
    [
      { head: L('estimate.item'), width: 56 },
      { head: L('estimate.quantity'), width: 34, align: 'right' },
      { head: L('estimate.min'), width: 24, align: 'right' },
      { head: L('estimate.likely'), width: 24, align: 'right' },
      { head: L('estimate.max'), width: 24, align: 'right' },
      { head: L('estimate.basis'), width: 28 },
    ],
    e.lines.map((l) => [
      T(l.name),
      `${qty(l.quantity.min)}-${qty(l.quantity.max)} ${T(l.unit)}`,
      ...r3(l.cost, (n) => formatIndian(n)),
      T(l.assumption),
    ]),
  );

  rep.heading(L('estimate.assumptions'));
  e.assumptions.forEach((a) => rep.para(`- ${T(a)}`));
  if (e.defaultRatesUsed.length) {
    rep.heading(L('estimate.defaultRates'));
    rep.para(`${L('estimate.defaultRatesHelp')} ${e.defaultRatesUsed.map(T).join(', ')}.`);
  }
}

/** Builds the requested PDF, entirely offline. */
export async function buildPdf(p: Project, opt: PdfOptions): Promise<jsPDF> {
  const { jsPDF: Pdf } = await import('jspdf');
  const doc = new Pdf({ unit: 'mm', format: opt.paper, orientation: opt.orientation, compress: true });
  let first = true;
  if (opt.includePlans) {
    for (const floor of p.floors) {
      if (!floor.visible) continue;
      planPage(doc, p, floor, opt, first);
      first = false;
    }
  }
  if (first) {
    // jsPDF always starts with one page in the requested size; reports use A4 portrait.
    doc.deletePage(1);
    doc.addPage('a4', 'portrait');
  }
  if (opt.includeSchedule) {
    schedulePages(doc, p, opt, first);
    first = false;
  }
  if (opt.includeVastu) {
    vastuPages(doc, p, opt, first);
    first = false;
  }
  if (opt.includeEstimate) {
    estimatePages(doc, p, opt, first);
    first = false;
  }
  doc.setProperties({ title: p.name, creator: 'Nakshakar' });
  return doc;
}

/** Vector SVG of a floor, for the browser print dialog. */
/** This text goes straight into the page, and a shared file comes from someone else. */
const safeColor = (c: string) => (/^(#[0-9a-f]{3,8}|none)$/i.test(c) ? c : '#999999');

export function floorSvg(p: Project, floor: Floor, translate?: (s: string) => string): string {
  const prims = floorPrims(floor, {
    settings: p.settings,
    ink: '#111111',
    muted: '#555555',
    wallFill: '#c9c9c9',
    paper: '#ffffff',
    forPrint: true,
    roomLabel: translate,
    site: floor.levelIndex === 0 ? p.site : undefined,
  });
  const box = primBounds(prims) ?? { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const pad = 600;
  const vw = box.maxX - box.minX + 2 * pad;
  const vh = box.maxY - box.minY + 2 * pad;
  const unit = vw / 900;
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  const out: string[] = [];
  const shown = visibleTexts(prims, (q) => {
    const size = q.size * unit * 1.2;
    return textBox(q.at.x, q.at.y, q.s.length * size * 0.56, size * 1.2, q.align, q.angle);
  });
  for (const q of prims) {
    if (q.t === 'poly') {
      const pts = q.pts.map((v) => `${v.x},${v.y}`).join(' ');
      const tag = q.open ? 'polyline' : 'polygon';
      out.push(
        `<${tag} points="${pts}" fill="${safeColor(q.fill ?? 'none')}" stroke="${safeColor(q.stroke ?? 'none')}" stroke-width="${(q.w ?? 1) * unit}"${q.dash ? ` stroke-dasharray="${q.dash.map((d) => d * unit).join(' ')}"` : ''}/>`,
      );
    } else if (q.t === 'line') {
      out.push(
        `<line x1="${q.a.x}" y1="${q.a.y}" x2="${q.b.x}" y2="${q.b.y}" stroke="${safeColor(q.stroke)}" stroke-width="${q.w * unit}"/>`,
      );
    } else if (q.t === 'circle') {
      out.push(
        `<circle cx="${q.c.x}" cy="${q.c.y}" r="${q.r}" fill="${safeColor(q.fill ?? 'none')}" stroke="${safeColor(q.stroke ?? 'none')}" stroke-width="${(q.w ?? 1) * unit}"/>`,
      );
    } else if (q.t === 'arc') {
      const a = { x: q.c.x + q.r * Math.cos(q.a0), y: q.c.y + q.r * Math.sin(q.a0) };
      const b = { x: q.c.x + q.r * Math.cos(q.a1), y: q.c.y + q.r * Math.sin(q.a1) };
      out.push(
        `<path d="M ${a.x} ${a.y} A ${q.r} ${q.r} 0 0 ${q.a1 > q.a0 ? 1 : 0} ${b.x} ${b.y}" fill="none" stroke="${safeColor(q.stroke)}" stroke-width="${q.w * unit}"/>`,
      );
    } else if (shown.has(q)) {
      const anchor = q.align === 'center' ? 'middle' : q.align === 'right' ? 'end' : 'start';
      const turn = q.angle ? ` transform="rotate(${q.angle} ${q.at.x} ${q.at.y})"` : '';
      out.push(
        `<text x="${q.at.x}" y="${q.at.y}" font-size="${q.size * unit * 1.2}" fill="${safeColor(q.color)}" text-anchor="${anchor}" dominant-baseline="middle"${q.bold ? ' font-weight="600"' : ''}${turn}>${esc(q.s)}</text>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.minX - pad} ${box.minY - pad} ${vw} ${vh}">${out.join('')}</svg>`;
}
